"""conductor HTTP API (FastAPI). 실행: npm run api (= uv run --env-file .env uvicorn --factory conductor.app:create_app --host 127.0.0.1 --port 8787)

인증 (ADR-0010 · 라우터 단위로 붙인다 = 경로마다 잊을 수 없다 · tests/test_auth.py 가 경로 표 전체를 두드린다)
  공개   GET /healthz · /api/auth/*(login · token · state · invite/preview · signup · reset · google/*) · POST /api/admin/auth/login
  사용자 그 밖의 /api/* = `Authorization: Bearer bwa_…` 만 (api_auth.py · api_spaces.py · 아래)
  관리자 /api/admin/* = 관리자 쿠키 + X-CSRF-Token + instance admin (api_admin.py · 아래). 오류 = {detail: code}
데스크톱 (CORS = 데스크톱 출처만 · Bearer)
  GET    /healthz                    살아 있음 (게이트웨이는 안 부른다)
  GET    /api/models                 노출 모델만 · 기본 모델이 첫 항목(is_default) · 나머지는 관리자 순서
                                     + source(config|ui|mixed|null = 등록 출처) · health(ok|error|unknown) · health_code · health_at
                                       (마지막 연결 결과. error 여도 목록에 남고 고를 수 있다 — 화면은 경고만)
  GET    /api/tools                  conductor 툴 [{name, label, description}] (활동 단계 tool:<name> 의 화면 이름)
  GET    /api/skills                 제품 스킬 (runtime/skills) [{name, label, description, tools, builtin, used}] (단계 skill:<name>)
  POST   /api/chat                   AG-UI RunAgentInput → AG-UI SSE (agent.py 머리말 = 이벤트 순서)
                                     forwardedProps.spaceId · projectId = 새 대화만 (없으면 내 스페이스) · 기존 대화는 DB 값
                                     남의 대화 = 404 thread_not_found · 공유된 남의 대화에 이어 쓰기 = 403 forbidden
  GET    /api/scopes                 범위 계층 표 [{kind, parent, optional, membership, tenant, item}] (scopes.py)
  GET    /api/threads?space=&project=<id|none>&limit=   한 스페이스의 내 대화 + 공유된 대화 (space 없으면 내 스페이스)
                                     + space_id · project_id · visibility · user_id · owner_name · mine
                                     · path = [{kind, id, name}] 위 → 아래 (조직 · 스페이스 · 프로젝트? · 대화)
  GET    /api/threads/{id}           대화 기록 (완료된 턴만) + 위 범위 칸 · path · can_edit
  PATCH  /api/threads/{id}           {title?, visibility?: private|shared, project_id?: id|null} (만든 사람만 · 내 스페이스 공유 = 409
                                     personal_space · 다른 스페이스 프로젝트 = 409 project_in_other_space)
  DELETE /api/threads/{id}           대화 지우기 (204 · 만든 사람만)
  GET    /api/runs?space=            내 최근 실행 (진행 상황 화면: 상태 · 모델 · 단계 · 걸린 시간) + path (그 대화의 경로)
관리자 (같은 출처 Vite proxy · 쿠키 + CSRF, ADR-0006 — 모델 등록은 LiteLLM 에서만)
  GET    /api/admin/models           모든 모델 (노출 · 후보 · 숨김 · 사라짐) + 게이트웨이 값 (읽기 전용) + source (등록 출처)
  GET    /api/admin/providers        provider 별 개수
  PATCH  /api/admin/models/{id}      exposed · display_name · order · is_default 만
                                     칸 값이 틀리면 422 {detail: bad_<칸>} · 모르는 칸 = 422 (FastAPI 기본 목록)
  관리자 경로에 관리자 출처가 아닌 Origin 이 붙은 요청 = 403 origin_not_allowed (쿠키 · CSRF 전에)
  POST   /api/admin/models/sync      게이트웨이에서 다시 읽기
  POST   /api/admin/models/{id}/test 연결 테스트 = 짧은 호출 한 번 → {ok, code, detail, status, at, duration_ms = 응답 시간} (결과는 model_health 에)
  GET    /api/admin/skills           스킬 카탈로그 (읽기 전용: 출처 runtime/skills · 버전 = sha256 앞 12자) + 읽지 못한 스킬
  GET    /api/admin/gateway          게이트웨이 주소 · LiteLLM Admin UI 링크 ('LiteLLM 에서 추가')
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
import time
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from typing import Any, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, FastAPI, Query, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from . import api_admin, api_auth, api_spaces
from .agent import ChatRequest, ChatRequestError, ChatRuntime, RunScope, render_run
from .auth import policy
from .auth.accounts import Accounts, AuthFailed, Principal
from .auth.directory import Directory
from .auth.google import GoogleOIDC
from .auth.guard import Guard
from .auth.http import auth_failed_response, require_admin, require_user
from .auth.policy import Denied
from .diagnose import MODEL_HEALTH_CODES
from .gateway import GatewayCatalogPort, GatewayError, LiteLLMCatalog
from .models import ExposureRow, ModelChoice, ModelPatchError, ModelRegistry
from .providers import provider_label
from .scopes import Crumb, Scopes, describe
from .settings import Settings, load_settings
from .skills import load_skills
from .store import Store, StoreConflict
from .tools import BUILTIN_TOOLS

ADMIN_PREFIX = "/api/admin/"
TITLE_CHARS = 80
log = logging.getLogger("conductor.app")
# 접근 로그에서 가릴 쿼리 값 (Google 콜백 code · state · handoff · 연결 표)
_SECRET_QUERY = re.compile(r"([?&](?:code|state|token|access_token|refresh_token|link|invite|ds|cc)=)[^&\s]*", re.IGNORECASE)


class RedactQuery(logging.Filter):
    """uvicorn.access 의 경로 인자에서 비밀 쿼리 값을 '***' 로 (레코드 args = (client, method, path, http, status))."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and len(record.args) >= 3 and isinstance(record.args[2], str):
            record.args = (*record.args[:2], _SECRET_QUERY.sub(r"\1***", record.args[2]), *record.args[3:])
        return True


