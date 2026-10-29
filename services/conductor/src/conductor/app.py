"""conductor HTTP API (FastAPI). 실행: npm run api (= uv run --env-file .env uvicorn --factory conductor.app:create_app --host 127.0.0.1 --port 8787)

데스크톱 (CORS = 데스크톱 출처만)
  GET    /healthz                    살아 있음 (게이트웨이는 안 부른다)
  GET    /api/models                 노출 모델만 · 기본 모델이 첫 항목(is_default) · 나머지는 관리자 순서
  GET    /api/tools                  conductor 툴 [{name, label, description}] (활동 단계 tool:<name> 의 화면 이름)
  POST   /api/chat                   AG-UI RunAgentInput → AG-UI SSE (agent.py 머리말 = 이벤트 순서)
  GET    /api/threads                최근 대화 (제목 = 첫 질문 첫 줄)
  GET    /api/threads/{id}           대화 기록 (완료된 턴만)
  DELETE /api/threads/{id}           대화 지우기 (204)
  GET    /api/runs                   최근 실행 (진행 상황 화면: 상태 · 모델 · 단계 · 걸린 시간)
관리자 (CORS = 관리자 출처만, ADR-0006 — 모델 등록은 LiteLLM 에서만)
  GET    /api/admin/models           모든 모델 (노출 · 후보 · 숨김 · 사라짐) + 게이트웨이 값 (읽기 전용)
  GET    /api/admin/providers        provider 별 개수
  PATCH  /api/admin/models/{id}      exposed · display_name · order · is_default 만
                                     칸 값이 틀리면 422 {detail: bad_<칸>} · 모르는 칸 = 422 (FastAPI 기본 목록)
  관리자 경로에 관리자 출처가 아닌 Origin 이 붙은 요청 = 403 origin_not_allowed (단순 요청 POST sync 도 막는다)
  POST   /api/admin/models/sync      게이트웨이에서 다시 읽기
  GET    /api/admin/gateway          게이트웨이 주소 · LiteLLM Admin UI 링크 ('LiteLLM 에서 추가')
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from typing import Any, Literal

from fastapi import FastAPI, Query, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from .agent import ChatRequest, ChatRequestError, ChatRuntime, render_run
from .gateway import GatewayCatalogPort, GatewayError, LiteLLMCatalog
from .models import ExposureRow, ModelChoice, ModelPatchError, ModelRegistry
from .providers import provider_label
from .settings import Settings, load_settings
from .store import Store, StoreConflict

ADMIN_PREFIX = "/api/admin/"
TITLE_CHARS = 80
log = logging.getLogger("conductor.app")


class ModelOut(BaseModel):
    id: str  # 게이트웨이 id = 채팅 요청의 forwardedProps.model
    label: str  # 화면 이름 (관리자가 정한 이름 · 없으면 id 로 만든 이름)
    provider: str  # 아이콘 키: brewai · anthropic · openai · google · azure · bedrock · mistral · deepseek · xai · groq · ollama · openrouter · other
    provider_label: str
    family: str | None
    is_default: bool
    supports_reasoning: bool
    supports_tools: bool
    supports_vision: bool
    max_input_tokens: int | None


class AdminModelRow(BaseModel):
    id: str
    label: str
    display_name: str | None  # 관리자가 정한 이름 (null = default_label 사용)
    default_label: str
    family: str | None
    provider: str
    provider_label: str
    provider_ids: list[str]  # 정규화 · 여러 provider 로드밸런싱이면 여러 개
    state: Literal["exposed", "candidate", "hidden", "missing"]
    status: Literal["present", "missing"]
    exposed: bool
    is_default: bool
    order: int  # 표 위치 (1부터)
    is_chat: bool
    first_seen: str
    last_seen: str
    # ↓ 게이트웨이 값 (읽기 전용 · 마지막으로 본 값)
    providers: list[str]  # LiteLLM 이 준 그대로 (예: ["vertex_ai"])
    mode: str | None
    max_input_tokens: int | None
    max_output_tokens: int | None
    input_cost_per_token: float | None
    output_cost_per_token: float | None
    supports_function_calling: bool
    supports_vision: bool
    supports_reasoning: bool


class ModelPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    exposed: StrictBool | None = None
    display_name: str | None = Field(default=None, max_length=200)  # null = 기본 이름으로
    order: StrictInt | None = Field(default=None, ge=1, le=100_000)
    is_default: StrictBool | None = None


PATCH_FIELDS = frozenset(ModelPatch.model_fields)


class ScopedCORS:
    """CORS 를 경로로 나눈다: /api/admin/* = 관리자 출처만, 나머지 = 데스크톱 출처만 (사용자 앱 ↔ 관리자 분리).
    CORS 는 응답 읽기만 막고 단순 요청(POST sync · GET 동기화)은 서버에서 돈다 → 관리자 경로는 다른 Origin 을 아예 거절.
    Origin 없는 요청(curl · 테스트 · 같은 출처)은 통과 — 관리자 인증은 P2-3."""

    def __init__(self, app: ASGIApp, *, desktop_origins: Sequence[str], admin_origins: Sequence[str]) -> None:
        common = {"allow_headers": ["content-type", "accept"], "max_age": 600}
        self._desktop = CORSMiddleware(app, allow_origins=list(desktop_origins), allow_methods=["GET", "POST", "DELETE"], **common)
        self._admin = CORSMiddleware(app, allow_origins=list(admin_origins), allow_methods=["GET", "POST", "PATCH"], **common)
        self._admin_origins = frozenset(admin_origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        admin = scope["type"] == "http" and scope["path"].startswith(ADMIN_PREFIX)
        if admin and "*" not in self._admin_origins:
            origin = next((v.decode("latin-1") for k, v in scope["headers"] if k == b"origin"), None)
            if origin is not None and origin not in self._admin_origins:
                await JSONResponse({"detail": "origin_not_allowed"}, status_code=403)(scope, receive, send)
                return
        await (self._admin if admin else self._desktop)(scope, receive, send)


def _model_out(r: ExposureRow, default: str | None) -> ModelOut:
    return ModelOut(
        id=r.gateway_id, label=r.label, provider=r.provider, provider_label=r.provider_label, family=r.family,
        is_default=r.gateway_id == default, supports_reasoning=bool(r.info.get("supports_reasoning")),
        supports_tools=bool(r.info.get("supports_function_calling")), supports_vision=bool(r.info.get("supports_vision")),
        max_input_tokens=r.info.get("max_input_tokens"),
    )


def _admin_row(r: ExposureRow, order: int, default: str | None) -> AdminModelRow:
    i = r.info
    return AdminModelRow(
        id=r.gateway_id, label=r.label, display_name=r.display_name, default_label=r.default_label, family=r.family,
        provider=r.provider, provider_label=r.provider_label, provider_ids=list(r.providers), state=r.state, status=r.status,
        exposed=r.state == "exposed", is_default=r.gateway_id == default, order=order, is_chat=r.is_chat,
        first_seen=r.first_seen, last_seen=r.last_seen, providers=[str(p) for p in i.get("providers") or ()],
        mode=i.get("mode"), max_input_tokens=i.get("max_input_tokens"), max_output_tokens=i.get("max_output_tokens"),
        input_cost_per_token=i.get("input_cost_per_token"), output_cost_per_token=i.get("output_cost_per_token"),
        supports_function_calling=bool(i.get("supports_function_calling")), supports_vision=bool(i.get("supports_vision")),
        supports_reasoning=bool(i.get("supports_reasoning")),
    )


def _title(prompt: str) -> str:
    line = next((ln.strip() for ln in prompt.splitlines() if ln.strip()), prompt.strip())
    return line if len(line) <= TITLE_CHARS else line[: TITLE_CHARS - 1] + "…"


def _json(value: str | None) -> Any:
    return json.loads(value) if value else None


class _Sink:
    """실행 기록 = runs 표 (agent.RunSink)."""

    def __init__(self, store: Store, req: ChatRequest) -> None:
        self._store = store
        self._req = req

    def steps_changed(self, steps: list[dict[str, Any]]) -> None:
        self._store.update_steps(self._req.run_id, steps)

    def finish(self, *, status, steps, duration_ms, messages, usage, error_code) -> None:  # type: ignore[no-untyped-def]
        self._store.finish_run(
            self._req.run_id, status=status, steps=steps, duration_ms=duration_ms, messages=messages, usage=usage,
            error_code=error_code, title=_title(self._req.prompt),
        )


def create_app(
    settings: Settings | None = None,
    *,
    catalog: GatewayCatalogPort | None = None,
    runtime: ChatRuntime | None = None,
    store: Store | None = None,
) -> FastAPI:
    settings = settings or load_settings()
    catalog = catalog or LiteLLMCatalog(settings.gateway_url, settings.gateway_key, ttl_s=settings.catalog_ttl_s)
    runtime = runtime or ChatRuntime(gateway_url=settings.gateway_url, gateway_key=settings.gateway_key)
    store = store or Store(settings.db_path)
    registry = ModelRegistry(store, catalog, bootstrap=settings.bootstrap_models, default_model=settings.default_model)

    async def _poll_models() -> None:
        # LiteLLM 관리 화면에서 추가·삭제한 모델을 주기적으로 반영 (새 모델 = 후보 · 숨김, 사라진 모델 = missing)
        while True:
            await asyncio.sleep(settings.model_sync_interval_s)
            try:
                result = await registry.refresh(fresh=True)
                if result and (result.added or result.missing):
                    log.info("model sync: +%d new (candidate) · %d missing", len(result.added), len(result.missing))
            except GatewayError as e:
                log.debug("model sync skipped: %s", e.code)
            except Exception:  # 주기 작업이 죽으면 다음 주기에 다시
                log.exception("model sync failed")

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        try:  # 시작할 때 한 번 동기화. 게이트웨이가 꺼져 있어도 conductor 는 뜬다 (요청 때 다시 시도)
            result = await registry.refresh(fresh=True)
            if result and (result.added or result.missing):
                log.info("model sync: +%d new (candidate) · %d missing", len(result.added), len(result.missing))
        except GatewayError as e:
            log.warning("model sync at startup failed: %s", e.code)
        poller = asyncio.create_task(_poll_models()) if settings.model_sync_interval_s > 0 else None
        try:
            async with runtime:
                yield
        finally:
            if poller:
                poller.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await poller
        if isinstance(catalog, LiteLLMCatalog):
            await catalog.aclose()

    # /docs·/redoc 끔 (CDN 스크립트를 부른다). /openapi.json 은 둔다.
    app = FastAPI(title="BrewAI conductor", version="0.0.0", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.add_middleware(ScopedCORS, desktop_origins=settings.desktop_origins, admin_origins=settings.admin_origins)
    # DNS rebinding 막기: Host 가 이 PC 이름일 때만 (conductor 는 게이트웨이 키를 쥔다)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])
    app.state.store = store
    app.state.registry = registry

    @app.exception_handler(GatewayError)
    async def _gateway_error(_: Request, e: GatewayError) -> JSONResponse:
        return JSONResponse({"detail": e.code}, status_code=503 if e.code == "gateway_unreachable" else 502)

    @app.exception_handler(ChatRequestError)
    async def _chat_error(_: Request, e: ChatRequestError) -> JSONResponse:
        return JSONResponse({"detail": e.code}, status_code=e.status)

    @app.exception_handler(ModelPatchError)
    async def _patch_error(_: Request, e: ModelPatchError) -> JSONResponse:
        return JSONResponse({"detail": e.code}, status_code=e.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, e: RequestValidationError) -> Response:
        # PATCH 모델: 칸 값 오류 = {detail: bad_<칸>} (관리자 화면이 한 줄로 바꾼다). 모르는 칸·JSON 아님 = 기본 422 목록
        if request.method == "PATCH" and request.url.path.startswith(f"{ADMIN_PREFIX}models/"):
            errors = e.errors()
            fields = [
                err["loc"][1] for err in errors
                if len(err["loc"]) == 2 and err["loc"][0] == "body" and err["loc"][1] in PATCH_FIELDS and err["type"] != "extra_forbidden"
            ]
            if fields and len(fields) == len(errors):
                return JSONResponse({"detail": f"bad_{fields[0]}"}, status_code=422)
        return await request_validation_exception_handler(request, e)

    @app.exception_handler(StoreConflict)
    async def _conflict(_: Request, e: StoreConflict) -> JSONResponse:
        return JSONResponse({"detail": e.code}, status_code=409)

    def admin_rows() -> list[AdminModelRow]:
        rows = registry.rows()
        default = registry.default_id(rows)
        return [_admin_row(r, i, default) for i, r in enumerate(rows, 1)]

    # ── 데스크톱 ──
    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/models")
    async def list_models() -> list[ModelOut]:
        await registry.refresh()  # 카탈로그 캐시(30초)가 바뀌었을 때만 DB 동기화
        shown = registry.exposed()
        default = shown[0].gateway_id if shown else None
        return [_model_out(r, default) for r in shown]

    @app.get("/api/tools")
    async def list_tools() -> list[dict[str, str]]:
        return [{"name": t.name, "label": t.label, "description": t.description} for t in runtime.tools]

    @app.post("/api/chat")
    async def chat(request: Request) -> Response:
        async def prepare(req: ChatRequest) -> tuple[ModelChoice, list[str], _Sink]:
            await registry.refresh()
            choice = registry.resolve(req.model)
            if choice is None:
                # 숨긴 모델 · 없는 모델 · 채팅 모델 아님 = 모두 unknown_model (무엇이 숨겨져 있는지 알려 주지 않는다)
                raise ChatRequestError(503, "no_models") if req.model is None else ChatRequestError(400, "unknown_model")
            blobs = store.thread_history(req.thread_id)
            effective = req.reasoning if ChatRuntime.model_settings(choice, req.reasoning) is not None else "off"
            try:
                store.start_run(
                    run_id=req.run_id, thread_id=req.thread_id, model=choice.id, model_label=choice.label,
                    provider=choice.provider, reasoning=effective, prompt=req.prompt,  # 실제로 쓴 생각 수준
                )
            except StoreConflict as e:
                raise ChatRequestError(409, e.code) from e
            return choice, blobs, _Sink(store, req)

        return await runtime.handle(request, prepare)

    @app.get("/api/threads")
    async def list_threads(limit: int = Query(50, ge=1, le=200)) -> list[dict[str, Any]]:
        return [
            {
                "id": t["id"], "title": t["title"], "created_at": t["created_at"], "updated_at": t["updated_at"],
                "turns": t["turns"], "last_model": t["last_model"], "running": bool(t["running"]),
            }
            for t in store.list_threads(limit)
        ]

    @app.get("/api/threads/{thread_id}")
    async def get_thread(thread_id: str) -> dict[str, Any]:
        found = store.get_thread(thread_id)
        if found is None:
            raise ChatRequestError(404, "thread_not_found")
        thread, runs = found
        messages: list[dict[str, Any]] = []
        for r in runs:
            messages.append({"id": f"{r['id']}:user", "role": "user", "run_id": r["id"], "content": r["prompt"], "created_at": r["started_at"]})
            answer = render_run(r["messages"])
            messages.append(
                {
                    "id": f"{r['id']}:assistant", "role": "assistant", "run_id": r["id"], **answer,
                    "model": r["model"], "model_label": r["model_label"], "provider": r["provider"],
                    "provider_label": provider_label(r["provider"]), "reasoning_level": r["reasoning"],
                    "duration_ms": r["duration_ms"], "usage": _json(r["usage"]), "created_at": r["finished_at"],
                }
            )
        return {
            "id": thread["id"], "title": thread["title"], "created_at": thread["created_at"],
            "updated_at": thread["updated_at"], "messages": messages,
        }

    @app.delete("/api/threads/{thread_id}", status_code=204)
    async def delete_thread(thread_id: str) -> Response:
        if not store.delete_thread(thread_id):
            raise ChatRequestError(404, "thread_not_found")
        return Response(status_code=204)

    @app.get("/api/runs")
    async def list_runs(limit: int = Query(50, ge=1, le=200)) -> list[dict[str, Any]]:
        return [
            {
                "id": r["id"], "thread_id": r["thread_id"], "thread_title": r["thread_title"] or _title(r["prompt"]),
                "status": r["status"], "model": r["model"], "model_label": r["model_label"], "provider": r["provider"],
                "provider_label": provider_label(r["provider"]), "reasoning": r["reasoning"], "steps": _json(r["steps"]) or [],
                "started_at": r["started_at"], "finished_at": r["finished_at"], "duration_ms": r["duration_ms"],
                "error_code": r["error_code"], "usage": _json(r["usage"]),
            }
            for r in store.list_runs(limit)
        ]

    # ── 관리자 ──
    @app.get("/api/admin/models")
    async def admin_models() -> list[AdminModelRow]:
        # 캐시 없이: 게이트웨이가 방금 꺼졌으면 관리자 표 · 개요 카드가 바로 그렇게 말한다
        await registry.refresh(fresh=True)
        return admin_rows()

    @app.get("/api/admin/providers")
    async def admin_providers() -> list[dict[str, Any]]:
        return registry.providers()

    @app.patch("/api/admin/models/{gateway_id:path}")
    async def patch_model(gateway_id: str, body: ModelPatch) -> AdminModelRow:
        changes = body.model_dump(include=body.model_fields_set)
        if not changes:
            raise ModelPatchError(422, "empty_patch")
        for key in ("exposed", "order", "is_default"):
            if key in changes and changes[key] is None:
                raise ModelPatchError(422, f"bad_{key}")
        registry.patch(gateway_id, changes)
        return next(r for r in admin_rows() if r.id == gateway_id)

    @app.post("/api/admin/models/sync")
    async def sync_models() -> dict[str, Any]:
        result = await registry.refresh(fresh=True)
        assert result is not None  # fresh = 언제나 동기화
        return {
            "added": result.added, "missing": result.missing, "restored": result.restored,
            "first_sync": result.first_sync, "synced_at": result.synced_at, "models": admin_rows(),
        }

    @app.get("/api/admin/gateway")
    async def admin_gateway() -> dict[str, Any]:
        return {
            "kind": "litellm",
            "url": settings.gateway_url,
            "ui_url": settings.gateway_ui_url or f"{settings.gateway_url}/ui",  # LiteLLM Admin UI 에서 모델 추가 (등록은 거기서만)
            "last_sync_at": registry.last_sync_at(),
        }

    return app
