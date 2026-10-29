"""에이전트 루프 adapter. Pydantic AI · AG-UI 는 이 파일에서만 import 한다 (ADR-0002).

POST /api/chat 본문 = AG-UI RunAgentInput, 응답 = AG-UI SSE (RUN_STARTED → TEXT_MESSAGE_* → RUN_FINISHED | RUN_ERROR).
모델 = LiteLLM 프록시의 OpenAI 호환 /v1/chat/completions (LiteLLMProvider, api_base = LLM_GATEWAY_URL + /v1).
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable

from ag_ui.core import BaseEvent, RunErrorEvent
from openai import AsyncOpenAI
from pydantic import ValidationError
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelConnectionError, ModelHTTPError
from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.litellm import LiteLLMProvider
from pydantic_ai.ui.ag_ui import AGUIAdapter, AGUIEventStream
from starlette.requests import Request
from starlette.responses import Response

log = logging.getLogger("conductor.agent")

INSTRUCTIONS = "너는 BrewAI 의 conductor 에이전트다. 한국어로 짧고 정확하게 답한다."

ModelFactory = Callable[[str], Model]
ResolveModel = Callable[[str | None], Awaitable[str]]  # 요청한 모델 id → 허용된 모델 id (아니면 ChatRequestError)

# 스트림 중 오류는 RUN_ERROR 한 줄로. 게이트웨이 응답 본문·키는 내보내지 않는다 (eval 제약: 비밀 노출 0).
PUBLIC_ERRORS = {
    "gateway_auth_failed": "게이트웨이 인증에 실패했어요. 관리자에게 알려 주세요.",
    "provider_auth_failed": "이 모델의 API 키가 없거나 틀려요. 관리자에게 알려 주세요.",
    "gateway_unreachable": "모델 게이트웨이에 연결하지 못했어요.",
    "model_error": "모델이 응답하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
}


class ChatRequestError(Exception):
    """스트림을 열기 전에 거절 (400 등). app.py 가 JSON 으로 바꾼다."""

    def __init__(self, status: int, code: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code


def error_code(error: BaseException) -> str:
    # Pydantic AI 가 OpenAI SDK 오류를 ModelHTTPError · ModelConnectionError 로 감싸서 준다
    if isinstance(error, ModelHTTPError):
        if error.status_code == 400 and error.provider_error_type == "no_db_connection":
            return "gateway_auth_failed"  # LiteLLM config-only 모드: 틀린 게이트웨이 키 = 400 "No connected db."
        if error.status_code in (401, 403):
            # 게이트웨이 키는 스트림 전에 카탈로그 호출(같은 키)로 이미 통과했다 → 여기 401 = provider 키 (예: ANTHROPIC_API_KEY 없음)
            return "provider_auth_failed"
        if error.status_code == 500 and "Missing credentials" in str(error.body):
            # LiteLLM 1.106.2 는 OPENAI_API_KEY 없음을 401 이 아니라 500 "OpenAIException - Missing credentials" 로 준다.
            # 본문은 분류에만 쓰고 내보내지 않는다
            return "provider_auth_failed"
    if isinstance(error, ModelConnectionError):
        return "gateway_unreachable"
    return "model_error"


class _EventStream(AGUIEventStream):
    async def on_error(self, error: Exception) -> AsyncIterator[BaseEvent]:
        code = error_code(error)
        log.warning("chat run failed: %s (%s)", code, type(error).__name__)  # 본문·키는 안 찍는다
        async for event in super().on_error(error):
            if isinstance(event, RunErrorEvent):
                event = RunErrorEvent(message=PUBLIC_ERRORS[code], code=code, timestamp=event.timestamp)
            yield event


class _Adapter(AGUIAdapter):
    # 주의: 생성자 인자가 pydantic-ai 2.59 내부와 묶여 있다. 업그레이드 때 test_run_error_is_sanitized 가 잡는다.
    def build_event_stream(self) -> _EventStream:
        return _EventStream(
            self.run_input,
            accept=self.accept,
            ag_ui_version=self.ag_ui_version,
            manage_system_prompt=self.manage_system_prompt,
            preserve_file_data=self.preserve_file_data,
        )


class ChatRuntime:
    """Agent 하나 + 게이트웨이 provider 하나. 모델은 요청마다 고른다."""

    def __init__(self, *, gateway_url: str, gateway_key: str, model_factory: ModelFactory | None = None) -> None:
        # 재시도 0: 게이트웨이(num_retries 0)도 안 하고, 사용자는 '다시 시도' 버튼이 있다. 기본 2회면 실패가 3배 늦다.
        self._client = AsyncOpenAI(
            base_url=f"{gateway_url.rstrip('/')}/v1", api_key=gateway_key, max_retries=0, timeout=120.0
        )
        self._provider = LiteLLMProvider(openai_client=self._client)
        self._model_factory = model_factory or (lambda model_id: OpenAIChatModel(model_id, provider=self._provider))
        self.agent: Agent[None, str] = Agent(name="conductor", instructions=INSTRUCTIONS)

    async def __aenter__(self) -> ChatRuntime:  # 앱 수명 = provider HTTP 클라이언트 수명
        await self._provider.__aenter__()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self._provider.__aexit__(None, None, None)
        await self._client.close()

    async def handle(self, request: Request, resolve_model: ResolveModel) -> Response:
        try:
            adapter = await _Adapter.from_request(request, agent=self.agent)  # Content-Type ≠ application/json → 415
        except ValidationError as e:
            return Response(e.json(include_input=False), status_code=422, media_type="application/json")
        run_input = adapter.run_input
        if run_input.tools:
            raise ChatRequestError(400, "frontend_tools_not_allowed")  # 툴은 conductor 가 소유 (승인·정책)
        props = run_input.forwarded_props if isinstance(run_input.forwarded_props, dict) else {}
        requested = props.get("model")
        model_id = await resolve_model(requested if isinstance(requested, str) else None)
        log.info("chat run thread=%s run=%s model=%s", run_input.thread_id, run_input.run_id, model_id)
        return adapter.streaming_response(adapter.run_stream(model=self._model_factory(model_id)))
