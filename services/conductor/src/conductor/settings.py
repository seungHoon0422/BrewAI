"""설정 = 환경변수만. `.env` 는 `uv run --env-file .env ...` 가 넣는다 (python-dotenv 없음).

키는 conductor 만 가진다. 데스크톱·관리자 콘솔은 이 서비스만 부른다 (AGENTS.md · ADR-0006).
"""

from __future__ import annotations

import ipaddress
import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

# 브라우저 출처 허용 목록 (CORS). 데스크톱 = Electron app://brewai (개발 중엔 Vite 5173), 관리자 = Vite dev 5174 · preview 4174
DESKTOP_ORIGINS = ("app://brewai", "http://localhost:5173")
ADMIN_ORIGINS = ("http://localhost:5174", "http://localhost:4174")
# 첫 동기화 때 노출할 모델 = 키 없이 답하는 mock (infra/litellm/config.yaml). 나머지 새 모델은 후보(숨김)
BOOTSTRAP_MODELS = ("brewai-mock",)
DEFAULT_DB_PATH = Path(".data") / "conductor.sqlite3"  # npm run api 는 레포 루트에서 돈다 → <레포>/.data/ (gitignore)
DEFAULT_SKILLS_DIR = Path("runtime") / "skills"  # 제품 스킬 (AGENTS.md: .claude/skills = 개발 루틴과 섞지 않는다)
PUBLIC_URL = "http://127.0.0.1:8787"  # 시스템 브라우저가 여는 conductor 주소 (Google 콜백 · 운영 = https 도메인)
ADMIN_URL = "http://localhost:5174"  # 관리자 콘솔 주소 (Vite proxy 로 /api 가 같은 출처 · 관리자 Google 콜백)
GOOGLE_ISSUER = "https://accounts.google.com"
PASSWORD_MIN = 15  # OWASP (MFA 없음) · ADR-0010
log = logging.getLogger("conductor.settings")


