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
  게이트웨이 mode = responses 인 모델 (Azure 사용자 지정 배포 azure/responses/…) = 같은 provider 의 /v1/responses (OpenAIResponsesModel).
  LiteLLM 의 chat→Responses 다리를 안 탄다: 1.106.2 다리는 스트림 툴 인자를 두 번 이어 붙인다 ('{…}{…}' → json_invalid → model_error).
  설정 = response_settings (id 안 보냄 = 기록 전체 · 생각 요약) · 사용량 · 생각(요약 → ThinkingPart → REASONING_*)은 Pydantic AI 가 같은 모양으로
멀티턴 = 서버가 원본: 클라이언트가 보낸 messages 중 마지막 user 메시지만 쓰고, 앞 대화는 저장된 기록(message_history)으로.
범위 = forwardedProps.spaceId · projectId (새 대화만 · 판정은 app.py prepare). 프로젝트 지침은 시스템 프롬프트 '뒤'에 붙는다
(conductor 규칙을 덮지 못하게) · LiteLLM 요청 `user` = users.id (ADR-0011).
MCP 앱 (ADR-0013 · slice 05 · 판단은 connectors/session.py · 여기는 Pydantic AI 접착만)
  앱이 0개 = 프롬프트 · 도구 0 추가. 1개 이상 = 실행 지침에 앱 목록 한 줄(프로젝트 지침 앞) + 메타 도구 하나 use_app(app?, need)
  (app 을 비우면 서버가 캐시된 도구를 검색해 앱을 고른다 · search_tools 는 없다). MCP 도구는 공개된 것만 요청에 싣는다
  (defer_loading 을 안 쓴다 = Pydantic AI 의 자동 search_tools 도, 공개 때 끼우는 '도구가 생겼다' 시스템 글도 없다) · 도구 배열 = 고정 도구 뒤에 공개 순서대로
  use_app → ToolReturn(tools=[…4개]) = 그 대화에 고정 (기록의 ToolAvailabilityDeltaPart) · 대화당 12개
  활동 단계 = app:<handle> (tool:use_app 대신) · MCP 도구 = tool:<handle>__<도구> + CUSTOM brewai.app_tool {call_id, app, app_name, server_id, tool, write, label}
  연결 없음 = CallDeferred → 툴 단계 status waiting → CUSTOM brewai.app_auth {call_id, server{id, handle, name, domain}, mode ask|auto|manual,
    reason not_connected|expired|insufficient_scope, auto_open, scope} → run_summary.pending = [그 호출들] → runs.pending_json
  공유됐지만 안 가져온 앱 = CUSTOM brewai.app_needs_import {server{id, name, domain}, via} (실행은 계속 · 모델이 안내)
  이어서 하기 = forwardedProps.resume {call_id} (메시지 없이) → 서버가 기록의 그 호출을 다시 계산(UI 는 근거 아님) → deferred_tool_results
요청 토큰 (slice 05 '토큰' · tests/test_tokens.py 가 상한을 못 박는다)
  고정 앞부분 = 도구 정의 + 시스템 지침 (날짜 · 시각 없음 · 정렬 고정 = 대화 · 턴 · 분이 바뀌어도 같은 바이트)
  날짜 · 시각 = 그 턴의 사용자 메시지 앞에 한 줄 (tools.now_line · 기록에 남는다 = 다음 턴에도 같은 바이트)
  지난 턴의 도구 결과 = 앞부분 + '줄임' (HISTORY_RESULT_BYTES · 저장은 원본 그대로 · use_app 결과는 그대로) · 이번 턴은 원본
  Claude 모델 = LiteLLM cache_control_injection_points (system + 마지막 메시지 · LiteLLM 1.106.2 anthropic_cache_control_hook)
  · OpenAI · Gemini = 앞부분이 같으면 저절로 캐시
  앞 요청 = 다음 요청의 앞부분: 한 턴의 도구 루프 안, 그리고 지난 턴 결과가 HISTORY_RESULT_BYTES 아래일 때까지 (넘으면 다음 턴에 줄임으로 바뀐다)
  · use_app 공개 = 도구 배열이 바뀐다 (Anthropic 은 도구 → system → 메시지 순이라 캐시가 처음부터)
에이전트 팀 (slice 06 · 판단은 team.py · 여기는 Pydantic AI 접착만)
  delegate 는 team.offer_team 이 켠 실행에만 (복합 신호 · 그 대화에 이미 보였음 = sticky · 이어서 하기 = 멈춘 실행 그대로) → 안 켜면 요청 바이트가 slice 05 그대로
  도구 배열 = [use_skill, delegate, use_app, …공개된 MCP] (delegate 는 고정 앞부분 · 공개 도구는 계속 맨 뒤) · 지침은 안 바뀐다
  delegate 하나 = 팀원 하나 = 팀원 Agent(name=member) 의 run_stream_events 한 번 (같은 모델 · 추론 끔 · 자기 RunUsage · 요청 4 ·
    읽기 전용 ready 앱 도구 · 기록 · now_line 없음 · task 만). 총괄 gate 밖 · 팀원 도구는 팀 공용 member_gate
  이벤트: STEP_STARTED agent:<a1> → TOOL_CALL_START/ARGS/END(delegate) → CUSTOM brewai.team_member(시작) → brewai.agent_step(팀원 도구 열림 ·
    닫힘)* → brewai.team_member(끝) → TOOL_CALL_RESULT → STEP_FINISHED agent:<a1>. 팀원 이벤트는 늘 그 delegate 의 END 뒤 · RESULT 앞
    (팀 실행만 _RunStream 이 FIFO 큐 하나를 읽는다 · pump 태스크가 AG-UI 이벤트를 넣고 팀원도 같은 큐에). 팀원 사이 순서는 정하지 않는다
  기록: runs.steps = 평평한 목록 + 자식 줄 {parent, agent} · delegate ToolReturn.metadata = 팀원 요약 (render_run 이 도구 칸에) ·
    사용량 = 총괄 + 팀원 합 (usage_events 한 줄 · run_summary.usage.members) · 팀원 대화 기록은 저장 안 함
