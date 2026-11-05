"""외부 표면 /v1 = OpenAI 호환 (ADR-0017 · slice 12 1단계). 인증 = `Authorization: Bearer bwk_…` 만 (데스크톱 bwa_ · 관리자 쿠키는 거절).

  GET  /v1/models              노출된 대화 모델 (scope models:read 또는 chat) · {object: list, data: [{id, object: model, created, owned_by}]}
  POST /v1/chat/completions    scope chat · 노출된 대화 모델만 · stream 그대로 흘려보냄 (usage 마지막 조각 포함) · 모델 호출만
                               (도구 · 스킬 · MCP · 팀 · 로컬 폴더 없음 — 그건 2단계 에이전트 API · 승인 카드 뒤)
오류 = OpenAI 모양 {error: {message, type, code, param}} · 401 invalid_api_key | key_revoked | key_expired | user_disabled ·
       403 api_keys_off | scope_missing · 404 model_not_found · 429 key_limit_* + Retry-After · 502 gateway_* (원문 키 · 값은 안 싣는다)
conductor → LiteLLM = 서비스 키 (데스크톱 대화와 같은 클라이언트) · `user` = users.id · metadata.brewai_key_id.
사용량 = 호출 한 번 = usage_events 한 줄 (source api · key_id · 대화 기록 없음 · 숫자만).
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from openai import APIConnectionError, APIStatusError

from . import diagnose as dx
from . import usage
from .apikeys import ApiKeyError, KeyAuth, Keys

log = logging.getLogger("conductor.v1")

# 넘겨주는 칸 (나머지는 조용히 뺀다 · model · user · metadata 는 우리가 정한다)
PASS = (
    "messages", "temperature", "top_p", "max_tokens", "max_completion_tokens", "stream", "stop", "presence_penalty", "frequency_penalty",
    "seed", "response_format", "tools", "tool_choice", "parallel_tool_calls", "logprobs", "top_logprobs", "reasoning_effort", "n",
)
TIMEOUT_S = 300.0
BODY_MAX = 4 * 1024 * 1024


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def oai_error(status: int, code: str, message: str | None = None, *, retry_after: int | None = None) -> JSONResponse:
    kind = {401: "authentication_error", 403: "permission_error", 404: "invalid_request_error", 429: "rate_limit_error"}.get(
        status, "invalid_request_error" if status < 500 else "api_error")
    headers = {"Retry-After": str(retry_after)} if retry_after else None
    return JSONResponse({"error": {"message": message or code, "type": kind, "code": code, "param": None}}, status_code=status, headers=headers)


MESSAGES = {
    "invalid_api_key": "API 키가 올바르지 않아요 (Authorization: Bearer bwk_…)",
    "key_revoked": "폐기된 API 키예요", "key_expired": "만료된 API 키예요", "user_disabled": "키 주인 계정이 정지됐어요",
    "api_keys_off": "관리자가 API 키를 꺼 두었어요", "scope_missing": "이 키의 범위로는 할 수 없어요",
    "model_not_found": "쓸 수 있는 모델이 아니에요 (GET /v1/models)", "key_limit_rpm": "분당 요청 한도를 넘었어요",
    "key_limit_tokens": "오늘 토큰 한도를 넘었어요", "key_limit_cost": "이번 달 비용 한도를 넘었어요",
    "bad_request": "요청 본문이 올바르지 않아요 (JSON · model · messages)",
}


def register(external: APIRouter, *, keys: Keys, registry: Any, runtime: Any, store: Any) -> None:
    def auth(request: Request, *scopes: str) -> KeyAuth | JSONResponse:
        header = request.headers.get("authorization") or ""
        scheme, _, token = header.partition(" ")
        try:
            got = keys.verify(token.strip() if scheme.lower() == "bearer" else None)
        except ApiKeyError as e:
            return oai_error(e.status, e.code, MESSAGES.get(e.code))
        if not any(s in got.scopes for s in scopes):
            return oai_error(403, "scope_missing", MESSAGES["scope_missing"])
        return got

    def gateway_info(model: str) -> dict[str, Any]:
        rows = store.query("SELECT gateway_info FROM model_exposure WHERE gateway_id = ?", (model,))
        try:
            info = json.loads(rows[0]["gateway_info"] or "{}") if rows else {}
        except ValueError:
            info = {}
        return info if isinstance(info, dict) else {}

    def record(k: KeyAuth, row: Any, started: str, t0: float, status: str, used: dict[str, Any] | None, code: str | None) -> None:
        ev = {
            "run_id": f"api-{uuid.uuid4()}", "started_at": started, "finished_at": _now(), "status": status, "error_code": code,
            "user_id": k.user_id, "org_id": k.org_id, "key_id": k.key_id, "model": row.gateway_id, "model_label": row.label,
            "provider": row.provider, "duration_ms": int((time.monotonic() - t0) * 1000), "usage": used,
        }
        try:
            with store.tx() as db:
                usage.record_api(db, ev, gateway_info(row.gateway_id))
        except Exception:  # 기록 실패가 응답을 망치지 않게 (로그만)
            log.exception("v1 usage record failed: key=%s", k.key_id)

    @external.get("/v1/models")
    async def list_models(request: Request) -> Response:
        k = auth(request, "models:read", "chat")
        if isinstance(k, JSONResponse):
            return k
        await registry.refresh()
        data = [{"id": r.gateway_id, "object": "model", "created": 0, "owned_by": r.provider} for r in registry.exposed()]
        return JSONResponse({"object": "list", "data": data})

    @external.post("/v1/chat/completions")
    async def chat_completions(request: Request) -> Response:
        k = auth(request, "chat")
        if isinstance(k, JSONResponse):
            return k
        raw = await request.body()
        try:
            body = json.loads(raw) if len(raw) <= BODY_MAX else None
        except ValueError:
            body = None
        if not isinstance(body, dict) or not isinstance(body.get("model"), str) or not isinstance(body.get("messages"), list) or not body["messages"]:
            return oai_error(400, "bad_request", MESSAGES["bad_request"])
        await registry.refresh()
        row = next((r for r in registry.exposed() if r.gateway_id == body["model"]), None)
        if row is None:
            return oai_error(404, "model_not_found", MESSAGES["model_not_found"])
        try:
            keys.check_limits(k)
        except ApiKeyError as e:
            return oai_error(e.status, e.code, MESSAGES.get(e.code), retry_after=e.retry_after)
        params = {x: body[x] for x in PASS if x in body}
        stream = params.get("stream") is True
        extra: dict[str, Any] = {"metadata": {"brewai_key_id": k.key_id}}
        if stream:
            params["stream_options"] = {"include_usage": True}  # 마지막 조각에 토큰 (사용량 · 한도)
        started, t0 = _now(), time.monotonic()
        client = runtime.client
        try:
            out = await client.chat.completions.create(model=row.gateway_id, user=k.user_id, extra_body=extra, timeout=TIMEOUT_S, **params)
        except APIStatusError as e:
            d = dx.classify_http(e.status_code, getattr(e, "type", None), e.body)
            record(k, row, started, t0, "error", None, d.code)
            status = e.status_code if 400 <= e.status_code < 500 and e.status_code not in (401, 403) else 502
            return oai_error(status, d.code, d.code)
        except APIConnectionError:
            record(k, row, started, t0, "error", None, "gateway_unreachable")
            return oai_error(502, "gateway_unreachable", "게이트웨이에 닿지 못했어요")
        if not stream:
            data = out.model_dump(mode="json", exclude_none=True)
            data["model"] = row.gateway_id
            record(k, row, started, t0, "ok", data.get("usage"), None)
            return JSONResponse(data)

        async def events() -> AsyncIterator[bytes]:
            used: dict[str, Any] | None = None
            status, code = "cancelled", None
            try:
                async for chunk in out:
                    piece = chunk.model_dump(mode="json", exclude_none=True)
                    piece["model"] = row.gateway_id
                    if piece.get("usage"):
                        used = piece["usage"]
                    yield f"data: {json.dumps(piece, ensure_ascii=False)}\n\n".encode()
                yield b"data: [DONE]\n\n"
                status = "ok"
            except (APIStatusError, APIConnectionError) as e:
                status, code = "error", "gateway_error" if isinstance(e, APIStatusError) else "gateway_unreachable"
                err = {"error": {"message": code, "type": "api_error", "code": code, "param": None}}
                yield f"data: {json.dumps(err)}\n\n".encode()
            finally:
                record(k, row, started, t0, status, used, code)

        return StreamingResponse(events(), media_type="text/event-stream", headers={"cache-control": "no-cache", "x-accel-buffering": "no"})
