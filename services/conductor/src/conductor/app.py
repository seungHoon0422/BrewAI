"""conductor HTTP API (FastAPI). 실행: npm run api (= uv run --env-file .env uvicorn --factory conductor.app:create_app --host 127.0.0.1 --port 8787)

GET  /healthz           살아 있음 (게이트웨이는 안 부른다)
GET  /api/models        데스크톱용 [{id, label}] — 첫 항목 = 기본 모델
GET  /api/admin/models  관리자 콘솔 '모델' 표 (읽기 전용 · 등록 없음, ADR-0006)
POST /api/chat          AG-UI RunAgentInput → AG-UI SSE (agent.py)
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from .agent import ChatRequestError, ChatRuntime
from .gateway import GatewayCatalogPort, GatewayError, GatewayModel, LiteLLMCatalog
from .settings import Settings, load_settings

ADMIN_PREFIX = "/api/admin/"


class ModelOut(BaseModel):
    id: str
    label: str


class AdminModelRow(BaseModel):
    id: str
    label: str
    exposed: bool  # P1: 채팅 모델은 모두 노출. P2: model_exposure 테이블
    providers: list[str]
    mode: str | None
    max_input_tokens: int | None
    max_output_tokens: int | None
    input_cost_per_token: float | None
    output_cost_per_token: float | None
    supports_function_calling: bool
    supports_vision: bool
    supports_reasoning: bool


class ScopedCORS:
    """CORS 를 경로로 나눈다: /api/admin/* = 관리자 출처만, 나머지 = 데스크톱 출처만 (사용자 앱 ↔ 관리자 분리)."""

    def __init__(self, app: ASGIApp, *, desktop_origins: Sequence[str], admin_origins: Sequence[str]) -> None:
        common = {"allow_methods": ["GET", "POST"], "allow_headers": ["content-type", "accept"], "max_age": 600}
        self._desktop = CORSMiddleware(app, allow_origins=list(desktop_origins), **common)
        self._admin = CORSMiddleware(app, allow_origins=list(admin_origins), **common)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        admin = scope["type"] == "http" and scope["path"].startswith(ADMIN_PREFIX)
        await (self._admin if admin else self._desktop)(scope, receive, send)


def create_app(
    settings: Settings | None = None,
    *,
    catalog: GatewayCatalogPort | None = None,
    runtime: ChatRuntime | None = None,
) -> FastAPI:
    settings = settings or load_settings()
    catalog = catalog or LiteLLMCatalog(settings.gateway_url, settings.gateway_key, ttl_s=settings.catalog_ttl_s)
    runtime = runtime or ChatRuntime(gateway_url=settings.gateway_url, gateway_key=settings.gateway_key)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        async with runtime:
            yield
        if isinstance(catalog, LiteLLMCatalog):
            await catalog.aclose()

    # /docs·/redoc 끔 (CDN 스크립트를 부른다). /openapi.json 은 둔다.
    app = FastAPI(title="BrewAI conductor", version="0.0.0", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.add_middleware(ScopedCORS, desktop_origins=settings.desktop_origins, admin_origins=settings.admin_origins)
    # DNS rebinding 막기: Host 가 이 PC 이름일 때만 (conductor 는 게이트웨이 키를 쥔다)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])

    @app.exception_handler(GatewayError)
    async def _gateway_error(_: Request, e: GatewayError) -> JSONResponse:
        return JSONResponse({"detail": e.code}, status_code=503 if e.code == "gateway_unreachable" else 502)

    @app.exception_handler(ChatRequestError)
    async def _chat_error(_: Request, e: ChatRequestError) -> JSONResponse:
        return JSONResponse({"detail": e.code}, status_code=e.status)

    async def chat_models() -> list[GatewayModel]:
        models = [m for m in await catalog.list_models() if m.is_chat]
        if settings.default_model:  # 기본 모델을 맨 앞으로 (P2: 관리자 순서)
            models.sort(key=lambda m: m.id != settings.default_model)
        return models

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/models")
    async def list_models() -> list[ModelOut]:
        return [ModelOut(id=m.id, label=m.id) for m in await chat_models()]

    @app.get("/api/admin/models")
    async def admin_models() -> list[AdminModelRow]:
        # 캐시 없이: 게이트웨이가 방금 꺼졌으면 관리자 표 · 개요 카드가 바로 그렇게 말한다
        rows = await catalog.list_models(fresh=True)
        return [AdminModelRow(**m.row(), label=m.id, exposed=m.is_chat) for m in rows]

    @app.post("/api/chat")
    async def chat(request: Request) -> Response:
        async def resolve(requested: str | None) -> str:
            ids = [m.id for m in await chat_models()]
            if requested is None:
                if not ids:
                    raise ChatRequestError(503, "no_models")
                return ids[0]
            if requested not in ids:
                raise ChatRequestError(400, "unknown_model")
            return requested

        return await runtime.handle(request, resolve)

    return app