def redact_access_log() -> None:
    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, RedactQuery) for f in access.filters):
        access.addFilter(RedactQuery())


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
    max_output_tokens: int | None = None
    source: Literal["config", "ui", "mixed"] | None = None  # 등록 출처 (LiteLLM model_info.db_model) · None = 모름
    # 연결 상태 (대화 결과 · 관리자 연결 시험 중 나중 것). error 여도 고를 수 있다 — 화면은 경고만
    health: Literal["ok", "error", "unknown"] = "unknown"
    health_code: str | None = None  # 실패 이유 = diagnose detail (없으면 공개 code)
    health_at: str | None = None


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
    source: Literal["config", "ui", "mixed"] | None = None  # 등록 출처: config.yaml · LiteLLM 관리 화면(DB) · 둘 다
    # ↓ 연결 상태 (conductor 가 본 것: 채팅 결과 · 연결 시험). last_error_code = diagnose detail (없으면 공개 code)
    last_ok_at: str | None = None
    last_error_code: str | None = None
    last_error_at: str | None = None


class ModelPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    exposed: StrictBool | None = None
    display_name: str | None = Field(default=None, max_length=200)  # null = 기본 이름으로
    order: StrictInt | None = Field(default=None, ge=1, le=100_000)
    is_default: StrictBool | None = None


PATCH_FIELDS = frozenset(ModelPatch.model_fields)


class ThreadPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, max_length=200)
    visibility: Literal["private", "shared"] | None = None
    project_id: str | None = Field(default=None, max_length=64)  # null = 프로젝트 없음


