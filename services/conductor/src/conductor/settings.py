"""설정 = 환경변수만. `.env` 는 `uv run --env-file .env ...` 가 넣는다 (python-dotenv 없음).

키는 conductor 만 가진다. 데스크톱·관리자 콘솔은 이 서비스만 부른다 (AGENTS.md · ADR-0006).
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field

# 브라우저 출처 허용 목록 (CORS). 데스크톱 = Electron app://brewai (개발 중엔 Vite 5173), 관리자 = Vite dev 5174 · preview 4174
DESKTOP_ORIGINS = ("app://brewai", "http://localhost:5173")
ADMIN_ORIGINS = ("http://localhost:5174", "http://localhost:4174")


@dataclass(frozen=True)
class Settings:
    gateway_url: str
    gateway_key: str = field(repr=False)  # 로그·repr 에 찍히지 않게
    desktop_origins: tuple[str, ...] = DESKTOP_ORIGINS
    admin_origins: tuple[str, ...] = ADMIN_ORIGINS
    default_model: str | None = None
    catalog_ttl_s: float = 30.0


def _origins(raw: str | None, default: tuple[str, ...]) -> tuple[str, ...]:
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
        desktop_origins=_origins(env.get("CONDUCTOR_DESKTOP_ORIGINS"), DESKTOP_ORIGINS),
        admin_origins=_origins(env.get("CONDUCTOR_ADMIN_ORIGINS"), ADMIN_ORIGINS),
        default_model=env.get("CONDUCTOR_DEFAULT_MODEL") or None,
    )
