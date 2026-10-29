"""설정 = 환경변수만. `.env` 는 `uv run --env-file .env ...` 가 넣는다 (python-dotenv 없음).

키는 conductor 만 가진다. 데스크톱·관리자 콘솔은 이 서비스만 부른다 (AGENTS.md · ADR-0006).
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

# 브라우저 출처 허용 목록 (CORS). 데스크톱 = Electron app://brewai (개발 중엔 Vite 5173), 관리자 = Vite dev 5174 · preview 4174
DESKTOP_ORIGINS = ("app://brewai", "http://localhost:5173")
ADMIN_ORIGINS = ("http://localhost:5174", "http://localhost:4174")
# 첫 동기화 때 노출할 모델 = 키 없이 답하는 mock (infra/litellm/config.yaml). 나머지 새 모델은 후보(숨김)
BOOTSTRAP_MODELS = ("brewai-mock",)
DEFAULT_DB_PATH = Path(".data") / "conductor.sqlite3"  # npm run api 는 레포 루트에서 돈다 → <레포>/.data/ (gitignore)


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
    )


def _seconds(raw: str | None, default: float) -> float:
    # 0 = 끔. 잘못된 값이면 기본값 (기동을 막지 않는다). 너무 짧으면 게이트웨이를 두드리니 10초 아래는 10초
    if raw is None or raw.strip() == "":
        return default
    try:
        v = float(raw)
    except ValueError:
        return default
    return 0.0 if v <= 0 else max(v, 10.0)