@dataclass(frozen=True)
class Settings:
    gateway_url: str
    gateway_key: str = field(repr=False)  # 로그·repr 에 찍히지 않게
    desktop_origins: tuple[str, ...] = DESKTOP_ORIGINS
    admin_origins: tuple[str, ...] = ADMIN_ORIGINS
    default_model: str | None = None  # 첫 동기화 때 노출 + 기본으로 (그 뒤엔 관리자 콘솔이 정한다)
    catalog_ttl_s: float = 30.0
    db_path: str = ":memory:"  # 테스트 기본값. load_settings 는 DEFAULT_DB_PATH
    bootstrap_models: tuple[str, ...] = BOOTSTRAP_MODELS
    gateway_ui_url: str | None = None  # 관리자 '모델 추가' 링크 (LiteLLM Admin UI). 없으면 gateway_url + /ui
    model_sync_interval_s: float = 0.0  # 게이트웨이 모델 자동 동기화 주기. 0 = 끔 (테스트 기본값). load_settings 는 60초
    files_dir: str | None = None  # 파일 원본 (slice 07) · None = db_path 옆 files/ (메모리 DB = 임시 폴더)
    skills_dir: str | None = None  # 제품 스킬 폴더 (None = 스킬 없음 · 테스트 기본값). load_settings 는 runtime/skills
    # ↓ 로그인 (ADR-0010). 첫 관리자 = users 가 비어 있을 때만 이 값으로 만든다
    admin_email: str | None = None
    admin_password: str | None = field(default=None, repr=False)
    password_min: int = PASSWORD_MIN
    public_url: str = PUBLIC_URL
    admin_url: str = ADMIN_URL
    google_client_id: str | None = None
    google_client_secret: str | None = field(default=None, repr=False)
    google_issuer: str = GOOGLE_ISSUER
    e2e: bool = False  # BREWAI_E2E=1 — http mock OIDC issuer 를 허용하는 유일한 조건 (public_url 도 loopback 일 때만)
    # 테스트 관리자 admin / admin (BREWAI_TEST_ADMIN=1 · npm run dev 가 기본으로 켠다). 켜지는 건 test_admin_active 일 때만
    test_admin: bool = False
    test_admin_off: bool = False  # BREWAI_TEST_ADMIN=0 이라고 적었을 때만 True → 그 계정을 잠근다 (비어 있음 = 그대로 둔다)
    # ↓ MCP 연결 (ADR-0013). 인증정보 암호화 키 = CONDUCTOR_SECRET_KEY (stack.mjs 가 만든다 · 32바이트 base64url 또는 64 hex)
    secret_key: str | None = field(default=None, repr=False)
    secret_key_id: str = "k1"
    secret_keys_old: tuple[tuple[str, str], ...] = field(default=(), repr=False)  # 키 교체 뒤 옛 키 (id, 키) — 읽기만
    mcp_allow_loopback: bool = False  # CONDUCTOR_MCP_ALLOW_LOOPBACK=1 (테스트 전용) — 켜지는 건 mcp_loopback_ok 일 때만
    link_preview_hosts: str | None = None  # CONDUCTOR_LINK_PREVIEW_HOSTS (E2E 전용 · 'preview.brewai.test=http://127.0.0.1:4014') — mcp_loopback_ok 일 때만
    mcp_presets_path: str | None = None  # CONDUCTOR_MCP_PRESETS = 추천 서버 파일 (없음 = connectors/presets.json · E2E = 가짜 MCP 주소 파일)

    @property
    def google_enabled(self) -> bool:
        """키가 둘 다 있고 issuer 가 https (또는 E2E + loopback 의 http mock) 일 때만. 아니면 버튼을 숨긴다."""
        if not (self.google_client_id and self.google_client_secret):
            return False
        scheme = urlsplit(self.google_issuer).scheme
        return scheme == "https" or (scheme == "http" and self.e2e and is_loopback(self.public_url))

    @property
    def test_admin_active(self) -> bool:
        """테스트 관리자 = 이 PC 안에서만: conductor 공개 주소 · 관리자 콘솔 주소가 둘 다 loopback 일 때 (mock OIDC 규칙과 같은 생각)."""
        return self.test_admin and is_loopback(self.public_url) and is_loopback(self.admin_url)

    @property
    def test_admin_lock(self) -> bool:
        """테스트 관리자 계정을 잠글 때 = 일부러 끔(0) 또는 이 PC 밖 주소. 그냥 비어 있으면(npm run api 만 다시 켬 등) 그대로 둔다
        — 꺼져 있는 동안 로그인 ID 'admin' 은 어차피 안 받으니 비밀번호 로그인은 안 되고, 켜 둔 세션만 끊기지 않는다."""
        here = is_loopback(self.public_url) and is_loopback(self.admin_url)
        return not self.test_admin_active and (self.test_admin_off or not here)

    @property
    def mcp_loopback_ok(self) -> bool:
        """http://127.0.0.1 MCP 서버 · OAuth 서버(가짜) = 테스트 전용: 켜 두고 + (E2E 또는 conductor 공개 주소가 loopback) 일 때만.
        사설 · link-local · 메타데이터 주소는 이때도 막는다 (connectors/ssrf.py)."""
        return self.mcp_allow_loopback and (self.e2e or is_loopback(self.public_url))

    @property
    def secure_cookies(self) -> bool:
        return urlsplit(self.admin_url).scheme == "https"


def is_loopback(url: str) -> bool:
    host = urlsplit(url).hostname or ""
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _csv(raw: str | None, default: tuple[str, ...]) -> tuple[str, ...]:
    if raw is None:
        return default
    return tuple(o.strip().rstrip("/") for o in raw.split(",") if o.strip())