class ScopedCORS:
    """CORS 를 경로로 나눈다: /api/admin/* = 관리자 출처만, 나머지 = 데스크톱 출처만 (사용자 앱 ↔ 관리자 분리).
    CORS 는 응답 읽기만 막고 단순 요청은 서버에서 돈다 → 관리자 경로는 다른 Origin 을 아예 거절.
    Origin 없는 요청(curl · 같은 출처 proxy)은 여기선 통과 — 관리자 경로는 쿠키 + CSRF 가 없으면 401/403 (auth/http.py)."""

    def __init__(self, app: ASGIApp, *, desktop_origins: Sequence[str], admin_origins: Sequence[str]) -> None:
        self._desktop = CORSMiddleware(
            app, allow_origins=list(desktop_origins), allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
            allow_headers=["content-type", "accept", "authorization"], max_age=600,
        )
        self._admin = CORSMiddleware(
            app, allow_origins=list(admin_origins), allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
            allow_headers=["content-type", "accept", "x-csrf-token"], allow_credentials=True, max_age=600,
        )
        self._admin_origins = frozenset(admin_origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        admin = scope["type"] == "http" and scope["path"].startswith(ADMIN_PREFIX)
        if admin and "*" not in self._admin_origins:
            origin = next((v.decode("latin-1") for k, v in scope["headers"] if k == b"origin"), None)
            if origin is not None and origin not in self._admin_origins:
                await JSONResponse({"detail": "origin_not_allowed"}, status_code=403)(scope, receive, send)
                return
        await (self._admin if admin else self._desktop)(scope, receive, send)


def _source(r: ExposureRow) -> Any:
    s = r.info.get("source")
    return s if s in ("config", "ui", "mixed") else None


def _health(h: Any) -> tuple[str, str | None, str | None]:
    """(ok | error | unknown, 실패 code, 시각). 실패가 마지막 성공보다 나중이면 error."""
    if not h:
        return "unknown", None, None
    ok, err = h["last_ok_at"], h["last_error_at"]
    if err and (not ok or err > ok):
        return "error", h["last_error_code"], err
    return ("ok", None, ok) if ok else ("unknown", None, None)


def _model_out(r: ExposureRow, default: str | None, health: Any = None) -> ModelOut:
    state, code, at = _health(health)
    return ModelOut(
        max_output_tokens=r.info.get("max_output_tokens"), source=_source(r), health=state, health_code=code, health_at=at,
        id=r.gateway_id, label=r.label, provider=r.provider, provider_label=r.provider_label, family=r.family,
        is_default=r.gateway_id == default, supports_reasoning=bool(r.info.get("supports_reasoning")),
        supports_tools=bool(r.info.get("supports_function_calling")), supports_vision=bool(r.info.get("supports_vision")),
        max_input_tokens=r.info.get("max_input_tokens"),
    )


def _admin_row(r: ExposureRow, order: int, default: str | None, health: Any = None) -> AdminModelRow:
    i = r.info
    h = health or {}
    return AdminModelRow(
        last_ok_at=h["last_ok_at"] if health else None, last_error_code=h["last_error_code"] if health else None,
        last_error_at=h["last_error_at"] if health else None,
        id=r.gateway_id, label=r.label, display_name=r.display_name, default_label=r.default_label, family=r.family,
        provider=r.provider, provider_label=r.provider_label, provider_ids=list(r.providers), state=r.state, status=r.status,
        exposed=r.state == "exposed", is_default=r.gateway_id == default, order=order, is_chat=r.is_chat,
        first_seen=r.first_seen, last_seen=r.last_seen, providers=[str(p) for p in i.get("providers") or ()],
        mode=i.get("mode"), max_input_tokens=i.get("max_input_tokens"), max_output_tokens=i.get("max_output_tokens"),
        input_cost_per_token=i.get("input_cost_per_token"), output_cost_per_token=i.get("output_cost_per_token"),
        supports_function_calling=bool(i.get("supports_function_calling")), supports_vision=bool(i.get("supports_vision")),
        supports_reasoning=bool(i.get("supports_reasoning")), source=_source(r),
    )


def _title(prompt: str) -> str:
    line = next((ln.strip() for ln in prompt.splitlines() if ln.strip()), prompt.strip())
    return line if len(line) <= TITLE_CHARS else line[: TITLE_CHARS - 1] + "…"


def _json(value: str | None) -> Any:
    return json.loads(value) if value else None


class _Sink:
    """실행 기록 = runs 표 (agent.RunSink)."""

    def __init__(self, store: Store, req: ChatRequest, model_id: str) -> None:
        self._store = store
        self._req = req
        self._model = model_id

    def steps_changed(self, steps: list[dict[str, Any]]) -> None:
        self._store.update_steps(self._req.run_id, steps)

    def finish(self, *, status, steps, duration_ms, messages, usage, error_code, error_detail) -> None:  # type: ignore[no-untyped-def]
        self._store.finish_run(
            self._req.run_id, status=status, steps=steps, duration_ms=duration_ms, messages=messages, usage=usage,
            error_code=error_code, title=_title(self._req.prompt),
        )
        # 관리자 모델 표의 '연결' 칸: 성공 · 모델 탓인 실패만 (멈춤 · 단계 초과 · 서버 오류는 안 남긴다)
        if status == "done":
            self._store.record_model_result(self._model, error_code=None, source="chat")
        elif status == "error" and error_code in MODEL_HEALTH_CODES:
            self._store.record_model_result(self._model, error_code=error_detail or error_code, source="chat")


def _thread_out(t: Any, user_id: str, path: list[Crumb]) -> dict[str, Any]:
    return {
        "id": t["id"], "title": t["title"], "created_at": t["created_at"], "updated_at": t["updated_at"],
        "turns": t["turns"], "last_model": t["last_model"], "running": bool(t["running"]),
        "space_id": t["space_id"], "project_id": t["project_id"], "visibility": t["visibility"],
        "user_id": t["user_id"], "owner_name": t["owner_name"], "mine": t["user_id"] == user_id, "path": path,
    }


def create_app(
    settings: Settings | None = None,
    *,
    catalog: GatewayCatalogPort | None = None,
    runtime: ChatRuntime | None = None,
    store: Store | None = None,
    google: GoogleOIDC | None = None,
) -> FastAPI:
    settings = settings or load_settings()
    catalog = catalog or LiteLLMCatalog(settings.gateway_url, settings.gateway_key, ttl_s=settings.catalog_ttl_s)
    runtime = runtime or ChatRuntime(
        gateway_url=settings.gateway_url,
        gateway_key=settings.gateway_key,
        skills=load_skills(settings.skills_dir, known_tools=[t.name for t in BUILTIN_TOOLS]),
    )
    store = store or Store(settings.db_path)
    registry = ModelRegistry(store, catalog, bootstrap=settings.bootstrap_models, default_model=settings.default_model)
    test_admin = settings.test_admin_active
    accounts = Accounts(store, password_min=settings.password_min, test_login=test_admin)
    directory = Directory(accounts)
    scopes = Scopes(store)
    guard = Guard(directory, scopes)
    google = google or GoogleOIDC(settings)
    # .env 첫 관리자 (users 가 비었을 때만) → 테스트 관리자 admin / admin (켜져 있으면 · .env 값이 없으면 그가 첫 관리자)
    if not (test_admin and not settings.admin_email):
        directory.bootstrap(settings.admin_email, settings.admin_password)
    if test_admin:
        directory.ensure_test_admin()
    else:
        if settings.test_admin:
            log.warning("BREWAI_TEST_ADMIN 을 무시해요: CONDUCTOR_PUBLIC_URL · CONDUCTOR_ADMIN_URL 이 이 PC(loopback) 주소가 아니에요")
        if settings.test_admin_lock:
            directory.lock_test_admin()
    redact_access_log()

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
        await google.aclose()

    # /docs·/redoc 끔 (CDN 스크립트를 부른다). /openapi.json 은 둔다.
    app = FastAPI(title="BrewAI conductor", version="0.0.0", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.add_middleware(ScopedCORS, desktop_origins=settings.desktop_origins, admin_origins=settings.admin_origins)
    # DNS rebinding 막기: Host 가 이 PC 이름(또는 운영 도메인)일 때만 (conductor 는 게이트웨이 키를 쥔다)
    hosts = {"127.0.0.1", "localhost"} | {h for h in (urlsplit(settings.public_url).hostname, urlsplit(settings.admin_url).hostname) if h}
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=sorted(hosts))
    app.state.store = store
    app.state.registry = registry
    app.state.settings = settings
    app.state.accounts = accounts
    app.state.directory = directory
    app.state.scopes = scopes
    app.state.guard = guard

    # 라우터 3개 = 인증 3종류. 경로는 반드시 이 중 하나에 (app 에 직접 붙이지 않는다 · /healthz 만 예외)
    public = APIRouter()
    user = APIRouter(dependencies=[Depends(require_user)])
    admin = APIRouter(dependencies=[Depends(require_admin)])

    @app.exception_handler(GatewayError)
    async def _gateway_error(_: Request, e: GatewayError) -> JSONResponse:
        return JSONResponse({"detail": e.code}, status_code=503 if e.code == "gateway_unreachable" else 502)

    @app.exception_handler(ChatRequestError)
    async def _chat_error(_: Request, e: ChatRequestError) -> JSONResponse:
        return JSONResponse({"detail": e.code}, status_code=e.status)

    @app.exception_handler(ModelPatchError)
    async def _patch_error(_: Request, e: ModelPatchError) -> JSONResponse:
        return JSONResponse({"detail": e.code}, status_code=e.status)

    @app.exception_handler(AuthFailed)
    async def _auth_failed(_: Request, e: AuthFailed) -> JSONResponse:
        return auth_failed_response(e)

    @app.exception_handler(Denied)
    async def _denied(_: Request, e: Denied) -> JSONResponse:
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
        health = store.model_health()
        return [_admin_row(r, i, default, health.get(r.gateway_id)) for i, r in enumerate(rows, 1)]

    def skill_rows() -> list[dict[str, Any]]:
        used = store.skill_usage()
        return [s.row() | {"used": used.get(s.name, 0)} for s in runtime.skills.list()]

    def thread_out(row: Any, p: Principal) -> dict[str, Any]:
        return _thread_out(row, p.user_id, scopes.path("thread", row["id"]))

    # ── 공개 ──
    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    # ── 데스크톱 (Bearer) ──
    @user.get("/api/models")
    async def list_models() -> list[ModelOut]:
        await registry.refresh()  # 카탈로그 캐시(30초)가 바뀌었을 때만 DB 동기화
        shown = registry.exposed()  # 관리자 순서 그대로 (기본 모델도 제자리)
        default = registry.default_id()
        health = store.model_health()
        return [_model_out(r, default, health.get(r.gateway_id)) for r in shown]

    @user.get("/api/scopes")
    async def list_scopes() -> dict[str, Any]:
        return {"levels": describe()}

    @user.get("/api/tools")
    async def list_tools() -> list[dict[str, str]]:
        return [{"name": t.name, "label": t.label, "description": t.description} for t in runtime.tools]

    @user.get("/api/skills")
    async def list_skills() -> list[dict[str, Any]]:
        keys = ("name", "label", "description", "tools", "builtin", "used")
        return [{k: r[k] for k in keys} for r in skill_rows()]

    @user.post("/api/chat")
    async def chat(request: Request, p: Principal = Depends(require_user)) -> Response:
        async def prepare(req: ChatRequest) -> tuple[ModelChoice, list[str], _Sink, RunScope]:
            # 범위 먼저 (모델보다): 남의 대화 = 404 · 공유된 남의 대화에 이어 쓰기 = 403 · 보관된 스페이스 = 409
            existing = store.thread_row(req.thread_id)
            if existing is not None:
                _, tf = guard.thread(p.actor, req.thread_id, "owner")
                space = tf.space
                project = directory.project(existing["project_id"])
            else:
                space = guard.space(p.actor, req.space_id)
                project = guard.project_in(p.actor, req.project_id, space) if req.project_id else None
            policy.require_space_writable(p.actor, space)
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
                    user_id=p.user_id, space_id=space.id, org_id=space.org_id, project_id=project["id"] if project else None,
                )
            except StoreConflict as e:
                raise ChatRequestError(404 if e.code == "thread_not_found" else 409, e.code) from e
            instructions = (
                f"이 대화는 프로젝트 '{project['name']}' 안에 있다. 아래 프로젝트 지침을 따른다 (위 규칙이 우선).\n{project['instructions']}"
                if project is not None and project["instructions"] else None
            )
            scope = RunScope(user_id=p.user_id, space_id=space.id, project_id=project["id"] if project else None, instructions=instructions)
            return choice, blobs, _Sink(store, req, choice.id), scope

        return await runtime.handle(request, prepare)

    @user.get("/api/threads")
    async def list_threads(
        space: str | None = Query(None, max_length=64), project: str | None = Query(None, max_length=64),
        limit: int = Query(50, ge=1, le=200), p: Principal = Depends(require_user),
    ) -> list[dict[str, Any]]:
        facts = guard.space(p.actor, space)
        if project not in (None, "none") and scopes.ancestor("project", project) != facts.id:
            raise Denied(404, "project_not_found")  # 다른 스페이스의 프로젝트 = 없는 것과 같다
        rows = store.list_threads(
            user_id=p.user_id, space_id=facts.id, project_id=None if project in (None, "none") else project,
            no_project=project == "none", limit=limit,
        )
        paths = scopes.paths("thread", [t["id"] for t in rows])
        return [_thread_out(t, p.user_id, paths.get(t["id"], [])) for t in rows]

    @user.get("/api/threads/{thread_id}")
    async def get_thread(thread_id: str, p: Principal = Depends(require_user)) -> dict[str, Any]:
        thread, _ = guard.thread(p.actor, thread_id)
        messages: list[dict[str, Any]] = []
        for r in store.thread_runs(thread_id):
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
        out = thread_out(thread, p)
        keys = ("id", "title", "created_at", "updated_at", "space_id", "project_id", "visibility", "user_id", "owner_name", "mine", "path")
        return {k: out[k] for k in keys} | {"can_edit": out["mine"], "messages": messages}

    @user.patch("/api/threads/{thread_id}")
    async def patch_thread(thread_id: str, body: ThreadPatch, p: Principal = Depends(require_user)) -> dict[str, Any]:
        _, facts = guard.thread(p.actor, thread_id, "owner")
        changes: dict[str, Any] = {}
        if body.title is not None:
            title = " ".join(body.title.split())
            if not title or len(title) > TITLE_CHARS:
                raise Denied(422, "bad_title")
            changes["title"] = title
        if body.visibility is not None:
            if body.visibility == "shared" and not policy.can_share(facts):
                raise Denied(409, "personal_space")  # 내 스페이스엔 멤버가 없다
            changes["visibility"] = body.visibility
        if "project_id" in body.model_fields_set:
            changes["project_id"] = guard.project_in(p.actor, body.project_id, facts.space)["id"] if body.project_id else None
        if changes:
            policy.require_space_writable(p.actor, facts.space)
            store.update_thread(thread_id, changes)
        return thread_out(store.thread_row(thread_id), p)

    @user.delete("/api/threads/{thread_id}", status_code=204)
    async def delete_thread(thread_id: str, p: Principal = Depends(require_user)) -> Response:
        guard.thread(p.actor, thread_id, "owner")
        if not store.delete_thread(thread_id):
            raise Denied(404, "thread_not_found")
        return Response(status_code=204)

    @user.get("/api/runs")
    async def list_runs(
        space: str | None = Query(None, max_length=64), limit: int = Query(50, ge=1, le=200), p: Principal = Depends(require_user),
    ) -> list[dict[str, Any]]:
        space_id = guard.space(p.actor, space).id if space else None
        rows = store.list_runs(user_id=p.user_id, space_id=space_id, limit=limit)
        paths = scopes.paths("thread", [r["thread_id"] for r in rows])
        return [
            {
                "id": r["id"], "thread_id": r["thread_id"], "thread_title": r["thread_title"] or _title(r["prompt"]),
                "space_id": r["space_id"], "project_id": r["project_id"],
                "status": r["status"], "model": r["model"], "model_label": r["model_label"], "provider": r["provider"],
                "provider_label": provider_label(r["provider"]), "reasoning": r["reasoning"], "steps": _json(r["steps"]) or [],
                "started_at": r["started_at"], "finished_at": r["finished_at"], "duration_ms": r["duration_ms"],
                "error_code": r["error_code"], "usage": _json(r["usage"]), "path": paths.get(r["thread_id"], []),
            }
            for r in rows
        ]

    # ── 관리자 (쿠키 + CSRF + instance admin) ──
    @admin.get("/api/admin/models")
    async def admin_models() -> list[AdminModelRow]:
        # 캐시 없이: 게이트웨이가 방금 꺼졌으면 관리자 표 · 개요 카드가 바로 그렇게 말한다
        await registry.refresh(fresh=True)
        return admin_rows()

    @admin.get("/api/admin/providers")
    async def admin_providers() -> list[dict[str, Any]]:
        return registry.providers()

    @admin.patch("/api/admin/models/{gateway_id:path}")
    async def patch_model(gateway_id: str, body: ModelPatch) -> AdminModelRow:
        changes = body.model_dump(include=body.model_fields_set)
        if not changes:
            raise ModelPatchError(422, "empty_patch")
        for key in ("exposed", "order", "is_default"):
            if key in changes and changes[key] is None:
                raise ModelPatchError(422, f"bad_{key}")
        registry.patch(gateway_id, changes)
        return next(r for r in admin_rows() if r.id == gateway_id)

    @admin.post("/api/admin/models/sync")
    async def sync_models() -> dict[str, Any]:
        result = await registry.refresh(fresh=True)
        assert result is not None  # fresh = 언제나 동기화
        return {
            "added": result.added, "missing": result.missing, "restored": result.restored,
            "first_sync": result.first_sync, "synced_at": result.synced_at, "models": admin_rows(),
        }

    @admin.post("/api/admin/models/{gateway_id:path}/test")
    async def test_model(gateway_id: str) -> dict[str, Any]:
        row = next((r for r in registry.rows() if r.gateway_id == gateway_id), None)
        if row is None:
            raise ModelPatchError(404, "model_not_found")
        if row.status == "missing":
            raise ModelPatchError(409, "model_missing")
        if not row.is_chat:
            raise ModelPatchError(409, "not_chat_model")
        started = time.monotonic()
        result = await runtime.probe(gateway_id)  # 숨긴 모델·후보도 시험할 수 있다 (노출 전에 확인)
        duration_ms = int((time.monotonic() - started) * 1000)  # 응답 시간 = 게이트웨이 왕복만 (기록 쓰기 전)
        code = None if result is None else (result.detail or result.code)
        at = store.record_model_result(gateway_id, error_code=code, source="probe")
        return {
            "model": gateway_id, "ok": result is None, "code": None if result is None else result.code,
            "detail": None if result is None else result.detail, "status": None if result is None else result.status,
            "at": at, "duration_ms": duration_ms,
        }

    @admin.get("/api/admin/skills")
    async def admin_skills() -> dict[str, Any]:
        return {"source": runtime.skills.source, "skills": skill_rows(), "errors": runtime.skills.errors}

    @admin.get("/api/admin/gateway")
    async def admin_gateway() -> dict[str, Any]:
        return {
            "kind": "litellm",
            "url": settings.gateway_url,
            "ui_url": settings.gateway_ui_url or f"{settings.gateway_url}/ui",  # LiteLLM Admin UI 에서 모델 추가 (등록은 거기서만)
            "last_sync_at": registry.last_sync_at(),
        }

    api_auth.register(public, user, admin, settings=settings, google=google)
    api_spaces.register(user)
    api_admin.register(admin)
    for router in (public, user, admin):
        app.include_router(router)
    return app
