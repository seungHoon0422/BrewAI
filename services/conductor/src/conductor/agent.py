"""에이전트 루프 adapter. Pydantic AI · AG-UI 는 이 파일에서만 import 한다 (ADR-0002).

POST /api/chat 본문 = AG-UI RunAgentInput, 응답 = AG-UI SSE. 이벤트 순서 (계약 · docs 는 app.py 머리말):
  RUN_STARTED → CUSTOM brewai.run → (STEP_STARTED thinking → REASONING_* → STEP_FINISHED)?
  → (STEP_STARTED tool:<name> → TOOL_CALL_START/ARGS/END → TOOL_CALL_RESULT → STEP_FINISHED)*
  병렬 툴 = 한 모델 응답에 tool_calls 여럿 → 단계가 겹친다: STEP_STARTED a · START/ARGS/END a · STEP_STARTED b · … → 둘이 동시에 돌고
  결과는 끝나는 순서대로 (TOOL_CALL_RESULT x → STEP_FINISHED x). 순서 보장 = 같은 call id 안에서만 (START → ARGS → END → RESULT).
  단계 기록(steps)의 툴 단계엔 call_id · batch (같은 응답 = 같은 batch) — 화면이 '동시에 n개' 로 묶는다. 동시 실행 상한 · 툴 시간 제한은 아래 상수.
  → STEP_STARTED writing → TEXT_MESSAGE_START/CONTENT…/END → STEP_FINISHED → CUSTOM brewai.run_summary → RUN_FINISHED
  스킬 = (STEP_STARTED skill:<스킬> → TOOL_CALL_START use_skill …/RESULT → STEP_FINISHED) — 툴 단계 이름이 tool:use_skill 대신 skill:<이름>
  실패 = … → STEP_FINISHED → RUN_ERROR {code, message, detail?} (마지막 이벤트. detail = diagnose.py DETAILS · 화면 안내용)
  생각 이벤트 = ag-ui-protocol 0.1.22 의 REASONING_START · REASONING_MESSAGE_START{role:"reasoning"} · REASONING_MESSAGE_CONTENT{delta}
  · REASONING_MESSAGE_END · (REASONING_ENCRYPTED_VALUE — 화면은 무시) · REASONING_END (Pydantic AI AG-UI adapter 2.59 가 낸다)
  생각 글 경로 (LiteLLM 1.106.2 확인 · tests/test_chat.py test_litellm_*): reasoning_effort → LiteLLM 이 Claude adaptive 모델에
  thinking {type: adaptive, display: summarized} + output_config.effort 로 바꾼다 → thinking_delta 가 delta.reasoning_content 로 오고
  Pydantic AI 가 ThinkingPart → REASONING_* 로 낸다. 생각 끄기·display omitted·redacted 면 글 없이 서명만 → 이벤트 없음.
  brewai.run_summary.usage.reasoning_tokens (추가) = 생각 토큰 (글이 없어도 >0 이면 '생각은 했지만 내용은 안 보냄').
모델 = LiteLLM 프록시의 OpenAI 호환 /v1/chat/completions (LiteLLMProvider, api_base = LLM_GATEWAY_URL + /v1).
멀티턴 = 서버가 원본: 클라이언트가 보낸 messages 중 마지막 user 메시지만 쓰고, 앞 대화는 저장된 기록(message_history)으로.
범위 = forwardedProps.spaceId · projectId (새 대화만 · 판정은 app.py prepare). 프로젝트 지침은 시스템 프롬프트 '뒤'에 붙는다
(conductor 규칙을 덮지 못하게) · LiteLLM 요청 `user` = users.id (ADR-0011).
MCP 앱 (ADR-0013 · slice 05 · 판단은 connectors/session.py · 여기는 Pydantic AI 접착만)
  앱이 0개 = 프롬프트 · 도구 0 추가. 1개 이상 = 실행 지침에 앱 목록 블록(프로젝트 지침 앞) + 상시 도구 use_app(app, need)
  + MCP 도구 전부 deferred (ToolDefinition.defer_loading · 공개 전엔 요청에 안 실림) + 자동 search_tools (우리 검색 전략 = 한글 bigram)
  use_app → ToolReturn(tools=[…4개]) = 그 대화에 고정 (기록의 ToolAvailabilityDeltaPart) · 대화당 12개
  활동 단계 = app:<handle> (tool:use_app 대신) · MCP 도구 = tool:<handle>__<도구> + CUSTOM brewai.app_tool {call_id, app, app_name, server_id, tool, write, label}
  연결 없음 = CallDeferred → 툴 단계 status waiting → CUSTOM brewai.app_auth {call_id, server{id, handle, name, domain}, mode ask|auto|manual,
    reason not_connected|expired|insufficient_scope, auto_open, scope} → run_summary.pending = [그 호출들] → runs.pending_json
  공유됐지만 안 가져온 앱 = CUSTOM brewai.app_needs_import {server{id, name, domain}, via} (실행은 계속 · 모델이 안내)
  이어서 하기 = forwardedProps.resume {call_id} (메시지 없이) → 서버가 기록의 그 호출을 다시 계산(UI 는 근거 아님) → deferred_tool_results
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections.abc import AsyncGenerator, AsyncIterator, Awaitable, Callable, Sequence
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field, replace
from typing import Annotated, Any, Literal, Protocol, TypedDict

from ag_ui.core import (
    BaseEvent,
    CustomEvent,
    EventType,
    RunErrorEvent,
    StepFinishedEvent,
    StepStartedEvent,
    UserMessage,
)
from openai import APIConnectionError, APIStatusError, AsyncOpenAI
from pydantic import ValidationError
from pydantic import Field, TypeAdapter
from pydantic_ai import Agent, FunctionToolset, RunContext, Tool
from pydantic_ai.capabilities import ToolSearch
from pydantic_ai.exceptions import CallDeferred, ModelConnectionError, ModelHTTPError, UsageLimitExceeded
from pydantic_ai.messages import (
    INTERRUPTED_TOOL_RETURN_CONTENT,
    ModelMessage,
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    TextPart,
    ThinkingPart,
    ToolAvailabilityDeltaPart,
    ToolCallPart,
    ToolReturn,
    ToolReturnPart,
    ToolSearchReturnPart,
    UserPromptPart,
    repair_messages,
)
from pydantic_ai.models import Model, ModelRequestParameters, StreamedResponse
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIChatModelSettings
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.providers.litellm import LiteLLMProvider
from pydantic_ai.settings import ModelSettings
from pydantic_ai.tool_manager import ParallelExecutionMode, ToolManager
from pydantic_ai.tools import DeferredToolRequests, DeferredToolResults, ToolDefinition
from pydantic_ai.toolsets import AbstractToolset, ToolsetTool, WrapperToolset
from pydantic_ai.toolsets.external import TOOL_SCHEMA_VALIDATOR
from pydantic_ai.ui.ag_ui import AGUIAdapter, AGUIEventStream
from pydantic_ai.usage import UsageLimits
from starlette.requests import Request
from starlette.responses import Response

from . import diagnose as dx
from .connectors.session import AppSession, AuthNeeded, Revealed, search_names
from .models import ModelChoice
from .skills import NAME_RE as SKILL_NAME_RE
from .skills import SkillRegistry
from .tools import BUILTIN_TOOLS, USE_APP, USE_SKILL, ToolSpec, step_label, tool_label

log = logging.getLogger("conductor.agent")

INSTRUCTIONS = (
    "너는 BrewAI 의 conductor 에이전트다. 한국어로 짧고 정확하게 답한다. "
    "숫자 계산은 calculator, 단위 환산은 unit_convert, 날짜 차이·며칠 뒤·요일은 date_calc, 글자 수는 text_stats, "
    "오늘 날짜·지금 시각은 current_time 도구로 확인한 뒤 답한다 (암산·추측하지 않는다). "
    "서로의 결과가 필요 없는 도구 호출은 한 번에 같이 부른다 (예: 두 도시의 시각 = current_time 두 번을 한 응답에 · 동시에 돈다). "
    "앞 도구의 결과가 있어야 하는 호출만 차례로 부른다. "
    "앞선 대화를 기억하고 이어서 답한다."
)

Reasoning = Literal["off", "low", "high"]
REASONING_LEVELS: tuple[Reasoning, ...] = ("off", "low", "high")
# 화면의 생각 깊이 → LiteLLM reasoning_effort. '보통'(low) = medium: Claude adaptive 모델은 effort low 면 쉬운 질문에서
# 생각을 자주 건너뛴다 (LiteLLM 1.106.2 _map_reasoning_effort → output_config.effort). 저장 값(low)은 그대로 둔다 (기록 호환)
REASONING_EFFORT: dict[str, Literal["medium", "high"]] = {"low": "medium", "high": "high"}
MAX_MODEL_REQUESTS = 8  # 툴 왕복 포함 한 실행의 모델 호출 상한 (무한 툴 루프 방지)
MAX_PROMPT_CHARS = 32_000
THINKING_MAX_TOKENS = 16_000  # Anthropic thinking 은 max_tokens > budget 이어야 한다 (LiteLLM high = 4096)
# 병렬 툴: 모델이 한 응답에 툴을 여럿 부르면 동시에 돌린다 (Pydantic AI 기본값이지만 여기서 못 박는다 · 결과는 끝나는 대로).
# 한 실행에서 동시에 도는 툴은 MAX_PARALLEL_TOOLS 개까지 (나머지는 줄 서서 기다린다 · 기다리는 시간은 시간 제한에 안 든다).
# 툴 하나가 TOOL_TIMEOUT_S 를 넘기면 모델에게 '시간 초과' 재시도 안내가 간다 (Pydantic AI FunctionToolset timeout → ModelRetry)
TOOL_EXECUTION: ParallelExecutionMode = "parallel"
MAX_PARALLEL_TOOLS = 4
TOOL_TIMEOUT_S = 20.0
# 실행이 오류 · 취소로 끝날 때 Pydantic AI 가 아직 결과 없는 툴마다 보내는 마감 결과 (ui/_event_stream.py) → 그 툴 단계는 완료가 아니다
_CLOSEOUT = {"Tool execution was interrupted by an error.": "error", INTERRUPTED_TOOL_RETURN_CONTENT: "cancelled"}
APP_TOOL_TIMEOUT_S = 45.0  # use_app (tools/list 여러 쪽) · MCP 도구 한 번 (MCP 클라이언트 자체 시간 제한 30초가 먼저)
PROBE_MAX_TOKENS = 16  # 관리자 '연결 시험' (LiteLLM 자체 health check 기본값과 같다. 1 은 생각 모델에서 거절될 수 있다)
_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")

ModelFactory = Callable[[str], Model]

# 스트림 중 오류는 RUN_ERROR 한 줄로 (code · detail). 게이트웨이 응답 본문·키는 내보내지 않는다 (eval 제약: 비밀 노출 0).
# provider 문구는 conductor 로그에만 (diagnose.sanitize: 키처럼 보이는 것을 가리고 300자까지).
PUBLIC_ERRORS = {
    "gateway_auth_failed": "게이트웨이 인증에 실패했어요. 관리자에게 알려 주세요.",
    "provider_auth_failed": "이 모델의 API 키가 없거나 틀려요. 관리자에게 알려 주세요.",
    "provider_rejected": "모델 설정 문제로 요청이 거절됐어요. 관리자에게 알려 주세요.",
    "gateway_unreachable": "모델 게이트웨이에 연결하지 못했어요.",
    "run_limit": "작업 단계가 너무 많아 멈췄어요. 질문을 나눠서 다시 시도해 주세요.",
    "model_error": "모델이 응답하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
}


USE_APP_DESCRIPTION = (
    "연결된 앱(MCP)의 도구를 꺼낸다. 앱 목록의 handle 과 할 일(need)을 주면 맞는 도구를 골라 바로 부를 수 있게 해 준다. "
    "같은 대화에서 이미 꺼낸 도구는 다시 꺼내지 않고 바로 부른다."
)
SEARCH_DESCRIPTION = (
    "앱 도구를 낱말로 찾는다 (한국어 · 영어). 어느 앱인지 알면 use_app 을 먼저 쓴다. 못 찾으면 같은 낱말로 다시 찾지 않는다."
)
SEARCH_PARAM_DESCRIPTION = "찾을 낱말 목록 (예: ['이슈 검색', 'search issues']). 결과는 하나로 합친다."


class _UseAppArgs(TypedDict):
    app: Annotated[str, Field(description="앱 목록의 handle (예: linear)", max_length=80)]
    need: Annotated[str, Field(description="이 앱으로 할 일 한 줄 (예: 내 이슈 검색)", max_length=300)]


_USE_APP_ARGS = TypeAdapter(_UseAppArgs)
_USE_APP_DEF = ToolDefinition(
    name=USE_APP, description=USE_APP_DESCRIPTION, parameters_json_schema=_USE_APP_ARGS.json_schema(), timeout=APP_TOOL_TIMEOUT_S,
)


class ChatRequestError(Exception):
    """스트림을 열기 전에 거절 (400 등). app.py 가 JSON 으로 바꾼다."""

    def __init__(self, status: int, code: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code


@dataclass(frozen=True)
class ChatRequest:
    """검사를 마친 요청 (스트림 열기 전)."""

    thread_id: str
    run_id: str
    prompt: str
    model: str | None  # forwardedProps.model (None = 기본 모델)
    reasoning: Reasoning  # forwardedProps.reasoning (기본 off)
    space_id: str | None = None  # forwardedProps.spaceId (새 대화만 · 없으면 내 스페이스)
    project_id: str | None = None  # forwardedProps.projectId (새 대화만)
    resume: str | None = None  # forwardedProps.resume.call_id = 연결 뒤 이어서 하기 (prompt 없음 · 기존 대화만)


@dataclass(frozen=True)
class RunScope:
    """prepare 가 정한 실행 범위 (누가 · 어디서 · 프로젝트 지침)."""

    user_id: str | None = None
    space_id: str | None = None
    project_id: str | None = None
    instructions: str | None = None  # 프로젝트 지침 (시스템 프롬프트 뒤에 붙는다)
    apps: AppSession | None = None  # 이 사람이 쓸 수 있는 MCP 앱 (없으면 None = 앱 목록 · use_app 0)
    resume: tuple[str, ...] = ()  # 이어서 하기: 서버가 다시 계산할 대기 호출 id (prepare 가 runs.pending_json 으로 확인)


class RunSink(Protocol):
    """실행 기록 (app.py 가 SQLite 로 구현). 스트림이 어떻게 끝나든 finish 는 정확히 한 번."""

    def steps_changed(self, steps: list[dict[str, Any]]) -> None: ...

    def finish(
        self,
        *,
        status: Literal["done", "error", "cancelled"],
        steps: list[dict[str, Any]],
        duration_ms: int,
        messages: str | None,
        usage: dict[str, Any] | None,
        error_code: str | None,
        error_detail: str | None,
        pending: list[dict[str, Any]] | None = None,  # 연결 대기로 멈춘 호출 (status done 일 때만 · runs.pending_json)
    ) -> None: ...


# prepare = 권한 · 모델 고르기 · 기록 읽기 · 실행 시작 기록. (모델, 앞 대화 JSON 들, sink, 범위) 를 돌려준다. 거절 = ChatRequestError
Prepare = Callable[[ChatRequest], Awaitable[tuple[ModelChoice, list[str], RunSink, RunScope]]]


def diagnose(error: BaseException) -> dx.Diagnosis:
    """Pydantic AI 가 OpenAI SDK 오류를 ModelHTTPError · ModelConnectionError 로 감싸서 준다 → diagnose.classify_http.
    게이트웨이 키 실패(LiteLLM 프록시 type)와 provider 키 실패(provider type · …Exception 문구)를 type 으로 가른다."""
    if isinstance(error, ModelHTTPError):
        return dx.classify_http(error.status_code, error.provider_error_type, error.body)
    if isinstance(error, ModelConnectionError):
        return dx.unreachable()
    if isinstance(error, UsageLimitExceeded):
        return dx.Diagnosis(code="run_limit", detail=None)
    return dx.Diagnosis(code="model_error", detail=None)


def error_code(error: BaseException) -> str:
    return diagnose(error).code


class _EventStream(AGUIEventStream):
    async def on_error(self, error: Exception) -> AsyncIterator[BaseEvent]:
        d = diagnose(error)
        # 진단 한 줄: status · LiteLLM type · 가린 provider 문구 (요청 본문 · 키는 안 찍는다)
        log.warning("chat run failed: %s error=%s", d.log_fields(), type(error).__name__)
        async for event in super().on_error(error):
            if isinstance(event, RunErrorEvent):
                extra = {"detail": d.detail} if d.detail else {}
                event = RunErrorEvent(message=PUBLIC_ERRORS[d.code], code=d.code, timestamp=event.timestamp, **extra)
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


# 서명된 thinking 블록을 다시 보내야 하는 provider (Claude: Anthropic · Bedrock · Vertex 의 claude-*)
_SIGNED_THINKING = ("anthropic", "bedrock")
_REASONING_KEYS = ("openai_reasoning_effort", "thinking")


def _signed_thinking(model: ModelChoice) -> bool:
    return model.provider in _SIGNED_THINKING or "claude" in model.id.lower()


def _in_tool_loop(messages: Sequence[ModelMessage]) -> bool:
    """이번 질문(마지막 사용자 메시지) 뒤에 모델이 이미 툴을 불렀나 = 툴 결과를 들고 다시 부르는 요청."""
    for m in reversed(messages):
        if isinstance(m, ModelRequest) and any(isinstance(p, UserPromptPart) for p in m.parts):
            return False
        if isinstance(m, ModelResponse) and any(isinstance(p, ToolCallPart) for p in m.parts):
            return True
    return False


class _ThinkFirstOnly(WrapperModel):
    """Claude + 생각 + 툴: 툴 결과를 들고 가는 요청에선 생각을 끈다.
    Anthropic 은 생각이 켜진 요청의 마지막 assistant(tool_use) 가 서명된 thinking 블록으로 시작해야 하는데, Pydantic AI 는
    LiteLLM 의 thinking_blocks(서명)를 받지도 보내지도 않는다 (reasoning_content 글만) → 그대로면 두 번째 호출이 400.
    LiteLLM modify_params 와 같은 처리를 conductor 에서 한다 (게이트웨이 설정에 기대지 않는다). 생각은 첫 호출에서 한다."""

    @staticmethod
    def _for_request(messages: Sequence[ModelMessage], settings: ModelSettings | None) -> ModelSettings | None:
        if settings is None or not _in_tool_loop(messages):
            return settings
        return ModelSettings(**{k: v for k, v in settings.items() if k not in _REASONING_KEYS})  # type: ignore[typeddict-item]

    async def request(
        self, messages: list[ModelMessage], model_settings: ModelSettings | None, model_request_parameters: ModelRequestParameters
    ) -> ModelResponse:
        return await self.wrapped.request(messages, self._for_request(messages, model_settings), model_request_parameters)

    @asynccontextmanager
    async def request_stream(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
        run_context: Any = None,
    ) -> AsyncGenerator[StreamedResponse]:
        settings = self._for_request(messages, model_settings)
        async with self.wrapped.request_stream(messages, settings, model_request_parameters, run_context) as stream:
            yield stream


def _user_text(message: UserMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    return "".join(getattr(part, "text", "") or "" for part in content)


def build_toolset(specs: Sequence[ToolSpec]) -> FunctionToolset[None]:
    """툴 목록(tools.py) → Pydantic AI 툴셋. MCP 툴셋(slice 03+)은 run 의 toolsets 에 옆으로 더한다."""
    return FunctionToolset(
        [
            Tool(s.function, takes_ctx=False, name=s.name, description=s.description, requires_approval=s.requires_approval)
            for s in specs
        ],
        max_retries=1,
        timeout=TOOL_TIMEOUT_S,
    )


@dataclass
class _Bounded(WrapperToolset[None]):
    """동시 실행 상한: 한 실행(run)의 툴 호출은 gate 개수만큼만 동시에 돈다. 실행마다 새로 만든다 (실행끼리 막지 않게)."""

    gate: asyncio.Semaphore = field(default_factory=lambda: asyncio.Semaphore(MAX_PARALLEL_TOOLS))

    async def call_tool(self, name: str, tool_args: dict[str, Any], ctx: RunContext[None], tool: ToolsetTool[None]) -> Any:
        async with self.gate:
            return await self.wrapped.call_tool(name, tool_args, ctx, tool)


def bounded(toolset: AbstractToolset[None], limit: int | None = None, *, gate: asyncio.Semaphore | None = None) -> _Bounded:
    return _Bounded(toolset, gate=gate or asyncio.Semaphore(limit or MAX_PARALLEL_TOOLS))


# ── MCP 앱 (connectors/session.py 의 판단 → Pydantic AI 도구 · 이벤트) ─────────────────────────


@dataclass
class _AppRun:
    """실행 하나의 앱 상태: 연결 대기 호출 · 내보낼 CUSTOM 이벤트 · 대기로 닫을 툴 단계."""

    apps: AppSession
    pending: dict[str, dict[str, Any]] = field(default_factory=dict)  # call id → runs.pending_json 한 칸
    events: list[BaseEvent] = field(default_factory=list)
    waiting: list[str] = field(default_factory=list)
    resumed: int = 0  # 이어서 하기로 서버가 대신 돌린 호출 수 (사용량 tool_calls 에 더한다)

    def defer(self, call_id: str, tool_name: str, need: AuthNeeded) -> CallDeferred:
        self.pending[call_id] = need.pending(call_id, tool_name)
        self.events.append(CustomEvent(name="brewai.app_auth", value=need.event(call_id)))
        self.waiting.append(call_id)
        return CallDeferred(metadata={k: v for k, v in need.pending(call_id, tool_name).items() if k != "call_id"})

    def drain(self) -> tuple[list[str], list[BaseEvent]]:
        events = [*self.events, *(CustomEvent(name=n, value=v) for n, v in self.apps.notices)]
        waiting = list(self.waiting)
        self.events.clear()
        self.waiting.clear()
        self.apps.notices.clear()
        return waiting, events


class _AppTools(AbstractToolset[None]):
    """use_app (상시) + MCP 도구 (전부 deferred = 공개 전엔 요청에 0). 실행마다 만든다. 판단 = connectors/session.py."""

    def __init__(self, run: _AppRun) -> None:
        self.run = run

    @property
    def id(self) -> str:
        return "brewai_apps"

    async def get_tools(self, ctx: RunContext[None]) -> dict[str, ToolsetTool[None]]:
        out: dict[str, ToolsetTool[None]] = {
            USE_APP: ToolsetTool(toolset=self, tool_def=_USE_APP_DEF, max_retries=1, args_validator=_USE_APP_ARGS.validator),  # type: ignore[arg-type]
        }
        for t in self.run.apps.tools():
            d = t.definition()
            out[d["name"]] = ToolsetTool(
                toolset=self, max_retries=1, args_validator=TOOL_SCHEMA_VALIDATOR,
                tool_def=ToolDefinition(name=d["name"], description=d["description"], parameters_json_schema=d["parameters"],
                                        metadata=d["metadata"], defer_loading=True, timeout=APP_TOOL_TIMEOUT_S),
            )
        return out

    async def call_tool(self, name: str, tool_args: dict[str, Any], ctx: RunContext[None], tool: ToolsetTool[None]) -> Any:
        call_id = ctx.tool_call_id or ""
        if name == USE_APP:
            got = await self.run.apps.use_app(tool_args.get("app"), tool_args.get("need"), revealed=ctx.discovered_tool_names)
            if isinstance(got, AuthNeeded):
                raise self.run.defer(call_id, name, got)
            return app_return(got)
        res, meta = await self.run.apps.call(name, tool_args, pinned=pinned_servers(ctx.messages))
        if isinstance(res, AuthNeeded):
            raise self.run.defer(call_id, name, res)
        return ToolReturn(res, metadata=meta)


def app_return(got: Revealed | dict[str, Any]) -> Any:
    """use_app 결과 → 모델 · 기록. 새로 공개할 도구 = ToolReturn.tools (기록에 남아 그 대화에 고정)."""
    if isinstance(got, Revealed):
        return ToolReturn(got.result(), tools=got.new, metadata={"app": got.app.handle, "app_name": got.app.name, "server_id": got.app.server_id})
    return got


def _search_apps(ctx: RunContext[Any], queries: Sequence[str], tools: Sequence[ToolDefinition]) -> list[str]:
    """자동 search_tools 의 검색 전략 = 한글 되는 우리 BM25 (기본은 [a-z0-9]+ 라 한글을 버린다 · ADR-0013)."""
    return search_names(queries, [(t.name, t.description, t.metadata) for t in tools], ctx.discovered_tool_names)


def revealed_names(messages: Sequence[ModelMessage]) -> set[str]:
    """기록에서 공개된 deferred 도구 이름 (use_app 의 ToolReturn.tools · search_tools 결과)."""
    out: set[str] = set()
    for m in messages:
        if isinstance(m, ModelRequest):
            for p in m.parts:
                if isinstance(p, ToolAvailabilityDeltaPart):
                    out.update(p.tools_added)
                elif isinstance(p, ToolSearchReturnPart):
                    out.update(x["name"] for x in p.discovered_tools)
    return out


def pinned_servers(messages: Sequence[ModelMessage]) -> dict[str, str]:
    """기록이 MCP 도구 이름을 묶은 서버: use_app 결과(metadata server_id · 고른 도구 이름) · MCP 도구 결과(metadata server_id).
    나중 것이 이긴다 (use_app 을 다시 부르면 지금 서버로). handle 이 다른 서버로 옮겨 간 이름을 옛 대화가 부르지 않게 (session.call)."""
    out: dict[str, str] = {}
    for m in messages:
        if not isinstance(m, ModelRequest):
            continue
        for p in m.parts:
            if not isinstance(p, ToolReturnPart) or not isinstance(p.metadata, dict) or not isinstance(p.metadata.get("server_id"), str):
                continue
            sid = p.metadata["server_id"]
            if p.tool_name == USE_APP:
                tools = p.content.get("tools") if isinstance(p.content, dict) else None
                out.update({t["name"]: sid for t in tools or [] if isinstance(t, dict) and isinstance(t.get("name"), str)})
            elif "__" in p.tool_name:
                out[p.tool_name] = sid
    return out


def open_calls(messages: Sequence[ModelMessage]) -> dict[str, ToolCallPart]:
    """마지막 모델 응답에서 결과가 아직 없는 툴 호출 (연결 대기로 멈춘 실행의 끝 · 그 뒤 요청에 결과가 없는 것)."""
    last = next((i for i in range(len(messages) - 1, -1, -1) if isinstance(messages[i], ModelResponse)), None)
    if last is None:
        return {}
    calls = {p.tool_call_id: p for p in messages[last].parts if isinstance(p, ToolCallPart)}
    for m in messages[last + 1 :]:
        for p in m.parts:
            if isinstance(p, ToolReturnPart | RetryPromptPart):
                calls.pop(p.tool_call_id, None)
    return calls


def ready_history(blobs: Sequence[str], *, resume: bool) -> list[ModelMessage]:
    """모델에 줄 기록. 새 질문인데 마지막 응답에 결과 없는 툴 호출(연결을 기다리다 그만둔 것)이 있으면 닫는다
    (Pydantic AI 는 그대로면 새 질문을 거절한다). 이어서 하기 = 그대로 둔다 (deferred_tool_results 가 채운다).
    더 앞의 열린 호출은 Pydantic AI 가 요청마다 스스로 닫는다."""
    history = load_history(blobs)
    if not resume and open_calls(history):
        return repair_messages(history)
    return history


def load_history(blobs: Sequence[str]) -> list[ModelMessage]:
    """저장된 실행들의 메시지 → 모델에 줄 기록. 지난 턴의 생각(ThinkingPart)은 뺀다 —
    provider 가 다시 받지 않는 값이고(Anthropic 은 서명 없는 thinking 을 거절할 수 있다) 토큰만 쓴다."""
    out: list[ModelMessage] = []
    for blob in blobs:
        try:
            messages = ModelMessagesTypeAdapter.validate_json(blob)
        except ValidationError:
            log.warning("skipping unreadable stored run messages")  # 업그레이드로 모양이 바뀐 옛 기록
            continue
        for m in messages:
            if isinstance(m, ModelResponse):
                parts = [p for p in m.parts if not isinstance(p, ThinkingPart)]
                if not parts:
                    continue
                m = replace(m, parts=parts)
            out.append(m)
    return out


def skill_card(result: Any) -> Any:
    """use_skill 결과 → 화면용 (지침 본문은 모델만 본다 · 화면엔 이름과 줄 수)."""
    if isinstance(result, dict) and isinstance(result.get("instructions"), str):
        return {k: v for k, v in result.items() if k != "instructions"} | {"lines": len(result["instructions"].splitlines())}
    return result


def render_run(blob: str | None, *, pending: Sequence[str] = (), carry: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    """저장된 실행 하나 → 화면용 답 (GET /api/threads/{id}). parts = 생각 · 툴 · 글 을 나온 순서대로.
    pending = 연결 대기로 멈춘 호출 id (그 툴 = status waiting). carry = 대화 전체에서 공유하는 툴 칸 (이어서 하기 실행의 결과가
    앞 실행의 대기 카드를 채운다). MCP 도구 = + app · app_name · write (기록의 ToolReturn metadata)."""
    parts: list[dict[str, Any]] = []
    tools: dict[str, dict[str, Any]] = carry if carry is not None else {}
    batch = 0  # 툴을 부른 모델 응답 번호 (같은 응답의 툴 = 같은 batch = 동시에 돌았다)
    if blob:
        try:
            messages = ModelMessagesTypeAdapter.validate_json(blob)
        except ValidationError:
            messages = []
        for m in messages:
            if isinstance(m, ModelResponse):
                if any(isinstance(p, ToolCallPart) for p in m.parts):
                    batch += 1
                for p in m.parts:
                    if isinstance(p, ThinkingPart) and p.content:
                        if parts and parts[-1]["type"] == "reasoning":
                            parts[-1]["text"] += p.content
                        else:
                            parts.append({"type": "reasoning", "text": p.content})
                    elif isinstance(p, TextPart) and p.content:
                        if parts and parts[-1]["type"] == "text":
                            parts[-1]["text"] += p.content
                        else:
                            parts.append({"type": "text", "text": p.content})
                    elif isinstance(p, ToolCallPart):
                        tool = {
                            "type": "tool", "id": p.tool_call_id, "name": p.tool_name, "label": tool_label(p.tool_name),
                            "args": p.args_as_dict(), "result": None, "status": "running", "batch": batch,
                        }
                        tools[p.tool_call_id] = tool
                        parts.append(tool)
            elif isinstance(m, ModelRequest):
                for p in m.parts:
                    if isinstance(p, ToolReturnPart) and p.tool_call_id in tools:
                        t = tools[p.tool_call_id]
                        t["result"] = skill_card(p.content) if t["name"] == USE_SKILL else p.content
                        t["status"] = "error" if isinstance(p.content, dict) and "error" in p.content else "done"
                        if isinstance(p.metadata, dict) and isinstance(p.metadata.get("app"), str):  # MCP 도구 · use_app 카드
                            keys = ("app", "app_name", "write", "label")
                            t.update({k: p.metadata[k] for k in keys if k in p.metadata})
                            if t["name"] != USE_APP and p.metadata.get("label"):
                                t["label"] = p.metadata["label"]
                    elif isinstance(p, RetryPromptPart) and p.tool_call_id in tools:
                        tools[p.tool_call_id].update(status="error", result={"error": "retry", "message": p.model_response()})
    for call_id in pending:
        if call_id in tools and tools[call_id]["status"] == "running":
            tools[call_id]["status"] = "waiting"  # 연결 대기 (이어서 하기 전)
    text = [p["text"] for p in parts if p["type"] == "text"]
    reasoning = [p["text"] for p in parts if p["type"] == "reasoning"]
    return {"content": "\n\n".join(text), "reasoning": "\n\n".join(reasoning) or None, "parts": parts}


@dataclass
class _Activity:
    """AG-UI 이벤트를 보며 단계(생각 → 툴 → 쓰기)를 만든다. STEP_STARTED/FINISHED 를 끼워 넣고 sink 에 남긴다.
    생각 · 쓰기 = 한 번에 하나. 툴(스킬) 단계 = 동시에 여럿 열릴 수 있다 (병렬 툴): 그 툴의 결과가 오면 닫힌다.
    열린 툴 단계가 없을 때 새 툴 단계가 열리면 batch +1 (한 모델 응답의 툴 호출은 결과보다 먼저 다 온다 → 같은 batch)."""

    sink: RunSink
    labels: dict[str, str] = field(default_factory=dict)  # 스킬 이름 → 화면 이름 (skill:<이름> 단계)
    started: float = field(default_factory=time.monotonic)
    steps: list[dict[str, Any]] = field(default_factory=list)
    opened: dict[str, int] = field(default_factory=dict)  # 열린 단계 key → steps 위치 (열린 순서)
    calls: dict[str, str] = field(default_factory=dict)  # 툴 call id → 단계 key
    batch: int = 0
    status: Literal["done", "error", "cancelled"] = "cancelled"
    code: str | None = "client_disconnected"
    detail: str | None = None
    closed: bool = False
    messages: str | None = None
    usage: dict[str, Any] | None = None
    apps: _AppRun | None = None  # MCP 앱 (없으면 None)
    pending: list[dict[str, Any]] = field(default_factory=list)  # 연결 대기로 멈춘 호출 (on_complete 가 채운다)

    def _ms(self) -> int:
        return int((time.monotonic() - self.started) * 1000)

    def is_open(self, key: str) -> bool:
        return key in self.opened

    def _record(self) -> None:
        try:
            self.sink.steps_changed(self.steps)
        except Exception:  # 진행 상황 기록 실패가 대화를 막지 않게
            log.exception("failed to record run steps")

    def open(self, key: str, name: str, call_id: str | None = None, extra: dict[str, Any] | None = None) -> list[BaseEvent]:
        """단계를 연다. call_id 가 있으면 툴 단계 = 다른 툴 단계는 열어 둔다 (동시에 돈다) · 생각 · 쓰기만 닫는다.
        extra = 툴 단계에 더할 칸 (MCP 도구: app · write)."""
        tool = call_id is not None
        out = self.close_all("done", keep_tools=tool)
        if tool and not any("call_id" in self.steps[i] for i in self.opened.values()):
            self.batch += 1
        step: dict[str, Any] = {
            "name": name, "label": step_label(name, self.labels), "status": "running", "started_ms": self._ms(), "duration_ms": None,
        }
        if tool:
            step |= {"call_id": call_id, "batch": self.batch, **(extra or {})}
            self.calls[call_id] = key
        self.opened[key] = len(self.steps)
        self.steps.append(step)
        out.append(StepStartedEvent(step_name=name))
        self._record()
        return out

    def close(self, key: str, status: str) -> list[BaseEvent]:
        i = self.opened.pop(key, None)
        if i is None:
            return []
        step = self.steps[i]
        step.update(status=status, duration_ms=self._ms() - step["started_ms"])
        return [StepFinishedEvent(step_name=step["name"])]

    def close_call(self, call_id: str, status: str = "done") -> list[BaseEvent]:
        """툴 결과가 왔다 → 그 툴 단계만 닫는다 (같은 batch 의 다른 툴은 아직 돌 수 있다)."""
        key = self.calls.pop(call_id, None)
        out = self.close(key, status) if key else []
        if out:
            self._record()
        return out

    def close_all(self, status: str, *, keep_tools: bool = False) -> list[BaseEvent]:
        """열린 단계를 연 순서대로 닫는다. keep_tools = 생각 · 쓰기만 닫고 툴 단계는 둔다 (툴 단계는 그 결과가 닫는다)."""
        out: list[BaseEvent] = []
        for key in list(self.opened):
            if keep_tools and "call_id" in self.steps[self.opened[key]]:
                continue
            out += self.close(key, status)
        return out

    def finish(self) -> None:
        if self.closed:
            return
        self.closed = True
        self.close_all("cancelled" if self.status == "cancelled" else ("error" if self.status == "error" else "done"))
        try:
            extra = {"pending": self.pending} if self.pending and self.status == "done" else {}
            self.sink.finish(
                status=self.status, steps=self.steps, duration_ms=self._ms(),
                messages=self.messages if self.status == "done" else None, usage=self.usage,
                error_code=None if self.status == "done" else self.code,
                error_detail=None if self.status == "done" else self.detail, **extra,
            )
        except Exception:  # 기록 실패가 스트림·종료를 막지 않게
            log.exception("failed to record run end")

    def summary(self, run_id: str, model: ModelChoice) -> dict[str, Any]:
        return {"run_id": run_id, "model": model.id, "duration_ms": self._ms(), "usage": self.usage, "steps": self.steps,
                "pending": self.pending}


class _RunStream:
    """AG-UI 이벤트 스트림 + 활동 단계. 클라이언트가 끊으면(CancelledError) · 스트림을 아예 못 열면(GC) 취소로 닫는다."""

    def __init__(self, events: AsyncIterator[BaseEvent], activity: _Activity, meta: dict[str, Any], run_id: str, model: ModelChoice):
        self._activity = activity
        self._gen = self._run(events, meta, run_id, model)

    def __aiter__(self) -> _RunStream:
        return self

    async def __anext__(self) -> BaseEvent:
        return await self._gen.__anext__()

    async def aclose(self) -> None:
        try:
            await self._gen.aclose()
        finally:
            self._activity.finish()

    def __del__(self) -> None:
        self._activity.finish()  # 시작도 못 한 제너레이터는 finally 가 돌지 않는다

    async def _run(self, events: AsyncIterator[BaseEvent], meta: dict[str, Any], run_id: str, model: ModelChoice) -> AsyncIterator[BaseEvent]:
        act = self._activity
        # TEXT_MESSAGE_START (와 바로 뒤 빈 END) 는 다음 이벤트까지 잡아 둔다: 글이면 '쓰기' 단계 뒤에, 툴 앞 빈 메시지면
        # 툴 단계 뒤에 내보낸다 → STEP_STARTED 가 언제나 그 단계의 첫 이벤트보다 먼저 온다
        held: list[BaseEvent] = []
        # use_skill · use_app: 스킬 · 앱 이름은 인자(TOOL_CALL_ARGS)에 있다 → TOOL_CALL_END 까지 잡아 두고 skill:<이름> · app:<handle> 단계를 연다
        skill: dict[str, Any] | None = None
        apps = act.apps

        def open_skill() -> list[BaseEvent]:
            nonlocal skill
            assert skill is not None
            try:
                args = json.loads(skill["args"] or "{}")
            except ValueError:
                args = {}
            args = args if isinstance(args, dict) else {}
            if skill["tool"] == USE_APP:
                found = apps.apps.find(args.get("app")) if apps else None
                step = f"app:{found.handle if found else 'unknown'}"
            else:
                name = args.get("name")
                name = name.strip() if isinstance(name, str) else ""
                step = f"skill:{name if SKILL_NAME_RE.match(name) else 'unknown'}"
            out = [*act.open(f"{step}#{skill['id']}", step, skill["id"]), *skill["events"]]
            skill = None
            return out

        def app_events() -> list[BaseEvent]:
            """연결 대기 = 그 툴 단계를 waiting 으로 닫고 brewai.app_auth · 공유 앱 = brewai.app_needs_import (생긴 대로 바로)."""
            if apps is None:
                return []
            waiting, events = apps.drain()
            out: list[BaseEvent] = []
            for call_id in waiting:
                out += act.close_call(call_id, "waiting")
            return out + events

        # 병렬 툴 실행을 이 실행에 못 박는다 (컨텍스트 변수 · 툴 태스크가 물려받는다). 다른 컨텍스트에서 닫혀도(GC) 실패하지 않게
        mode = ToolManager.parallel_execution_mode(TOOL_EXECUTION)
        mode.__enter__()
        try:
            async for ev in events:
                t = ev.type
                if skill is not None:
                    same = getattr(ev, "tool_call_id", None) == skill["id"]
                    if t == EventType.TOOL_CALL_ARGS and same:
                        skill["args"] += getattr(ev, "delta", "") or ""
                        skill["events"].append(ev)
                        continue
                    if t == EventType.TOOL_CALL_END and same:
                        skill["events"].append(ev)
                        for e in open_skill():
                            yield e
                        continue
                    for e in open_skill():  # 끝 신호 전에 다른 이벤트 (오류 등) → 이름 없이 연다
                        yield e
                if t == EventType.TOOL_CALL_START and ev.tool_call_name in (USE_SKILL, USE_APP):  # type: ignore[attr-defined]
                    skill = {"id": ev.tool_call_id, "tool": ev.tool_call_name, "args": "", "events": [*held, ev]}  # type: ignore[attr-defined]
                    held.clear()
                    continue
                if t == EventType.TEXT_MESSAGE_START or (
                    t == EventType.TEXT_MESSAGE_END and held and held[-1].type == EventType.TEXT_MESSAGE_START
                ):
                    held.append(ev)
                    continue
                pre: list[BaseEvent] = []
                post: list[BaseEvent] = []
                if t == EventType.RUN_STARTED:
                    post.append(CustomEvent(name="brewai.run", value=meta))
                elif t == EventType.REASONING_START and not act.is_open("thinking"):
                    pre = act.open("thinking", "thinking")
                elif t == EventType.TOOL_CALL_START:
                    name = f"tool:{ev.tool_call_name}"  # type: ignore[attr-defined]
                    mcp = apps.apps.index.get(ev.tool_call_name) if apps else None  # type: ignore[attr-defined]
                    extra = None
                    if mcp is not None:  # MCP 도구 카드: 앱 · 쓰기 표시 (승인은 slice 07)
                        act.labels[name] = mcp.label
                        extra = {"app": mcp.app.handle, "write": mcp.tool.write}
                        post.append(CustomEvent(name="brewai.app_tool", value={"call_id": ev.tool_call_id, **mcp.meta}))  # type: ignore[attr-defined]
                    pre = act.open(f"{name}#{ev.tool_call_id}", name, ev.tool_call_id, extra)  # type: ignore[attr-defined]
                elif t == EventType.TOOL_CALL_RESULT:
                    closeout = _CLOSEOUT.get(getattr(ev, "content", None) or "")
                    post = act.close_call(ev.tool_call_id, closeout or "done")  # type: ignore[attr-defined]
                elif t == EventType.TEXT_MESSAGE_CONTENT and not act.is_open("writing"):
                    pre = act.open("writing", "writing")
                elif t == EventType.RUN_FINISHED:
                    pre = [*app_events(), *act.close_all("done")]
                    act.status, act.code = "done", None
                    pre.append(CustomEvent(name="brewai.run_summary", value=act.summary(run_id, model)))
                elif t == EventType.RUN_ERROR:
                    pre = act.close_all("error")
                    act.status, act.code = "error", getattr(ev, "code", None) or "model_error"
                    act.detail = getattr(ev, "detail", None)
                if t == EventType.TOOL_CALL_RESULT or t == EventType.TOOL_CALL_END:
                    post += app_events()
                for e in (*pre, *held, ev, *post):
                    yield e
                held.clear()
            if skill is not None:  # 끝 신호 없이 스트림이 끝남
                for e in open_skill():
                    yield e
        finally:
            with suppress(ValueError):  # 연 컨텍스트와 다른 곳(GC 의 aclose)에서 닫히면 reset 이 ValueError
                mode.__exit__(None, None, None)
            act.finish()


class ChatRuntime:
    """Agent 하나 + 게이트웨이 provider 하나. 모델·생각 수준·툴은 요청마다 고른다."""

    def __init__(
        self,
        *,
        gateway_url: str,
        gateway_key: str,
        model_factory: ModelFactory | None = None,
        tools: Sequence[ToolSpec] = BUILTIN_TOOLS,
        skills: SkillRegistry | None = None,
        openai_client: AsyncOpenAI | None = None,  # 테스트 = httpx2.MockTransport 를 단 클라이언트
    ) -> None:
        # 재시도 0: 게이트웨이(num_retries 0)도 안 하고, 사용자는 '다시 시도' 버튼이 있다. 기본 2회면 실패가 3배 늦다.
        self._client = openai_client or AsyncOpenAI(
            base_url=f"{gateway_url.rstrip('/')}/v1", api_key=gateway_key, max_retries=0, timeout=120.0
        )
        self._provider = LiteLLMProvider(openai_client=self._client)
        self._model_factory = model_factory or (lambda model_id: OpenAIChatModel(model_id, provider=self._provider))
        self.skills = skills or SkillRegistry()
        skill_tool = self.skills.tool()
        self.tools = (*tools, *([skill_tool] if skill_tool else []))
        self._toolset = build_toolset(self.tools)
        # 점진 공개: 스킬 이름·설명만 시스템 프롬프트에 (본문은 use_skill 로)
        self.instructions = INSTRUCTIONS + self.skills.prompt()
        # 출력 = 글 또는 연결 대기(DeferredToolRequests · MCP 앱 로그인 전). search_tools = deferred 도구가 있을 때만 생긴다 (앱 0개 = 0토큰)
        self.agent: Agent[None, str | DeferredToolRequests] = Agent(
            name="conductor", instructions=self.instructions, output_type=[str, DeferredToolRequests],
            capabilities=[ToolSearch(strategy=_search_apps, max_results=8, tool_description=SEARCH_DESCRIPTION,
                                     parameter_description=SEARCH_PARAM_DESCRIPTION)],
        )

    async def __aenter__(self) -> ChatRuntime:  # 앱 수명 = provider HTTP 클라이언트 수명
        await self._provider.__aenter__()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self._provider.__aexit__(None, None, None)
        await self._client.close()

    @staticmethod
    def model_settings(model: ModelChoice, reasoning: Reasoning) -> OpenAIChatModelSettings | None:
        """생각 수준 → LiteLLM `reasoning_effort` (LiteLLM 이 Anthropic thinking budget 등으로 바꾼다).
        게이트웨이가 생각을 지원한다고 한 모델에만 보낸다 (안 그러면 LiteLLM 이 UnsupportedParams 400)."""
        if reasoning == "off" or not model.supports_reasoning:
            return None
        # drop_params: 게이트웨이 값(supports_reasoning)과 LiteLLM 모델 표(provider 변환)가 어긋나도 400 대신 그 파라미터만 버린다
        # (예: 관리 화면에서 model_info 로 '생각 지원' 을 켰는데 LiteLLM 1.106.2 표에 없는 모델 이름). 이 요청에만 · LiteLLM 1.106.2 확인
        settings = OpenAIChatModelSettings(openai_reasoning_effort=REASONING_EFFORT[reasoning], extra_body={"drop_params": True})
        if model.provider in ("anthropic", "bedrock", "google") and model.max_output_tokens:
            settings["max_tokens"] = min(model.max_output_tokens, THINKING_MAX_TOKENS)
        return settings

    async def probe(self, model_id: str) -> dx.Diagnosis | None:
        """관리자 '연결 시험': 짧은 호출 한 번 (max_tokens 16 · 생각 없음 · 툴 없음). 성공 = None, 실패 = Diagnosis."""
        try:
            await self._client.chat.completions.create(
                model=model_id,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=PROBE_MAX_TOKENS,
                extra_body={"drop_params": True},
                timeout=30.0,
            )
        except APIStatusError as e:
            d = dx.classify_http(e.status_code, getattr(e, "type", None), e.body)
            log.warning("model probe failed: model=%s %s", model_id, d.log_fields())
            return d
        except APIConnectionError:
            log.warning("model probe failed: model=%s gateway unreachable", model_id)
            return dx.unreachable()
        return None

    @staticmethod
    def parse(adapter: _Adapter) -> ChatRequest:
        run_input = adapter.run_input
        if run_input.tools:
            raise ChatRequestError(400, "frontend_tools_not_allowed")  # 툴은 conductor 가 소유 (승인·정책)
        if not _ID.match(run_input.thread_id):
            raise ChatRequestError(400, "bad_thread_id")
        if not _ID.match(run_input.run_id):
            raise ChatRequestError(400, "bad_run_id")
        props = run_input.forwarded_props if isinstance(run_input.forwarded_props, dict) else {}
        resume = props.get("resume")
        resume_id: str | None = None
        if resume is not None:  # 연결 뒤 이어서 하기 = 메시지 없이 그 호출 id 만 (보낸 메시지는 쓰지 않는다)
            resume_id = resume.get("call_id") if isinstance(resume, dict) else None
            if not isinstance(resume_id, str) or not _ID.match(resume_id):
                raise ChatRequestError(400, "bad_resume")
            prompt = ""
        else:
            last = run_input.messages[-1] if run_input.messages else None
            if not isinstance(last, UserMessage):
                raise ChatRequestError(400, "last_message_not_user")
            prompt = _user_text(last).strip()
            if not prompt:
                raise ChatRequestError(400, "empty_message")
            if len(prompt) > MAX_PROMPT_CHARS:
                raise ChatRequestError(400, "message_too_long")
        model = props.get("model")
        if model is not None and not isinstance(model, str):
            raise ChatRequestError(400, "unknown_model")
        reasoning = props.get("reasoning", "off")
        if reasoning not in REASONING_LEVELS:
            raise ChatRequestError(400, "bad_reasoning")
        scope = {k: props.get(k) for k in ("spaceId", "projectId")}
        for key, value in scope.items():
            if value is not None and not (isinstance(value, str) and _ID.match(value)):
                raise ChatRequestError(400, f"bad_{key}")
        return ChatRequest(
            thread_id=run_input.thread_id, run_id=run_input.run_id, prompt=prompt, model=model or None, reasoning=reasoning,
            space_id=scope["spaceId"], project_id=scope["projectId"], resume=resume_id,
        )

    async def handle(self, request: Request, prepare: Prepare) -> Response:
        try:
            adapter = await _Adapter.from_request(request, agent=self.agent)  # Content-Type ≠ application/json → 415
        except ValidationError as e:
            return Response(e.json(include_input=False), status_code=422, media_type="application/json")
        req = self.parse(adapter)
        model, blobs, sink, scope = await prepare(req)
        apps = _AppRun(scope.apps) if scope.apps is not None and model.supports_tools else None
        labels = self.skills.labels() | (scope.apps.labels() if scope.apps is not None else {})
        activity = _Activity(sink=sink, labels=labels, apps=apps)  # 여기부터 실행 기록이 열려 있다 → 어떤 길로 나가든 finish
        try:
            resumed = await self._resume(scope, apps, blobs) if req.resume else None
            return self._stream(adapter, req, model, blobs, activity, scope, resumed)
        except BaseException:
            activity.status, activity.code = "error", "internal_error"
            activity.finish()
            raise

    @staticmethod
    def pending_calls(blobs: Sequence[str], call_ids: Sequence[str]) -> dict[str, ToolCallPart]:
        """이어서 하기 확인용 (app.py prepare): 기록 끝에서 아직 결과가 없는 그 호출들."""
        calls = open_calls(ready_history(blobs, resume=True))
        return {c: calls[c] for c in call_ids if c in calls}

    @staticmethod
    async def _resume(scope: RunScope, apps: _AppRun | None, blobs: Sequence[str]) -> DeferredToolResults:
        """대기 호출을 서버가 다시 계산 (UI 가 보낸 결과는 없다 · 권한 · 연결을 지금 다시 본다). 아직 안 되는 호출 = 오류 결과."""
        history = ready_history(blobs, resume=True)
        calls = open_calls(history)
        revealed = revealed_names(history)
        pinned = pinned_servers(history)
        results: dict[str, Any] = {}
        for call_id in scope.resume:
            call = calls.get(call_id)
            if call is None:
                continue
            args = call.args_as_dict()
            if apps is None:
                results[call_id] = {"error": "not_connected", "message": "앱을 쓸 수 없어요."}
                continue
            if call.tool_name == USE_APP:
                got = await apps.apps.use_app(args.get("app"), args.get("need"), revealed=revealed)
                if isinstance(got, Revealed):
                    revealed |= set(got.new)
                value: Any = app_return(got) if not isinstance(got, AuthNeeded) else None
            else:
                apps.apps.tools()
                res, meta = await apps.apps.call(call.tool_name, args, pinned=pinned)
                value = ToolReturn(res, metadata=meta) if not isinstance(res, AuthNeeded) else None
            if value is not None:
                apps.resumed += 1  # 서버가 실제로 돌린 호출만 사용량에 (아직 연결 전 = 안 돌았다)
            results[call_id] = value if value is not None else {
                "error": "not_connected", "message": "앱이 아직 연결되지 않았어요. 사용자에게 설정 > 연결된 앱에서 연결해 달라고 안내한다.",
            }
        for call_id in calls:  # 같은 응답의 다른 대기 호출 (이번에 고른 것 밖) = 그만둠
            results.setdefault(call_id, {"error": "cancelled", "message": "사용자가 이 호출을 이어서 하지 않았어요."})
        return DeferredToolResults(calls=results)

    def _stream(
        self, adapter: _Adapter, req: ChatRequest, model: ModelChoice, blobs: list[str], activity: _Activity, scope: RunScope | None = None,
        resumed: DeferredToolResults | None = None,
    ) -> Response:
        scope = scope or RunScope()
        history = ready_history(blobs, resume=resumed is not None)
        # 서버가 원본: 이번 질문(마지막 user 메시지)만 어댑터에 남긴다. 클라이언트가 보낸 앞 대화는 쓰지 않는다 · 이어서 하기 = 메시지 없음
        keep = [] if resumed is not None else [adapter.run_input.messages[-1]]
        single = _Adapter(agent=self.agent, run_input=adapter.run_input.model_copy(update={"messages": keep}), accept=adapter.accept)
        settings = self.model_settings(model, req.reasoning)
        effective: Reasoning = req.reasoning if settings is not None else "off"
        if scope.user_id:  # LiteLLM 요청 user = users.id (게이트웨이 로그 · 예산 · trace)
            settings = OpenAIChatModelSettings(**(settings or {}), openai_user=scope.user_id)  # type: ignore[typeddict-item]
        log.info(
            "chat run thread=%s run=%s model=%s reasoning=%s turns=%d user=%s space=%s",
            req.thread_id, req.run_id, model.id, effective, len(blobs), scope.user_id, scope.space_id,
        )

        def on_complete(result: Any) -> None:
            new = result.all_messages()[len(history):]  # 이번 질문 + 이번 답 (툴 왕복 포함)
            activity.messages = ModelMessagesTypeAdapter.dump_json(new).decode()
            u = result.usage
            # 생각 토큰: OpenAI 형식 completion_tokens_details.reasoning_tokens (LiteLLM 이 Anthropic thinking 글자로 센다).
            # 글 없이 토큰만 있으면 = 생각은 했는데 내용을 안 보냄 (display omitted · redacted) → 화면이 그렇게 말한다
            reasoning_tokens = u.output_reasoning_tokens or int((u.details or {}).get("reasoning_tokens") or 0)
            # 캐시 토큰 (입력 토큰 안에 들어 있다): 읽기 = prompt_tokens_details.cached_tokens · 쓰기 = LiteLLM 의 cache_creation_input_tokens (details)
            details = u.details or {}
            activity.usage = {
                "input_tokens": u.input_tokens, "output_tokens": u.output_tokens,
                "requests": u.requests, "tool_calls": u.tool_calls + (apps.resumed if apps else 0),  # 이어서 하기로 서버가 돌린 호출도 센다
                "reasoning_tokens": reasoning_tokens,
                "cache_read_tokens": u.cache_read_tokens or int(details.get("cache_read_input_tokens") or 0),
                "cache_write_tokens": u.cache_write_tokens or int(details.get("cache_creation_input_tokens") or 0),
            }
            out = result.output
            if apps is not None and isinstance(out, DeferredToolRequests):  # 연결 대기로 멈춤 → runs.pending_json · run_summary.pending
                activity.pending = [apps.pending[c.tool_call_id] for c in out.calls if c.tool_call_id in apps.pending]

        # BrewAI 가 정한 값(CUSTOM value · REST)은 snake_case. AG-UI 자체 필드만 camelCase
        meta = {
            "run_id": req.run_id,
            "thread_id": req.thread_id,
            "model": model.id,
            "model_label": model.label,
            "provider": model.provider,
            "provider_label": model.provider_label,
            "reasoning": effective,
            "reasoning_requested": req.reasoning,
            "reasoning_supported": model.supports_reasoning,
            "tools": [t.name for t in self.tools] if model.supports_tools else [],
            "skills": [s.name for s in self.skills.list()] if model.supports_tools else [],
            "turn": len(blobs) + 1,
            "space_id": scope.space_id,
            "project_id": scope.project_id,
            "apps": scope.apps.handles if scope.apps is not None and model.supports_tools else [],
            "resume": req.resume,
        }
        llm = self._model_factory(model.id)
        if effective != "off" and model.supports_tools and _signed_thinking(model):
            llm = _ThinkFirstOnly(llm)
        apps = activity.apps
        toolsets: list[AbstractToolset[None]] | None = None
        if model.supports_tools:  # 실행마다 동시 실행 상한 하나 (기본 툴 · 앱 도구가 같이 센다)
            gate = asyncio.Semaphore(MAX_PARALLEL_TOOLS)
            toolsets = [bounded(self._toolset, gate=gate), *([bounded(_AppTools(apps), gate=gate)] if apps else [])]
        # 실행 지침 = 앱 목록 블록 (정렬 고정 = 프롬프트 캐시) → 프로젝트 지침 (conductor 규칙 · 앱 목록 뒤에)
        block = apps.apps.prompt() if apps else ""
        instructions = "\n\n".join(x for x in (block, scope.instructions) if x) or None
        events = single.run_stream(
            model=llm,
            message_history=history,
            deferred_tool_results=resumed,
            instructions=instructions,
            model_settings=settings,
            toolsets=toolsets,
            usage_limits=UsageLimits(request_limit=MAX_MODEL_REQUESTS),
            on_complete=on_complete,
        )
        return single.streaming_response(_RunStream(events, activity, meta, req.run_id, model))  # type: ignore[arg-type]