def load_settings(env: Mapping[str, str] = os.environ) -> Settings:
    # 127.0.0.1 고정: 윈도우에서 localhost 가 ::1 로 풀리면 127.0.0.1 에만 뜬 LiteLLM 에 바로 못 붙는다
    url = env.get("LLM_GATEWAY_URL", "http://127.0.0.1:4000").rstrip("/")
    # P1 로컬 = LiteLLM master key (ADR-0006). P2 = 서비스 전용 virtual key 를 LLM_GATEWAY_KEY 로.
    key = env.get("LLM_GATEWAY_KEY") or env.get("LITELLM_MASTER_KEY") or ""
    if not key:
        raise RuntimeError("LLM_GATEWAY_KEY (또는 P1 로컬은 LITELLM_MASTER_KEY) 가 비어 있어요 → .env 확인")
    return Settings(
        gateway_url=url,
        gateway_key=key,
        desktop_origins=_csv(env.get("CONDUCTOR_DESKTOP_ORIGINS"), DESKTOP_ORIGINS),
        admin_origins=_csv(env.get("CONDUCTOR_ADMIN_ORIGINS"), ADMIN_ORIGINS),
        default_model=env.get("CONDUCTOR_DEFAULT_MODEL") or None,
        db_path=env.get("CONDUCTOR_DB_PATH") or str(DEFAULT_DB_PATH),
        bootstrap_models=_csv(env.get("CONDUCTOR_BOOTSTRAP_MODELS"), BOOTSTRAP_MODELS),
        gateway_ui_url=(env.get("LLM_GATEWAY_UI_URL") or "").rstrip("/") or None,
        model_sync_interval_s=_seconds(env.get("MODEL_SYNC_INTERVAL_S"), 60.0),
        skills_dir=env.get("CONDUCTOR_SKILLS_DIR") or str(DEFAULT_SKILLS_DIR),
        files_dir=env.get("CONDUCTOR_FILES_DIR") or None,
        admin_email=(env.get("BREWAI_ADMIN_EMAIL") or "").strip() or None,
        admin_password=env.get("BREWAI_ADMIN_PASSWORD") or None,
        password_min=_password_min(env.get("CONDUCTOR_PASSWORD_MIN")),
        public_url=(env.get("CONDUCTOR_PUBLIC_URL") or PUBLIC_URL).rstrip("/"),
        admin_url=(env.get("CONDUCTOR_ADMIN_URL") or ADMIN_URL).rstrip("/"),
        google_client_id=(env.get("GOOGLE_CLIENT_ID") or "").strip() or None,
        google_client_secret=(env.get("GOOGLE_CLIENT_SECRET") or "").strip() or None,
        google_issuer=(env.get("GOOGLE_ISSUER") or GOOGLE_ISSUER).rstrip("/"),
        e2e=env.get("BREWAI_E2E") == "1",
        test_admin=_test_admin(env),
        test_admin_off=(env.get("BREWAI_TEST_ADMIN") or "").strip() == "0",
        secret_key=(env.get("CONDUCTOR_SECRET_KEY") or "").strip() or None,
        secret_key_id=(env.get("CONDUCTOR_SECRET_KEY_ID") or "").strip() or "k1",
        secret_keys_old=_old_keys(env.get("CONDUCTOR_SECRET_KEYS_OLD")),
        mcp_allow_loopback=env.get("CONDUCTOR_MCP_ALLOW_LOOPBACK") == "1",
        mcp_presets_path=(env.get("CONDUCTOR_MCP_PRESETS") or "").strip() or None,
        link_preview_hosts=(env.get("CONDUCTOR_LINK_PREVIEW_HOSTS") or "").strip() or None,
    )


def _old_keys(raw: str | None) -> tuple[tuple[str, str], ...]:
    # "<id>:<키>,<id>:<키>" — 모양이 틀린 칸은 버린다 (값은 로그에 안 찍는다)
    out: list[tuple[str, str]] = []
    for part in (raw or "").split(","):
        kid, sep, key = part.strip().partition(":")
        if sep and kid.strip() and key.strip():
            out.append((kid.strip(), key.strip()))
    return tuple(out)


def _test_admin(env: Mapping[str, str]) -> bool:
    # 개발 = BREWAI_TEST_ADMIN=1 (npm run dev 가 넣는다 · .env 의 0 이 이긴다).
    # E2E 는 셸에 남은 1 이 새어 들지 않게 'e2e' 라고 적은 스펙만 (playwright.config 의 api env)
    raw = (env.get("BREWAI_TEST_ADMIN") or "").strip().lower()
    return raw == ("e2e" if env.get("BREWAI_E2E") == "1" else "1")


def _password_min(raw: str | None) -> int:
    # 8 아래로는 못 내린다 (NIST 하한). 잘못된 값이면 기본값
    try:
        v = int(raw) if raw and raw.strip() else PASSWORD_MIN
    except ValueError:
        log.warning("CONDUCTOR_PASSWORD_MIN=%r 를 못 읽어서 %d 을 써요", raw, PASSWORD_MIN)
        return PASSWORD_MIN
    return min(max(v, 8), 64)


def _seconds(raw: str | None, default: float) -> float:
    # 0 = 끔. 잘못된 값이면 기본값 (기동을 막지 않는다). 너무 짧으면 게이트웨이를 두드리니 10초 아래는 10초
    if raw is None or raw.strip() == "":
        return default
    try:
        v = float(raw)
    except ValueError:
        return default
    return 0.0 if v <= 0 else max(v, 10.0)