"""

from __future__ import annotations

import asyncio
import json
import logging
import base64
import re
import time
from collections.abc import AsyncGenerator, AsyncIterator, Awaitable, Callable, Iterator, Sequence
from contextlib import asynccontextmanager, contextmanager, suppress
from dataclasses import dataclass, field, replace
from typing import Annotated, Any, Literal, NotRequired, Protocol, TypedDict

from ag_ui.core import (
    BaseEvent,
    CustomEvent,
    EventType,
    RunErrorEvent,
    StepFinishedEvent,
    StepStartedEvent,
    TextInputContent,
    UserMessage,
)
from ag_ui.core import DocumentInputContent, ImageInputContent, InputContentDataSource
from openai import APIConnectionError, APIStatusError, AsyncOpenAI
from pydantic import ValidationError
from pydantic import Field, TypeAdapter
from pydantic_ai import Agent, AgentRunResultEvent, FunctionToolset, RunContext, Tool
from pydantic_ai.exceptions import CallDeferred, ModelConnectionError, ModelHTTPError, UsageLimitExceeded
from pydantic_ai.messages import (
    INTERRUPTED_TOOL_RETURN_CONTENT,
    BinaryContent,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
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
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIChatModelSettings, OpenAIResponsesModel, OpenAIResponsesModelSettings
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.profiles.openai import OpenAIModelProfile
from pydantic_ai.providers.litellm import LiteLLMProvider
from pydantic_ai.settings import ModelSettings
from pydantic_ai.tool_manager import ParallelExecutionMode, ToolManager
from pydantic_ai.tools import DeferredToolRequests, DeferredToolResults, ToolDefinition
from pydantic_ai.toolsets import AbstractToolset, ToolsetTool, WrapperToolset
from pydantic_ai.toolsets.external import TOOL_SCHEMA_VALIDATOR
from pydantic_ai.ui.ag_ui import AGUIAdapter, AGUIEventStream
from pydantic_ai.usage import RunUsage, UsageLimits
from starlette.requests import Request
from starlette.responses import Response

from . import diagnose as dx
from . import files as fl
from . import team as tm
from .connectors.client import split_public
from .connectors.session import AppSession, AuthNeeded, MemberApps, Revealed
from .models import ModelChoice
from .skills import NAME_RE as SKILL_NAME_RE
from .skills import SkillRegistry
from .tools import DELEGATE, USE_APP, USE_SKILL, ToolSpec, now_line, step_label, tool_label

log = logging.getLogger("conductor.agent")

try:  # 팀원 span (opentelemetry-api 만 · SDK 가 없으면 no-op · Langfuse 는 slice 08)
    from opentelemetry import trace as _otel
except ImportError:  # pragma: no cover - pydantic-ai 가 opentelemetry-api 를 끌어온다
    _otel = None  # type: ignore[assignment]

# 시스템 지침 = 날마다 같은 글 (날짜 · 시각은 사용자 메시지 앞 한 줄 = now_line) → 프롬프트 캐시의 고정 앞부분
INSTRUCTIONS = "너는 BrewAI 에이전트다. 한국어로 짧고 정확하게 답한다. 서로 상관없는 도구 호출은 한 응답에 같이 부른다."
HISTORY_RESULT_BYTES = 600  # 지난 턴 도구 결과 하나가 다시 실리는 크기 (실측: 12KB 결과 둘 = 후속 질문 입력의 70%)
HISTORY_HEAD_BYTES = 400  # 그중 앞부분 (나머지는 '줄임' 표시)
# Claude (Anthropic · Bedrock · Vertex 의 claude-*) = 명시 캐시 표시가 있어야 캐시한다. LiteLLM 이 받는 요청 칸 (1.106.2
# integrations/anthropic_cache_control_hook.py · LITELLM_ONLY_PARAMS = provider 로는 안 간다): system 메시지 + 마지막 메시지
CACHE_POINTS: list[dict[str, Any]] = [{"location": "message", "role": "system"}, {"location": "message", "index": -1}]

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
_FILE_ID = re.compile(r"^f_[0-9a-f]{20}$")  # files.py Files.add
MAX_FILES = fl.MAX_FILES_PER_MESSAGE

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


USE_APP_DESCRIPTION = "앱 도구를 꺼낸다. app = 목록의 이름 (모르면 비움), need = 할 일. 이미 꺼낸 도구는 바로 부른다."
# 손으로 쓴 짧은 스키마 (설명 · 길이 제한은 서버가 본다: session.use_app 이 need 300자 · app 은 목록에서만 찾는다)
USE_APP_SCHEMA: dict[str, Any] = {
    "type": "object", "properties": {"app": {"type": "string"}, "need": {"type": "string"}}, "required": ["need"],
}


class _UseAppArgs(TypedDict):
    app: NotRequired[Annotated[str, Field(max_length=200)]]
    need: Annotated[str, Field(max_length=2000)]


_USE_APP_ARGS = TypeAdapter(_UseAppArgs)
_USE_APP_DEF = ToolDefinition(name=USE_APP, description=USE_APP_DESCRIPTION, parameters_json_schema=USE_APP_SCHEMA, timeout=APP_TOOL_TIMEOUT_S)


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
    files: tuple[str, ...] = ()  # forwardedProps.files = 이번 턴 첨부 id (PUT /api/files 로 올린 내 파일 · 판정은 app.py prepare)


@dataclass(frozen=True)
class RunScope:
    """prepare 가 정한 실행 범위 (누가 · 어디서 · 프로젝트 지침)."""

    user_id: str | None = None
    space_id: str | None = None
    project_id: str | None = None
    instructions: str | None = None  # 프로젝트 지침 (시스템 프롬프트 뒤에 붙는다)
    apps: AppSession | None = None  # 이 사람이 쓸 수 있는 MCP 앱 (없으면 None = 앱 목록 · use_app 0)
    resume: tuple[str, ...] = ()  # 이어서 하기: 서버가 다시 계산할 대기 호출 id (prepare 가 runs.pending_json 으로 확인)
    # 파일 (slice 07 · ADR-0015): 이번 턴 첨부(files.Attachment) · read_file 로 읽을 수 있는 파일(대화 + 프로젝트) · 프로젝트 파일 한 줄
    attachments: tuple[Any, ...] = ()
    readable: tuple[Any, ...] = ()
    file_store: Any = None
    file_line: str = ""


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


def diagnose(error: BaseException, *, reasoning: bool = False) -> dx.Diagnosis:
    """Pydantic AI 가 OpenAI SDK 오류를 ModelHTTPError · ModelConnectionError 로 감싸서 준다 → diagnose.classify_http.
    게이트웨이 키 실패(LiteLLM 프록시 type)와 provider 키 실패(provider type · …Exception 문구)를 type 으로 가른다.
    reasoning = 이번 실행이 생각 파라미터를 실었다 (그때만 reasoning_unsupported)."""
    if isinstance(error, ModelHTTPError):
        return dx.classify_http(error.status_code, error.provider_error_type, error.body, reasoning=reasoning)
    if isinstance(error, ModelConnectionError):
        return dx.unreachable()
    if isinstance(error, UsageLimitExceeded):
        return dx.Diagnosis(code="run_limit", detail=None)
    return dx.Diagnosis(code="model_error", detail=None)


def error_code(error: BaseException) -> str:
    return diagnose(error).code


class _EventStream(AGUIEventStream):
    reasoning = False  # 이번 실행이 생각 파라미터를 실었다 (_Adapter.reasoning · 끔이면 생각 거절로 보지 않는다)

    async def on_error(self, error: Exception) -> AsyncIterator[BaseEvent]:
        d = diagnose(error, reasoning=self.reasoning)
        # 진단 한 줄: status · LiteLLM type · 가린 provider 문구 (요청 본문 · 키는 안 찍는다)
        log.warning("chat run failed: %s error=%s", d.log_fields(), type(error).__name__)
        async for event in super().on_error(error):
            if isinstance(event, RunErrorEvent):
                extra = {"detail": d.detail} if d.detail else {}
                event = RunErrorEvent(message=PUBLIC_ERRORS[d.code], code=d.code, timestamp=event.timestamp, **extra)
            yield event


class _Adapter(AGUIAdapter):
    # 주의: 생성자 인자가 pydantic-ai 2.59 내부와 묶여 있다. 업그레이드 때 test_run_error_is_sanitized 가 잡는다.
    reasoning = False  # _stream 이 정한다 (settings 에 생각 파라미터가 실렸나)

    def build_event_stream(self) -> _EventStream:
        stream = _EventStream(
            self.run_input,
            accept=self.accept,
            ag_ui_version=self.ag_ui_version,
            manage_system_prompt=self.manage_system_prompt,
            preserve_file_data=self.preserve_file_data,
        )
        stream.reasoning = self.reasoning
        return stream


# 서명된 thinking 블록을 다시 보내야 하는 provider (Claude: Anthropic · Bedrock · Vertex 의 claude-*)
_SIGNED_THINKING = ("anthropic", "bedrock")
_REASONING_KEYS = ("openai_reasoning_effort", "thinking")


def _signed_thinking(model: ModelChoice) -> bool:
    return model.provider in _SIGNED_THINKING or "claude" in model.id.lower()


def wants_cache_markers(model: ModelChoice) -> bool:
    """명시 캐시 표시가 필요한 모델 = Claude (서명된 thinking 과 같은 판정: Anthropic · Bedrock · Vertex 의 claude-*). OpenAI · Gemini 는
    앞부분이 같으면 저절로 (그쪽에 보내면 LiteLLM 이 메시지에 cache_control 칸을 붙일 수 있다 → 안 보낸다)."""
    return _signed_thinking(model)


def response_settings(model: ModelChoice, settings: OpenAIChatModelSettings | None) -> OpenAIChatModelSettings | None:
    """responses 모델 (/v1/responses) 의 설정. chat 모델은 그대로 (hello 바이트 그대로 · tests/fixtures/pre-team-golden.json).
    같은 키가 Responses 칸으로 간다 (Pydantic AI 2.59 OpenAIResponsesModel._responses_create): max_tokens → max_output_tokens ·
    openai_user → user · openai_reasoning_effort → reasoning.effort · extra_body(drop_params · cache_control_injection_points) 그대로.
    openai_send_reasoning_ids=False = 기록의 rs_ · fc_ · msg_ id 를 안 싣는다 → 지난 응답을 늘 글 그대로 다시 보낸다 (previous_response_id 안 씀 ·
    openai_store 는 안 건드린다 = provider 기본 · 저장돼 있어도 기대지 않는다). id 는 그 응답을 만든 배포에 저장된 항목이라 LiteLLM 모델 그룹이 다른 배포로
    보내거나 저장이 꺼져 있으면 400 (Item not found) 이고, chat 모델이 만든 기록(id 없음)과 섞여도 같은 모양이 된다.
    (profile 기본값도 이름에 달렸다: 'gpt-5.1' 같은 이름은 True · 'GPT-6.1 Terra' 는 False → 여기서 못 박는다)
    id 를 안 보내면 Pydantic AI 는 생각(ThinkingPart)을 '<think>…</think>' assistant 글로 다시 보낸다 → _NoThinkingReplay 가 뺀다."""
    if not model.responses_api:
        return settings
    return OpenAIResponsesModelSettings(**(settings or {}), openai_send_reasoning_ids=False)  # type: ignore[typeddict-item]


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


# responses 모델 profile 덮어쓰기 (LiteLLM 별칭 이름과 상관없이 같은 요청 모양):
# encrypted 끔 = include ['reasoning.encrypted_content'] 를 안 달라 한다 (id 를 안 보내니 다시 보낼 곳이 없다 · 받아도 버린다) ·
# reasoning context 끔 = 생각 끔이어도 'gpt-5.5' 같은 이름이면 reasoning: {context: 'all_turns'} 를 싣던 것 (Pydantic AI _translate_thinking) 을 막는다
_RESPONSES_PROFILE = OpenAIModelProfile(
    openai_supports_encrypted_reasoning_content=False, openai_responses_supports_reasoning_context=False
)


def _without_thinking(messages: Sequence[ModelMessage]) -> list[ModelMessage]:
    """모델 응답의 생각(ThinkingPart)을 뺀다. 생각만 있던 응답은 통째로 뺀다 (load_history 와 같은 규칙)."""
    out: list[ModelMessage] = []
    for m in messages:
        if isinstance(m, ModelResponse):
            parts = [p for p in m.parts if not isinstance(p, ThinkingPart)]
            if not parts:
                continue
            if len(parts) != len(m.parts):
                m = replace(m, parts=parts)
        out.append(m)
    return out


class _NoThinkingReplay(WrapperModel):
    """responses 모델 (/v1/responses): 이번 실행 안에서도 앞 응답의 생각을 다시 보내지 않는다.
    id 를 안 보내는 설정(response_settings)에선 Pydantic AI 2.59 _map_messages 가 ThinkingPart 를 reasoning 항목 대신
    {'role': 'assistant', 'content': '<think>\\n…\\n</think>'} 글로 싣는다 → 툴 루프 두 번째 요청부터 모델이 자기 생각을 태그째 보고
    답 글에 흉내 낼 수 있고 (Responses output_text 는 태그를 안 가른다 → 화면에 그대로) 토큰만 쓴다.
    지난 턴은 load_history 가 이미 뺀다 · 이건 같은 실행 안의 툴 루프용. 총괄 · 팀원 둘 다 (model_for)."""

    async def request(
        self, messages: list[ModelMessage], model_settings: ModelSettings | None, model_request_parameters: ModelRequestParameters
    ) -> ModelResponse:
        return await self.wrapped.request(_without_thinking(messages), model_settings, model_request_parameters)

    @asynccontextmanager
    async def request_stream(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
        run_context: Any = None,
    ) -> AsyncGenerator[StreamedResponse]:
        async with self.wrapped.request_stream(_without_thinking(messages), model_settings, model_request_parameters, run_context) as stream:
            yield stream


def _user_text(message: UserMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    return "".join(getattr(part, "text", "") or "" for part in content)


def _tool(s: ToolSpec) -> Tool[None]:
    if s.schema is None:
        return Tool(s.function, takes_ctx=False, name=s.name, description=s.description, requires_approval=s.requires_approval)
    t: Tool[None] = Tool.from_schema(s.function, s.name, s.description, s.schema)  # 손으로 쓴 짧은 스키마 (use_skill = 이름 enum)
    t.requires_approval = s.requires_approval
    return t


def file_toolset(scope: RunScope) -> FunctionToolset[None] | None:
    """read_file (slice 07 · ADR-0015) = 이 대화 · 프로젝트에 파일이 있을 때만 (없으면 도구 배열 그대로 = hello 바이트 그대로)."""
    if not scope.readable or scope.file_store is None:
        return None
    rows = list(scope.readable)
    store = scope.file_store

    def read_file(file: str, page: str | None = None, query: str | None = None) -> dict[str, Any]:
        f = fl.find(rows, file)
        if f is None:
            return {"error": "file_not_found", "message": "그 파일이 없다. 이 대화의 파일: " + ", ".join(f"{r.name} ({r.id})" for r in rows[:20])}
        return store.read(f, page=page, query=query)  # type: ignore[no-any-return]

    return FunctionToolset([Tool.from_schema(read_file, fl.READ_FILE, fl.READ_FILE_DESC, fl.READ_FILE_SCHEMA)], max_retries=1, timeout=TOOL_TIMEOUT_S)


def with_files(last: UserMessage, prompt: str, attachments: Sequence[Any]) -> UserMessage:
    """이번 질문 + 첨부: 글 블록(<file …>) · 원본(이미지 · PDF 를 받는 모델 = Image/DocumentInputContent → Pydantic AI BinaryContent)."""
    parts: list[Any] = [TextInputContent(text=prompt)] if prompt else []
    for a in attachments:
        parts.append(TextInputContent(text=a.text))
        if a.data is not None:
            src = InputContentDataSource(value=base64.b64encode(a.data).decode(), mime_type=a.file.mime)
            parts.append(ImageInputContent(source=src) if a.file.kind == "image" else DocumentInputContent(source=src))
    return UserMessage(id=last.id, content=parts)


def strip_originals(messages: Sequence[ModelMessage], names: Sequence[str]) -> list[ModelMessage]:
    """저장 전: 원본 바이트(BinaryContent)를 이름 한 줄로 (다음 턴에 다시 안 보낸다 · DB 가 커지지 않게 · 필요하면 read_file)."""
    it = iter(names)
    out: list[ModelMessage] = []
    for m in messages:
        if isinstance(m, ModelRequest):
            parts = []
            for p in m.parts:
                if isinstance(p, UserPromptPart) and not isinstance(p.content, str):
                    p = replace(p, content=[f"[첨부 원본: {next(it, '파일')} · 다시 보려면 read_file]" if isinstance(x, BinaryContent) else x
                                            for x in p.content])
                parts.append(p)
            m = replace(m, parts=parts)
        out.append(m)
    return out


def build_toolset(specs: Sequence[ToolSpec]) -> FunctionToolset[None]:
    """툴 목록(ToolSpec) → Pydantic AI 툴셋. MCP 앱 툴셋(_AppTools)은 run 의 toolsets 에 뒤로 더한다 (도구 배열 = 고정 도구 먼저)."""
    return FunctionToolset([_tool(s) for s in specs], max_retries=1, timeout=TOOL_TIMEOUT_S)


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
    """use_app (상시 · 맨 앞) + 공개된 MCP 도구만 (공개 순서 · 대화 기록 + 이번 실행). 실행마다 만든다. 판단 = connectors/session.py.
    defer_loading 을 안 쓴다: Pydantic AI 가 deferred 도구가 있으면 search_tools 를 저절로 싣고, 공개 때 '도구가 생겼다' 시스템 글을
    끼운다 (Claude 는 LiteLLM 이 그 글을 system 으로 올려 캐시가 깨진다). 공개 전 도구는 아예 목록에 없다 = 요청에 0."""

    def __init__(self, run: _AppRun) -> None:
        self.run = run

    @property
    def id(self) -> str:
        return "brewai_apps"

    def revealed(self, ctx: RunContext[None]) -> list[str]:
        """공개된 MCP 도구 이름 (공개 순서 = 도구 배열 순서 고정): 대화 기록 → 이번 실행의 장부 → 나머지(이름 순)."""
        order = [*revealed_order(ctx.messages), *self.run.apps.revealed_now, *sorted(ctx.discovered_tool_names)]
        return [n for n in dict.fromkeys(order) if split_public(n)]

    async def get_tools(self, ctx: RunContext[None]) -> dict[str, ToolsetTool[None]]:
        out: dict[str, ToolsetTool[None]] = {
            USE_APP: ToolsetTool(toolset=self, tool_def=_USE_APP_DEF, max_retries=1, args_validator=_USE_APP_ARGS.validator),  # type: ignore[arg-type]
        }
        known = {t.public: t for t in self.run.apps.tools()}
        for name in self.revealed(ctx):
            t = known.get(name)
            if t is None:
                continue
            d = t.definition()
            out[d["name"]] = ToolsetTool(
                toolset=self, max_retries=1, args_validator=TOOL_SCHEMA_VALIDATOR,
                tool_def=ToolDefinition(name=d["name"], description=d["description"], parameters_json_schema=d["parameters"],
                                        metadata=d["metadata"], timeout=APP_TOOL_TIMEOUT_S),
            )
        return out

    async def call_tool(self, name: str, tool_args: dict[str, Any], ctx: RunContext[None], tool: ToolsetTool[None]) -> Any:
        call_id = ctx.tool_call_id or ""
        if name == USE_APP:
            got = await self.run.apps.use_app(tool_args.get("app"), tool_args.get("need"), revealed=self.revealed(ctx))
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


def revealed_order(messages: Sequence[ModelMessage]) -> list[str]:
    """기록에서 공개된 MCP 도구 이름 · 공개 순서 (use_app 의 ToolReturn.tools · 예전 기록의 search_tools 결과)."""
    out: dict[str, None] = {}
    for m in messages:
        if isinstance(m, ModelRequest):
            for p in m.parts:
                if isinstance(p, ToolAvailabilityDeltaPart):
                    out.update(dict.fromkeys(p.tools_added))
                elif isinstance(p, ToolSearchReturnPart) and isinstance(p.content, dict):
                    found = p.content.get("discovered_tools")
                    out.update(dict.fromkeys(x["name"] for x in found if isinstance(x, dict) and isinstance(x.get("name"), str)) if isinstance(found, list) else {})
    return list(out)


def revealed_names(messages: Sequence[ModelMessage]) -> set[str]:
    return set(revealed_order(messages))


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


# ── 에이전트 팀 (team.py 의 판단 → Pydantic AI 도구 · 팀원 실행 · 이벤트) ─────────────────────


class _DelegateArgs(TypedDict):
    role: Annotated[str, Field(max_length=200)]
    task: Annotated[str, Field(max_length=4000)]


_DELEGATE_ARGS = TypeAdapter(_DelegateArgs)
# timeout = 기록용 (Pydantic AI 는 FunctionToolset 만 timeout 을 지킨다 · 팀원은 _TeamRun.run 의 asyncio.timeout → member_timeout 결과)
_DELEGATE_DEF = ToolDefinition(name=DELEGATE, description=tm.DELEGATE_DESCRIPTION, parameters_json_schema=tm.DELEGATE_SCHEMA,
                               timeout=tm.MEMBER_TIMEOUT_S)
_FINAL = ("done", "error", "cancelled")


@contextmanager
def _member_span(attrs: dict[str, Any]) -> Iterator[Any]:
    """팀원 하나 = span 하나 (session._span 은 지금 span 에 속성만 = 부모 span 을 못 만든다). 역할 · 할 일 · 결과 글은 안 남긴다."""
    if _otel is None:
        yield None
        return
    tracer = _otel.get_tracer("brewai.conductor")
    with tracer.start_as_current_span("brewai.team.member", attributes=attrs, record_exception=False, set_status_on_exception=False) as span:
        yield span


@dataclass
class _TeamRun:
    """실행 하나의 팀: 명단(team.Roster) · 이벤트 큐 (_RunStream 이 읽는다) · 팀원 도구 gate (팀 공용 · 총괄 gate 와 따로) ·
    팀원 실행에 필요한 것 (팀원 Agent · 같은 모델 · 설정 · 앱 · 활동 기록 · span 속성)."""

    agent: Agent[None, str]
    model: Model
    model_label: str
    settings: OpenAIChatModelSettings
    activity: _Activity
    apps: AppSession | None
    user_id: str | None
    thread_id: str
    roster: tm.Roster = field(default_factory=tm.Roster)
    # (kind, tag, value): main = (taken 신호, AG-UI 이벤트) · member = (delegate call id, CUSTOM 이벤트) · fail · end
    queue: asyncio.Queue[tuple[str, Any, Any]] = field(default_factory=asyncio.Queue)
    member_gate: asyncio.Semaphore = field(default_factory=lambda: asyncio.Semaphore(tm.MEMBER_PARALLEL))

    def emit(self, parent: str, event: BaseEvent) -> None:
        self.queue.put_nowait(("member", parent, event))

    def step_status(self, call_id: str) -> str | None:
        """delegate 단계를 닫을 상태 (결과가 왔을 때). 돌지 못한 호출(인자 검사 실패 = 재시도 안내) = error · delegate 가 아니면 None."""
        m = self.roster.members.get(call_id)
        if m is None:
            return None
        return m.status if m.status in _FINAL else "error"

    @staticmethod
    def _usage(m: tm.Member) -> dict[str, int]:
        return {k: m.usage.get(k, 0) for k in ("requests", "input_tokens", "output_tokens", "tool_calls")}

    def member_event(self, m: tm.Member, ms: int | None = None) -> CustomEvent:
        """brewai.team_member (시작 1번 + 끝 1번 · 화면은 call_id 로 upsert)."""
        value: dict[str, Any] = {"call_id": m.call_id, "agent": m.agent, "role": m.role, "task": tm.short(m.task, tm.TASK_EVENT_MAX),
                                 "model_label": self.model_label, "tools": m.tools, "status": m.status}
        if ms is not None:
            value["ms"] = ms
        if m.code:
            value["code"] = m.code
        if m.status in _FINAL:
            value["usage"] = self._usage(m)
        return CustomEvent(name="brewai.team_member", value=value)

    def metadata(self, m: tm.Member) -> dict[str, Any]:
        """delegate ToolReturn.metadata (모델에는 안 간다) → 기록 → render_run 이 도구 칸에 (다시 열어도 같은 트리)."""
        steps = [dict(s) for s in self.activity.steps if s.get("parent") == m.call_id]
        out = {"agent": m.agent, "role": m.role, "task": m.task, "model_label": self.model_label, "tools": m.tools, "steps": steps,
               "usage": self._usage(m), "status": m.status}
        return out | ({"code": m.code} if m.code else {})

    def reject(self, m: tm.Member, code: str) -> ToolReturn:
        m.status, m.code = "error", code
        self.emit(m.call_id, self.member_event(m, 0))
        return ToolReturn(tm.rejected(code), metadata=self.metadata(m))

    def _tool_opened(self, m: tm.Member, part: ToolCallPart, view: MemberApps | None) -> None:
        name = part.tool_name
        app: str | None = None
        if name == USE_APP:
            try:
                args = part.args_as_dict()
            except ValueError:
                args = {}
            found = view.pick(args.get("app"), args.get("need")) if view is not None else None
            step = f"app:{found.handle if found else 'unknown'}"
            label = step_label(step, view.labels() if view is not None else {})
            app = found.handle if found else None
        else:
            t = view.index.get(name) if view is not None else None
            step, label = f"tool:{name}", (t.label if t else tool_label(name))
            app = t.app.handle if t else None
        row = self.activity.open_child(m.call_id, m.agent, f"{m.agent}:{part.tool_call_id}", step, label, app)
        if row is not None:
            self.emit(m.call_id, CustomEvent(name="brewai.agent_step", value=row))

    def _tool_closed(self, m: tm.Member, part: ToolReturnPart | RetryPromptPart) -> None:
        bad = isinstance(part, RetryPromptPart) or (isinstance(part.content, dict) and "error" in part.content)
        row = self.activity.close_child(f"{m.agent}:{part.tool_call_id}", "error" if bad else "done")
        if row is not None:
            self.emit(m.call_id, CustomEvent(name="brewai.agent_step", value=row))

    async def run(self, m: tm.Member) -> ToolReturn:
        """팀원 하나를 끝까지 (task 만 · 기록 없음). 실패는 결과로 (총괄 실행은 계속) · 바깥 취소 = 팀원도 멈춘다 (HTTP 까지)."""
        view = self.apps.member_view(m.agent) if self.apps is not None else None
        m.tools = [{"name": USE_APP, "label": tool_label(USE_APP)}] if view is not None else []
        m.status = "running"
        started = time.monotonic()
        self.emit(m.call_id, self.member_event(m))
        usage = RunUsage()
        toolsets = [bounded(_AppTools(_AppRun(view)), gate=self.member_gate)] if view is not None else None
        limits = UsageLimits(request_limit=tm.MEMBER_REQUEST_LIMIT, input_tokens_limit=tm.MEMBER_INPUT_TOKENS_LIMIT)
        attrs = {"user.id": self.user_id or "", "session.id": self.thread_id, "brewai.agent.id": m.agent, "gen_ai.agent.name": "member"}
        with _member_span(attrs) as span:
            try:
                async with asyncio.timeout(tm.MEMBER_TIMEOUT_S):
                    async with self.agent.run_stream_events(
                        m.task or m.role, model=self.model, model_settings=self.settings, toolsets=toolsets, usage=usage,
                        usage_limits=limits, instructions=(view.prompt() or None) if view is not None else None,
                    ) as stream:
                        async for ev in stream:
                            if isinstance(ev, FunctionToolCallEvent):
                                self._tool_opened(m, ev.part, view)
                            elif isinstance(ev, FunctionToolResultEvent):
                                self._tool_closed(m, ev.part)
                            elif isinstance(ev, AgentRunResultEvent):
                                m.answer = str(ev.result.output or "")
                m.status = "done"
            except asyncio.CancelledError:
                m.status, m.code = "cancelled", None
                raise
            except TimeoutError:
                m.status, m.code = "error", "member_timeout"
            except UsageLimitExceeded:
                m.status, m.code = "error", "member_limit"
            except Exception as e:  # 팀원 실패는 그 팀원만 (제공자 원문 · 키는 안 싣는다 = diagnose 코드만)
                m.status, m.code = "error", tm.error_code(diagnose(e).code)
                log.warning("team member failed: agent=%s code=%s error=%s", m.agent, m.code, type(e).__name__)
            finally:
                u = usage
                details = u.details or {}
                m.usage = {
                    "requests": u.requests, "input_tokens": u.input_tokens, "output_tokens": u.output_tokens, "tool_calls": u.tool_calls,
                    "reasoning_tokens": u.output_reasoning_tokens or int(details.get("reasoning_tokens") or 0),
                    "cache_read_tokens": u.cache_read_tokens or int(details.get("cache_read_input_tokens") or 0),
                    "cache_write_tokens": u.cache_write_tokens or int(details.get("cache_creation_input_tokens") or 0),
                }
                if view is not None:
                    m.needs_app = list(view.needs)
                    m.tools = [*m.tools, *({"name": n, "label": view.tool_label(n) or n, "app": view.index[n].app.handle}
                                          for n in view.revealed_now if n in view.index)]
                for row in self.activity.close_children(m.agent, "cancelled" if m.status == "cancelled" else "error"):
                    self.emit(m.call_id, CustomEvent(name="brewai.agent_step", value=row))
                self.emit(m.call_id, self.member_event(m, int((time.monotonic() - started) * 1000)))
                if span is not None:
                    span.set_attribute("brewai.agent.status", m.status)
                    span.set_attribute("gen_ai.usage.input_tokens", m.usage["input_tokens"])
                    span.set_attribute("gen_ai.usage.output_tokens", m.usage["output_tokens"])
        return ToolReturn(m.result(), metadata=self.metadata(m))


class _TeamTools(AbstractToolset[None]):
    """delegate 하나 (게이트가 켠 실행만 · 총괄 gate 밖). call_tool = 수 검사 → 팀원 실행 → 결과 · 오류 코드."""

    def __init__(self, team: _TeamRun) -> None:
        self.team = team

    @property
    def id(self) -> str:
        return "brewai_team"

    async def get_tools(self, ctx: RunContext[None]) -> dict[str, ToolsetTool[None]]:
        return {DELEGATE: ToolsetTool(toolset=self, tool_def=_DELEGATE_DEF, max_retries=1, args_validator=_DELEGATE_ARGS.validator)}  # type: ignore[arg-type]

    async def call_tool(self, name: str, tool_args: dict[str, Any], ctx: RunContext[None], tool: ToolsetTool[None]) -> Any:
        team = self.team
        m = team.roster.member(ctx.tool_call_id or "", tool_args.get("role"), tool_args.get("task"))
        # 한 응답의 delegate 수 = 지금 실행 중인 모델 응답 (병렬 실행 때 ctx.messages 의 마지막 = 그 응답 · 스파이크 확인)
        last = ctx.messages[-1] if ctx.messages else None
        n = sum(1 for p in last.parts if isinstance(p, ToolCallPart) and p.tool_name == DELEGATE) if isinstance(last, ModelResponse) else 0
        if n < tm.MIN_MEMBERS:
            return team.reject(m, "team_too_small")
        if not team.roster.admit(m):
            return team.reject(m, "team_full")
        return await team.run(m)


def ready_history(blobs: Sequence[str], *, resume: bool) -> list[ModelMessage]:
    """모델에 줄 기록. 새 질문인데 마지막 응답에 결과 없는 툴 호출(연결을 기다리다 그만둔 것)이 있으면 닫는다
    (Pydantic AI 는 그대로면 새 질문을 거절한다). 이어서 하기 = 그대로 둔다 (deferred_tool_results 가 채운다).
    더 앞의 열린 호출은 Pydantic AI 가 요청마다 스스로 닫는다. 지난 턴의 도구 결과는 줄인다 (compact_history ·
    이어서 하기 = 마지막 질문부터는 이번 턴이라 그대로)."""
    history = compact_history(load_history(blobs), keep_last_turn=resume)
    if not resume and open_calls(history):
        return repair_messages(history)
    return history


def compact_result(content: Any) -> Any:
    """지난 턴의 도구 결과 하나 → 앞부분 + '줄임' 표시 (HISTORY_RESULT_BYTES 아래면 그대로). untrusted · source 는 남긴다
    (남이 쓴 데이터라는 표시는 줄여도 그대로). 다시 필요하면 모델이 도구를 다시 부른다."""
    text = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False, default=str)
    size = len(text.encode("utf-8"))
    if size <= HISTORY_RESULT_BYTES:
        return content
    body = content.get("result", content) if isinstance(content, dict) else content
    body_text = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False, default=str)
    head = body_text.encode("utf-8")[:HISTORY_HEAD_BYTES].decode("utf-8", errors="ignore")
    keep = {k: content[k] for k in ("source", "untrusted", "name", "label", "error") if isinstance(content, dict) and k in content}
    return {**keep, "result": head.rstrip() + "…", "note": f"줄임: 지난 턴 결과 {size:,}바이트의 앞부분. 필요하면 다시 부른다."}


def compact_history(messages: list[ModelMessage], *, keep_last_turn: bool = False) -> list[ModelMessage]:
    """지난 턴들의 도구 결과를 compact_result 로 (메시지 수 · 순서 · call id · metadata 는 그대로 = on_complete 의 len(history) ·
    pinned_servers 가 산다). use_app · 예전 search_tools 결과는 안 줄인다 (작고, 공개한 도구 이름을 기록이 갖고 있어야 한다).
    keep_last_turn = 마지막 사용자 질문부터는 원본 (이어서 하기 = 그 턴이 아직 이번 턴이다)."""
    stop = len(messages)
    if keep_last_turn:
        stop = next((i for i in range(len(messages) - 1, -1, -1) if isinstance(messages[i], ModelRequest)
                     and any(isinstance(p, UserPromptPart) for p in messages[i].parts)), len(messages))
    def shrink(p: Any) -> bool:  # 예전 기록의 search_tools 결과도 그대로 (discovered_tools = 공개한 이름 · revealed_order 가 읽는다)
        return isinstance(p, ToolReturnPart) and not isinstance(p, ToolSearchReturnPart) and p.tool_name not in (USE_APP, "search_tools")

    out: list[ModelMessage] = []
    for i, m in enumerate(messages):
        if i < stop and isinstance(m, ModelRequest) and any(shrink(p) for p in m.parts):
            parts = [replace(p, content=compact_result(p.content)) if shrink(p) else p for p in m.parts]
            m = replace(m, parts=parts)
        out.append(m)
    return out


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
        out.extend(_without_thinking(messages))
    return out


def skill_card(result: Any) -> Any:
    """use_skill 결과 → 화면용 (지침 본문은 모델만 본다 · 화면엔 이름과 줄 수)."""
    if isinstance(result, dict) and isinstance(result.get("instructions"), str):
        return {k: v for k, v in result.items() if k != "instructions"} | {"lines": len(result["instructions"].splitlines())}
    return result


def render_run(blob: str | None, *, pending: Sequence[str] = (), carry: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    """저장된 실행 하나 → 화면용 답 (GET /api/threads/{id}). parts = 생각 · 툴 · 글 을 나온 순서대로.
    pending = 연결 대기로 멈춘 호출 id (그 툴 = status waiting). carry = 대화 전체에서 공유하는 툴 칸 (이어서 하기 실행의 결과가
    앞 실행의 대기 카드를 채운다). MCP 도구 = + app · app_name · write (기록의 ToolReturn metadata).
    delegate = + agent · role · task · model_label · tools · steps · usage · status · code (팀원 요약 · slice 06)."""
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
                            if t["name"] == USE_APP:  # 실시간 단계 이름(app:<handle> → '앱: <앱 이름>')과 같게
                                t["label"] = step_label(f"app:{p.metadata['app']}", {f"app:{p.metadata['app']}": p.metadata.get("app_name") or p.metadata["app"]})
                            elif p.metadata.get("label"):
                                t["label"] = p.metadata["label"]
                        elif t["name"] == DELEGATE and isinstance(p.metadata, dict) and isinstance(p.metadata.get("agent"), str):
                            # 팀원 카드: 실시간 brewai.team_member · agent_step 과 같은 칸 (steps = 그 팀원의 도구 줄 · parent = 이 호출)
                            keys = ("agent", "role", "task", "model_label", "tools", "steps", "usage", "status", "code")
                            t.update({k: p.metadata[k] for k in keys if k in p.metadata})
                            t["label"] = p.metadata.get("role") or t["label"]
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
    # 팀원 도구 줄 (자식 줄 {parent, agent}) = opened 밖 (batch · 열린 툴 검사에 안 섞인다) · finish 가 닫는다
    children: dict[str, int] = field(default_factory=dict)  # 열린 자식 줄 call id → steps 위치
    child_count: dict[str, int] = field(default_factory=dict)  # 팀원 → 저장한 도구 줄 수 (MEMBER_STEPS_MAX 넘으면 delegate 줄의 more)

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

    def open_child(self, parent: str, agent: str, call_id: str, name: str, label: str, app: str | None = None) -> dict[str, Any] | None:
        """팀원 도구 줄을 연다 → brewai.agent_step 값 (넘치면 None · delegate 줄 more +1)."""
        if self.closed:
            return None
        n = self.child_count.get(agent, 0)
        if n >= tm.MEMBER_STEPS_MAX:
            row = next((s for s in self.steps if s.get("call_id") == parent and "parent" not in s), None)
            if row is not None:
                row["more"] = row.get("more", 0) + 1
            return None
        self.child_count[agent] = n + 1
        step: dict[str, Any] = {"name": name, "label": label, "status": "running", "started_ms": self._ms(), "duration_ms": None,
                                "call_id": call_id, "parent": parent, "agent": agent, **({"app": app} if app else {})}
        self.children[call_id] = len(self.steps)
        self.steps.append(step)
        self._record()
        return dict(step)

    def close_child(self, call_id: str, status: str, *, record: bool = True) -> dict[str, Any] | None:
        i = self.children.pop(call_id, None)
        if i is None:
            return None
        step = self.steps[i]
        step.update(status=status, duration_ms=self._ms() - step["started_ms"])
        if record and not self.closed:
            self._record()
        return dict(step)

    def close_children(self, agent: str | None, status: str) -> list[dict[str, Any]]:
        """한 팀원(agent) · 모두(None)의 열린 도구 줄을 닫는다 (팀원이 멈춤 · 실패 · 실행 끝)."""
        ids = [c for c, i in self.children.items() if agent is None or self.steps[i].get("agent") == agent]
        return [r for r in (self.close_child(c, status) for c in ids) if r is not None]

    def finish(self) -> None:
        if self.closed:
            return
        self.closed = True
        end = "cancelled" if self.status == "cancelled" else ("error" if self.status == "error" else "done")
        for c in list(self.children):
            self.close_child(c, end, record=False)
        self.close_all(end)
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
    """AG-UI 이벤트 스트림 + 활동 단계. 클라이언트가 끊으면(CancelledError) · 스트림을 아예 못 열면(GC) 취소로 닫는다.
    팀 실행(team) = FIFO 큐 하나를 읽는다: pump 태스크가 AG-UI 이벤트를 넣고 팀원(_TeamRun.run)도 같은 큐에 넣는다 →
    팀원 이벤트가 늘 그 delegate 의 TOOL_CALL_RESULT 보다 먼저 (팀원이 끝나야 결과가 나온다). 팀 없는 실행 = 큐 없이 그대로."""

    def __init__(self, events: AsyncIterator[BaseEvent], activity: _Activity, meta: dict[str, Any], run_id: str, model: ModelChoice,
                 team: _TeamRun | None = None):
        self._activity = activity
        self._gen = self._run(events, meta, run_id, model, team)

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

    @staticmethod
    async def _pumped(events: AsyncIterator[BaseEvent], team: _TeamRun) -> AsyncIterator[tuple[str, str | None, Any]]:
        """팀 실행의 큐: ('main', None, AG-UI 이벤트) · ('member', delegate call id, CUSTOM 이벤트). pump 는 첫 읽기 때 만든다
        (= parallel_execution_mode.__enter__ 뒤 · 컨텍스트 변수 상속) · events.aclose() 는 pump 의 finally (같은 태스크에서 닫힌다).
        총괄 이벤트는 당겨 읽기 그대로 (backpressure): pump 는 하나 넣고 소비자가 다음을 달라고 할 때까지 기다린다 → 에이전트가 _run 보다
        앞서 가지 않는다 (툴 시작 = 그 응답의 TOOL_CALL_START 를 _run 이 다 본 뒤 · 끊기면 끝난 실행보다 먼저 멈춘다). 팀원만 put_nowait."""
        q = team.queue

        async def pump() -> None:
            try:
                async for ev in events:
                    taken = asyncio.Event()  # 소비자가 이 이벤트 다음을 달라고 했다 (= 이 이벤트를 다 처리했다)
                    q.put_nowait(("main", taken, ev))
                    await taken.wait()
            except Exception as e:  # noqa: BLE001 - 소비자 쪽에서 다시 던진다
                q.put_nowait(("fail", None, e))
            finally:
                close = getattr(events, "aclose", None)
                if close is not None:
                    with suppress(Exception):
                        await close()
                q.put_nowait(("end", None, None))

        task = asyncio.create_task(pump())
        try:
            while True:
                kind, tag, value = await q.get()
                if kind == "end":
                    return
                if kind == "fail":
                    raise value
                if kind == "main":
                    yield (kind, None, value)
                    tag.set()  # 다음을 달라고 왔다 = pump 가 다음 이벤트를 읽어도 된다
                else:
                    yield (kind, tag, value)
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    async def _run(self, events: AsyncIterator[BaseEvent], meta: dict[str, Any], run_id: str, model: ModelChoice,
                   team: _TeamRun | None = None) -> AsyncIterator[BaseEvent]:
        act = self._activity
        # TEXT_MESSAGE_START (와 바로 뒤 빈 END) 는 다음 이벤트까지 잡아 둔다: 글이면 '쓰기' 단계 뒤에, 툴 앞 빈 메시지면
        # 툴 단계 뒤에 내보낸다 → STEP_STARTED 가 언제나 그 단계의 첫 이벤트보다 먼저 온다
        held: list[BaseEvent] = []
        # use_skill · use_app: 스킬 · 앱 이름은 인자(TOOL_CALL_ARGS)에 있다 → TOOL_CALL_END 까지 잡아 두고 skill:<이름> · app:<handle> 단계를 연다
        skill: dict[str, Any] | None = None
        apps = act.apps
        held_tools = (USE_SKILL, USE_APP, DELEGATE) if team is not None else (USE_SKILL, USE_APP)  # delegate = 역할이 인자에 있다
        ended: set[str] = set()  # TOOL_CALL_END 까지 낸 delegate call id (그 팀원 이벤트는 이 뒤에)
        early: dict[str, list[BaseEvent]] = {}  # END 전에 온 팀원 이벤트 (pump 와 팀원 태스크 사이 순서는 정해지지 않는다)
        over = False  # RUN_FINISHED · RUN_ERROR 를 냈다 (그 뒤 팀원 이벤트는 버린다 = 마지막 이벤트 계약 · 기록은 steps 에 이미)

        def open_skill() -> list[BaseEvent]:
            nonlocal skill
            assert skill is not None
            try:
                args = json.loads(skill["args"] or "{}")
            except ValueError:
                args = {}
            args = args if isinstance(args, dict) else {}
            if skill["tool"] == USE_APP:  # use_app 과 같은 판단 (app 을 비워도 서버가 고를 앱)
                found = apps.apps.pick(args.get("app"), args.get("need")) if apps else None
                step = f"app:{found.handle if found else 'unknown'}"
            elif skill["tool"] == DELEGATE and team is not None:  # 팀원 번호 · 역할 = call_tool 과 같은 명단 (먼저 본 쪽이 정한다)
                member = team.roster.member(skill["id"], args.get("role"), args.get("task"))
                step = f"agent:{member.agent}"
                act.labels[step] = member.role
            else:
                name = args.get("name")
                name = name.strip() if isinstance(name, str) else ""
                step = f"skill:{name if SKILL_NAME_RE.match(name) else 'unknown'}"
            out = [*act.open(f"{step}#{skill['id']}", step, skill["id"]), *skill["events"]]
            if skill["tool"] == DELEGATE:
                ended.add(skill["id"])
                out += early.pop(skill["id"], [])
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
        source: AsyncIterator[Any] = events if team is None else self._pumped(events, team)
        try:
            async for item in source:
                if team is None:
                    ev = item
                else:
                    kind, parent, ev = item
                    if kind == "member":  # 팀원 이벤트 = 단계 · 기록은 팀원 쪽이 이미 했다 → 순서만 맞춰 낸다
                        if over:
                            continue
                        if parent in ended:
                            yield ev
                        else:
                            early.setdefault(parent or "", []).append(ev)
                        continue
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
                if t == EventType.TOOL_CALL_START and ev.tool_call_name in held_tools:  # type: ignore[attr-defined]
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
                    member = team.step_status(ev.tool_call_id) if team is not None else None  # type: ignore[attr-defined]
                    post = act.close_call(ev.tool_call_id, closeout or member or "done")  # type: ignore[attr-defined]
                elif t == EventType.TEXT_MESSAGE_CONTENT and not act.is_open("writing"):
                    pre = act.open("writing", "writing")
                elif t == EventType.RUN_FINISHED:
                    pre = [*(e for evs in early.values() for e in evs), *app_events(), *act.close_all("done")]
                    early.clear()
                    over = True
                    act.status, act.code = "done", None
                    pre.append(CustomEvent(name="brewai.run_summary", value=act.summary(run_id, model)))
                elif t == EventType.RUN_ERROR:
                    pre = [*(e for evs in early.values() for e in evs), *act.close_all("error")]
                    early.clear()
                    over = True
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
        tools: Sequence[ToolSpec] = (),  # 내장 툴 없음 (테스트 · 나중 slice 가 ToolSpec 을 꽂는다)
        skills: SkillRegistry | None = None,
        openai_client: AsyncOpenAI | None = None,  # 테스트 = httpx2.MockTransport 를 단 클라이언트
    ) -> None:
        # 재시도 0: 게이트웨이(num_retries 0)도 안 하고, 사용자는 '다시 시도' 버튼이 있다. 기본 2회면 실패가 3배 늦다.
        self._client = openai_client or AsyncOpenAI(
            base_url=f"{gateway_url.rstrip('/')}/v1", api_key=gateway_key, max_retries=0, timeout=120.0
        )
        self._provider = LiteLLMProvider(openai_client=self._client)
        self._model_factory = model_factory  # 테스트 = 모델 id → FunctionModel · TestModel (없으면 model_for 가 API 를 고른다)
        self.skills = skills or SkillRegistry()
        skill_tool = self.skills.tool()
        self.tools = (*tools, *([skill_tool] if skill_tool else []))
        self._toolset = build_toolset(self.tools)
        # 점진 공개: 스킬 이름 한 줄만 시스템 프롬프트에 (본문은 use_skill 로)
        self.instructions = INSTRUCTIONS + self.skills.prompt()
        # 출력 = 글 또는 연결 대기(DeferredToolRequests · MCP 앱 로그인 전). deferred 도구가 없다 = 자동 search_tools 도 없다
        self.agent: Agent[None, str | DeferredToolRequests] = Agent(
            name="conductor", instructions=self.instructions, output_type=[str, DeferredToolRequests],
        )
        # 팀원 = 하나의 Agent · 호출마다 run_stream_events (지침 = 고정 한 줄 · 도구 = 실행마다 그 팀원의 앱 · 글로만 답한다)
        self.member: Agent[None, str] = Agent(name="member", instructions=tm.MEMBER_INSTRUCTIONS, output_type=str)

    async def __aenter__(self) -> ChatRuntime:  # 앱 수명 = provider HTTP 클라이언트 수명
        await self._provider.__aenter__()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self._provider.__aexit__(None, None, None)
        await self._client.close()

    def model_for(self, model: ModelChoice) -> Model:
        """게이트웨이 mode = responses → OpenAIResponsesModel (/v1/responses) · 나머지 → OpenAIChatModel (/v1/chat/completions).
        같은 provider (같은 base_url · 키 · 재시도 0 클라이언트). 총괄 · 팀원이 같은 모델 객체를 쓴다 (_stream).
        responses = profile 고정 (_RESPONSES_PROFILE) + 실행 안 생각 다시 안 보냄 (_NoThinkingReplay)."""
        if self._model_factory is not None:
            return self._model_factory(model.id)
        if model.responses_api:
            return _NoThinkingReplay(OpenAIResponsesModel(model.id, provider=self._provider, profile=_RESPONSES_PROFILE))
        return OpenAIChatModel(model.id, provider=self._provider)

    @staticmethod
    def model_settings(model: ModelChoice, reasoning: Reasoning) -> OpenAIChatModelSettings | None:
        """생각 수준 → LiteLLM `reasoning_effort` (LiteLLM 이 Anthropic thinking budget 등으로 바꾼다).
        게이트웨이가 생각을 지원한다고 한 모델에만 보낸다 (안 그러면 LiteLLM 이 UnsupportedParams 400).
        responses 모델: 끔 = 안 보낸다 (reasoning 칸 없음 = 모델 기본 · Pydantic AI _translate_thinking 이 OMIT). 'none' 은 안 보낸다 —
        Azure 의 'set reasoning_effort to none' 은 /v1/chat/completions 에서 툴을 쓰려는 우회일 뿐이고 /v1/responses 는 툴 + 생각을 받는다.
        'none' 을 못 받는 생각 모델도 있다 (o 계열 · gpt-5 · profile openai_supports_reasoning_effort_none). 그래서 끔이어도 모델이 기본으로
        생각할 수 있다 → reasoning_tokens > 0 · 글 없음 (요약을 안 달라 했다) = 화면은 '생각은 했지만 내용은 안 보냄'."""
        if reasoning == "off" or not model.supports_reasoning:
            return None
        # drop_params: 게이트웨이 값(supports_reasoning)과 LiteLLM 모델 표(provider 변환)가 어긋나도 400 대신 그 파라미터만 버린다
        # (예: 관리 화면에서 model_info 로 '생각 지원' 을 켰는데 LiteLLM 1.106.2 표에 없는 모델 이름). 이 요청에만 · LiteLLM 1.106.2 확인
        settings = OpenAIChatModelSettings(openai_reasoning_effort=REASONING_EFFORT[reasoning], extra_body={"drop_params": True})
        if model.provider in ("anthropic", "bedrock", "google") and model.max_output_tokens:
            settings["max_tokens"] = min(model.max_output_tokens, THINKING_MAX_TOKENS)
        if model.responses_api:  # Responses 는 요약을 달라고 해야 생각 글을 보낸다 (reasoning.summary · 없으면 글 없는 reasoning 항목만)
            settings = OpenAIResponsesModelSettings(**settings, openai_reasoning_summary="auto")  # type: ignore[typeddict-item]
        return settings

    async def probe(self, model_id: str, *, responses: bool = False) -> dx.Diagnosis | None:
        """관리자 '연결 시험': 짧은 호출 한 번 (max_tokens 16 · 생각 없음 · 툴 없음). 성공 = None, 실패 = Diagnosis.
        responses = 대화와 같은 길 (/v1/responses · max_output_tokens 16 = Responses 최솟값 · 생각 모델은 incomplete 로 끝나도 성공).
        Responses 는 HTTP 200 본문으로도 실패를 준다 (status failed + error · incomplete 의 다른 까닭) → 그것도 실패로 본다."""
        try:
            if responses:
                r = await self._client.responses.create(
                    model=model_id, input="ping", max_output_tokens=PROBE_MAX_TOKENS, extra_body={"drop_params": True}, timeout=30.0,
                )
                failed = dx.classify_response(r.status, r.error.code if r.error else None, r.error.message if r.error else None,
                                              r.incomplete_details.reason if r.incomplete_details else None)
                if failed is not None:
                    log.warning("model probe failed: model=%s %s", model_id, failed.log_fields())
                    return failed
            else:
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
            if not prompt and not props.get("files"):
                raise ChatRequestError(400, "empty_message")
            if len(prompt) > MAX_PROMPT_CHARS:
                raise ChatRequestError(400, "message_too_long")
        model = props.get("model")
        if model is not None and not isinstance(model, str):
            raise ChatRequestError(400, "unknown_model")
        reasoning = props.get("reasoning", "off")
        if reasoning not in REASONING_LEVELS:
            raise ChatRequestError(400, "bad_reasoning")
        raw_files = props.get("files") or []
        if not isinstance(raw_files, list) or len(raw_files) > MAX_FILES or not all(isinstance(x, str) and _FILE_ID.match(x) for x in raw_files):
            raise ChatRequestError(400, "bad_files")
        file_ids = tuple(dict.fromkeys(raw_files))
        if file_ids and not prompt:
            prompt = "첨부한 파일을 살펴봐 줘."  # 파일만 보냄 (빈 prompt = 이어서 하기와 헷갈리지 않게)
        if resume_id is not None and file_ids:
            raise ChatRequestError(400, "bad_files")
        scope = {k: props.get(k) for k in ("spaceId", "projectId")}
        for key, value in scope.items():
            if value is not None and not (isinstance(value, str) and _ID.match(value)):
                raise ChatRequestError(400, f"bad_{key}")
        return ChatRequest(
            thread_id=run_input.thread_id, run_id=run_input.run_id, prompt=prompt, model=model or None, reasoning=reasoning,
            space_id=scope["spaceId"], project_id=scope["projectId"], resume=resume_id, files=file_ids,
        )

    async def handle(self, request: Request, prepare: Prepare) -> Response:
        try:
            adapter = await _Adapter.from_request(request, agent=self.agent)  # Content-Type ≠ application/json → 415
        except ValidationError as e:
            return Response(e.json(include_input=False), status_code=422, media_type="application/json")
        req = self.parse(adapter)
        model, blobs, sink, scope = await prepare(req)
        apps = _AppRun(scope.apps) if scope.apps is not None and model.supports_tools else None
        labels = {f"tool:{t.name}": t.label for t in self.tools} | self.skills.labels() | (scope.apps.labels() if scope.apps is not None else {})
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
        # 팀 게이트 (LLM 없음 · 실행당 1번): 복합 신호 · 그 대화에 이미 보였음(sticky = 불렀거나 게이트가 켜진 질문 · 도구 배열 고정 = 캐시) ·
        # 도구 못 쓰는 모델 = 끔 · 이어서 하기 = sticky 그대로 (멈춘 실행과 같은 도구 배열 · 그 질문도 기록에 있다)
        used = tm.team_used(p.tool_name for m in history if isinstance(m, ModelResponse) for p in m.parts if isinstance(p, ToolCallPart)) or \
            tm.team_offered(p.content for m in history if isinstance(m, ModelRequest) for p in m.parts
                            if isinstance(p, UserPromptPart) and isinstance(p.content, str))
        team_on = tm.offer_team(req.prompt, used=used, tools=model.supports_tools, resume=resumed is not None)
        # 서버가 원본: 이번 질문(마지막 user 메시지)만 어댑터에 남긴다. 클라이언트가 보낸 앞 대화는 쓰지 않는다 · 이어서 하기 = 메시지 없음
        # 질문 앞에 날짜 · 시각 한 줄 (사용자 메시지 · 기록에 남아 다음 턴에도 같은 바이트 = 캐시 앞부분이 산다 · 시스템 지침은 그대로)
        last = adapter.run_input.messages[-1] if adapter.run_input.messages else None
        if last is not None and scope.attachments:
            last = with_files(last, req.prompt, scope.attachments)
        keep = [] if resumed is not None or last is None else [UserMessage(id=f"{last.id}:now", content=now_line()), last]
        single = _Adapter(agent=self.agent, run_input=adapter.run_input.model_copy(update={"messages": keep}), accept=adapter.accept)
        settings = self.model_settings(model, req.reasoning)
        effective: Reasoning = req.reasoning if settings is not None else "off"
        single.reasoning = effective != "off"  # 실패 진단: 생각 칸을 실었을 때만 '생각 설정 거절'
        if scope.user_id:  # LiteLLM 요청 user = users.id (게이트웨이 로그 · 예산 · trace)
            settings = OpenAIChatModelSettings(**(settings or {}), openai_user=scope.user_id)  # type: ignore[typeddict-item]
        if wants_cache_markers(model):  # Claude = 명시 캐시 (LiteLLM 이 system · 마지막 메시지에 cache_control 을 붙인다)
            extra = {**(settings or {}).get("extra_body", {}), "cache_control_injection_points": CACHE_POINTS}  # type: ignore[union-attr]
            settings = OpenAIChatModelSettings(**{**(settings or {}), "extra_body": extra})  # type: ignore[typeddict-item]
        settings = response_settings(model, settings)
        log.info(
            "chat run thread=%s run=%s model=%s api=%s reasoning=%s turns=%d user=%s space=%s",
            req.thread_id, req.run_id, model.id, "responses" if model.responses_api else "chat", effective, len(blobs), scope.user_id,
            scope.space_id,
        )

        def on_complete(result: Any) -> None:
            new = result.all_messages()[len(history):]  # 이번 질문 + 이번 답 (툴 왕복 포함)
            if scope.attachments:
                new = strip_originals(new, [a.file.name for a in scope.attachments if a.data is not None])
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
            if team is not None and team.roster.ran:  # 같은 모델 = 가격 한 줄 그대로 → 총괄 + 팀원 합 (usage_events 한 줄)
                for mem in team.roster.ran:
                    for k in ("input_tokens", "output_tokens", "requests", "tool_calls", "reasoning_tokens", "cache_read_tokens", "cache_write_tokens"):
                        activity.usage[k] = (activity.usage[k] or 0) + mem.usage.get(k, 0)
                activity.usage["members"] = team.roster.usage_rows()

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
            "team": team_on,  # 이번 턴 delegate 보임
        }
        base = self.model_for(model)
        llm = base
        if effective != "off" and model.supports_tools and _signed_thinking(model):
            llm = _ThinkFirstOnly(llm)
        apps = activity.apps
        team: _TeamRun | None = None
        if team_on:  # 팀원 = 같은 모델 · 추론 끔 (_ThinkFirstOnly 없이) · openai_user · Claude 캐시 표시 · max_tokens
            member_settings = OpenAIChatModelSettings(max_tokens=tm.MEMBER_MAX_TOKENS)
            if scope.user_id:
                member_settings["openai_user"] = scope.user_id
            if wants_cache_markers(model):
                member_settings["extra_body"] = {"cache_control_injection_points": CACHE_POINTS}
            member_settings = response_settings(model, member_settings) or member_settings
            team = _TeamRun(agent=self.member, model=base, model_label=model.label, settings=member_settings, activity=activity,
                            apps=apps.apps if apps else None, user_id=scope.user_id, thread_id=req.thread_id)
        toolsets: list[AbstractToolset[None]] | None = None
        if model.supports_tools:  # 실행마다 동시 실행 상한 하나 (스킬 · 앱 도구가 같이 센다) · 도구 배열 = 고정 도구 → delegate → use_app → 공개 순
            gate = asyncio.Semaphore(MAX_PARALLEL_TOOLS)  # delegate 는 gate 밖 (팀원이 칸을 잡고 기다리면 4칸 교착)
            files_ts = file_toolset(scope)  # read_file = 파일이 있는 대화만 (고정 도구 · 팀 다음 · 앱 앞 = 그 대화에서 늘 같은 자리)
            toolsets = [bounded(self._toolset, gate=gate), *([_TeamTools(team)] if team else []),
                        *([bounded(files_ts, gate=gate)] if files_ts else []), *([bounded(_AppTools(apps), gate=gate)] if apps else [])]
        # 실행 지침 = 앱 목록 한 줄 (handle 순 고정 = 프롬프트 캐시) → 프로젝트 지침 (conductor 규칙 · 앱 목록 뒤에)
        block = apps.apps.prompt() if apps else ""
        instructions = "\n\n".join(x for x in (block, scope.file_line, scope.instructions) if x) or None
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
        return single.streaming_response(_RunStream(events, activity, meta, req.run_id, model, team))  # type: ignore[arg-type]
