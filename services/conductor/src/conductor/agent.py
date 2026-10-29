"""에이전트 루프 adapter. Pydantic AI · AG-UI 는 이 파일에서만 import 한다 (ADR-0002).

POST /api/chat 본문 = AG-UI RunAgentInput, 응답 = AG-UI SSE. 이벤트 순서 (계약 · docs 는 app.py 머리말):
  RUN_STARTED → CUSTOM brewai.run → (STEP_STARTED thinking → REASONING_* → STEP_FINISHED)?
  → (STEP_STARTED tool:<name> → TOOL_CALL_START/ARGS/END → TOOL_CALL_RESULT → STEP_FINISHED)*
  → STEP_STARTED writing → TEXT_MESSAGE_START/CONTENT…/END → STEP_FINISHED → CUSTOM brewai.run_summary → RUN_FINISHED
  스킬 = (STEP_STARTED skill:<스킬> → TOOL_CALL_START use_skill …/RESULT → STEP_FINISHED) — 툴 단계 이름이 tool:use_skill 대신 skill:<이름>
  실패 = … → STEP_FINISHED → RUN_ERROR {code, message, detail?} (마지막 이벤트. detail = diagnose.py DETAILS · 화면 안내용)
  생각 이벤트 = ag-ui-protocol 0.1.22 의 REASONING_START · REASONING_MESSAGE_START{role:"reasoning"} · REASONING_MESSAGE_CONTENT{delta}
  · REASONING_MESSAGE_END · (REASONING_ENCRYPTED_VALUE — 화면은 무시) · REASONING_END (Pydantic AI AG-UI adapter 2.59 가 낸다)
모델 = LiteLLM 프록시의 OpenAI 호환 /v1/chat/completions (LiteLLMProvider, api_base = LLM_GATEWAY_URL + /v1).
멀티턴 = 서버가 원본: 클라이언트가 보낸 messages 중 마지막 user 메시지만 쓰고, 앞 대화는 저장된 기록(message_history)으로.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import AsyncGenerator, AsyncIterator, Awaitable, Callable, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field, replace
from typing import Any, Literal, Protocol

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
from pydantic_ai import Agent, FunctionToolset, Tool
from pydantic_ai.exceptions import ModelConnectionError, ModelHTTPError, UsageLimitExceeded
from pydantic_ai.messages import (
    ModelMessage,
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    TextPart,
    ThinkingPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models import Model, ModelRequestParameters, StreamedResponse
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIChatModelSettings
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.providers.litellm import LiteLLMProvider
from pydantic_ai.settings import ModelSettings
from pydantic_ai.ui.ag_ui import AGUIAdapter, AGUIEventStream
from pydantic_ai.usage import UsageLimits
from starlette.requests import Request
from starlette.responses import Response

from . import diagnose as dx
from .models import ModelChoice
from .skills import NAME_RE as SKILL_NAME_RE
from .skills import SkillRegistry
from .tools import BUILTIN_TOOLS, USE_SKILL, ToolSpec, step_label, tool_label

log = logging.getLogger("conductor.agent")

INSTRUCTIONS = (
    "너는 BrewAI 의 conductor 에이전트다. 한국어로 짧고 정확하게 답한다. "
    "숫자 계산은 calculator, 단위 환산은 unit_convert, 날짜 차이·며칠 뒤·요일은 date_calc, 글자 수는 text_stats, "
    "오늘 날짜·지금 시각은 current_time 도구로 확인한 뒤 답한다 (암산·추측하지 않는다). "
    "앞선 대화를 기억하고 이어서 답한다."
)

Reasoning = Literal["off", "low", "high"]
REASONING_LEVELS: tuple[Reasoning, ...] = ("off", "low", "high")
MAX_MODEL_REQUESTS = 8  # 툴 왕복 포함 한 실행의 모델 호출 상한 (무한 툴 루프 방지)
MAX_PROMPT_CHARS = 32_000
THINKING_MAX_TOKENS = 16_000  # Anthropic thinking 은 max_tokens > budget 이어야 한다 (LiteLLM high = 4096)
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
    ) -> None: ...


# prepare = 모델 고르기 · 기록 읽기 · 실행 시작 기록. (모델, 앞 대화 JSON 들, sink) 를 돌려준다. 거절 = ChatRequestError
Prepare = Callable[[ChatRequest], Awaitable[tuple[ModelChoice, list[str], RunSink]]]


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
    )


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


def render_run(blob: str | None) -> dict[str, Any]:
    """저장된 실행 하나 → 화면용 답 (GET /api/threads/{id}). parts = 생각 · 툴 · 글 을 나온 순서대로."""
    parts: list[dict[str, Any]] = []
    tools: dict[str, dict[str, Any]] = {}
    if blob:
        try:
            messages = ModelMessagesTypeAdapter.validate_json(blob)
        except ValidationError:
            messages = []
        for m in messages:
            if isinstance(m, ModelResponse):
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
                            "args": p.args_as_dict(), "result": None, "status": "running",
                        }
                        tools[p.tool_call_id] = tool
                        parts.append(tool)
            elif isinstance(m, ModelRequest):
                for p in m.parts:
                    if isinstance(p, ToolReturnPart) and p.tool_call_id in tools:
                        t = tools[p.tool_call_id]
                        t["result"] = skill_card(p.content) if t["name"] == USE_SKILL else p.content
                        t["status"] = "error" if isinstance(p.content, dict) and "error" in p.content else "done"
                    elif isinstance(p, RetryPromptPart) and p.tool_call_id in tools:
                        tools[p.tool_call_id].update(status="error", result={"error": "retry", "message": p.model_response()})
    text = [p["text"] for p in parts if p["type"] == "text"]
    reasoning = [p["text"] for p in parts if p["type"] == "reasoning"]
    return {"content": "\n\n".join(text), "reasoning": "\n\n".join(reasoning) or None, "parts": parts}


@dataclass
class _Activity:
    """AG-UI 이벤트를 보며 단계(생각 → 툴 → 쓰기)를 만든다. STEP_STARTED/FINISHED 를 끼워 넣고 sink 에 남긴다."""

    sink: RunSink
    labels: dict[str, str] = field(default_factory=dict)  # 스킬 이름 → 화면 이름 (skill:<이름> 단계)
    started: float = field(default_factory=time.monotonic)
    steps: list[dict[str, Any]] = field(default_factory=list)
    key: str | None = None
    status: Literal["done", "error", "cancelled"] = "cancelled"
    code: str | None = "client_disconnected"
    detail: str | None = None
    closed: bool = False
    messages: str | None = None
    usage: dict[str, Any] | None = None

    def _ms(self) -> int:
        return int((time.monotonic() - self.started) * 1000)

    def open(self, key: str, name: str) -> list[BaseEvent]:
        out = self.close("done")
        self.key = key
        self.steps.append(
            {"name": name, "label": step_label(name, self.labels), "status": "running", "started_ms": self._ms(), "duration_ms": None}
        )
        out.append(StepStartedEvent(step_name=name))
        try:
            self.sink.steps_changed(self.steps)
        except Exception:  # 진행 상황 기록 실패가 대화를 막지 않게
            log.exception("failed to record run steps")
        return out

    def close(self, status: str) -> list[BaseEvent]:
        if self.key is None:
            return []
        step = self.steps[-1]
        step.update(status=status, duration_ms=self._ms() - step["started_ms"])
        self.key = None
        return [StepFinishedEvent(step_name=step["name"])]

    def finish(self) -> None:
        if self.closed:
            return
        self.closed = True
        if self.key is not None:
            self.close("cancelled" if self.status == "cancelled" else ("error" if self.status == "error" else "done"))
        try:
            self.sink.finish(
                status=self.status, steps=self.steps, duration_ms=self._ms(),
                messages=self.messages if self.status == "done" else None, usage=self.usage,
                error_code=None if self.status == "done" else self.code,
                error_detail=None if self.status == "done" else self.detail,
            )
        except Exception:  # 기록 실패가 스트림·종료를 막지 않게
            log.exception("failed to record run end")

    def summary(self, run_id: str, model: ModelChoice) -> dict[str, Any]:
        return {"run_id": run_id, "model": model.id, "duration_ms": self._ms(), "usage": self.usage, "steps": self.steps}


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
        # use_skill: 스킬 이름은 인자(TOOL_CALL_ARGS)에 있다 → TOOL_CALL_END 까지 잡아 두고 skill:<이름> 단계를 연다
        skill: dict[str, Any] | None = None

        def open_skill() -> list[BaseEvent]:
            nonlocal skill
            assert skill is not None
            try:
                name = json.loads(skill["args"] or "{}").get("name")
            except (ValueError, AttributeError):
                name = None
            name = name.strip() if isinstance(name, str) else ""
            step = f"skill:{name if SKILL_NAME_RE.match(name) else 'unknown'}"
            out = [*act.open(f"{step}#{skill['id']}", step), *skill["events"]]
            skill = None
            return out

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
                if t == EventType.TOOL_CALL_START and ev.tool_call_name == USE_SKILL:  # type: ignore[attr-defined]
                    skill = {"id": ev.tool_call_id, "args": "", "events": [*held, ev]}  # type: ignore[attr-defined]
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
                elif t == EventType.REASONING_START and act.key != "thinking":
                    pre = act.open("thinking", "thinking")
                elif t == EventType.TOOL_CALL_START:
                    name = f"tool:{ev.tool_call_name}"  # type: ignore[attr-defined]
                    pre = act.open(f"{name}#{ev.tool_call_id}", name)  # type: ignore[attr-defined]
                elif t == EventType.TEXT_MESSAGE_CONTENT and act.key != "writing":
                    pre = act.open("writing", "writing")
                elif t == EventType.RUN_FINISHED:
                    pre = act.close("done")
                    act.status, act.code = "done", None
                    pre.append(CustomEvent(name="brewai.run_summary", value=act.summary(run_id, model)))
                elif t == EventType.RUN_ERROR:
                    pre = act.close("error")
                    act.status, act.code = "error", getattr(ev, "code", None) or "model_error"
                    act.detail = getattr(ev, "detail", None)
                for e in (*pre, *held, ev, *post):
                    yield e
                held.clear()
            if skill is not None:  # 끝 신호 없이 스트림이 끝남
                for e in open_skill():
                    yield e
        finally:
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
        self.agent: Agent[None, str] = Agent(name="conductor", instructions=self.instructions)

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
        settings = OpenAIChatModelSettings(openai_reasoning_effort=reasoning, extra_body={"drop_params": True})
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
        last = run_input.messages[-1] if run_input.messages else None
        if not isinstance(last, UserMessage):
            raise ChatRequestError(400, "last_message_not_user")
        prompt = _user_text(last).strip()
        if not prompt:
            raise ChatRequestError(400, "empty_message")
        if len(prompt) > MAX_PROMPT_CHARS:
            raise ChatRequestError(400, "message_too_long")
        props = run_input.forwarded_props if isinstance(run_input.forwarded_props, dict) else {}
        model = props.get("model")
        if model is not None and not isinstance(model, str):
            raise ChatRequestError(400, "unknown_model")
        reasoning = props.get("reasoning", "off")
        if reasoning not in REASONING_LEVELS:
            raise ChatRequestError(400, "bad_reasoning")
        return ChatRequest(thread_id=run_input.thread_id, run_id=run_input.run_id, prompt=prompt, model=model or None, reasoning=reasoning)

    async def handle(self, request: Request, prepare: Prepare) -> Response:
        try:
            adapter = await _Adapter.from_request(request, agent=self.agent)  # Content-Type ≠ application/json → 415
        except ValidationError as e:
            return Response(e.json(include_input=False), status_code=422, media_type="application/json")
        req = self.parse(adapter)
        model, blobs, sink = await prepare(req)
        activity = _Activity(sink=sink, labels=self.skills.labels())  # 여기부터 실행 기록이 열려 있다 → 어떤 길로 나가든 finish
        try:
            return self._stream(adapter, req, model, blobs, activity)
        except BaseException:
            activity.status, activity.code = "error", "internal_error"
            activity.finish()
            raise

    def _stream(self, adapter: _Adapter, req: ChatRequest, model: ModelChoice, blobs: list[str], activity: _Activity) -> Response:
        history = load_history(blobs)
        # 서버가 원본: 이번 질문(마지막 user 메시지)만 어댑터에 남긴다. 클라이언트가 보낸 앞 대화는 쓰지 않는다
        last = adapter.run_input.messages[-1]
        single = _Adapter(agent=self.agent, run_input=adapter.run_input.model_copy(update={"messages": [last]}), accept=adapter.accept)
        settings = self.model_settings(model, req.reasoning)
        effective: Reasoning = req.reasoning if settings is not None else "off"
        log.info("chat run thread=%s run=%s model=%s reasoning=%s turns=%d", req.thread_id, req.run_id, model.id, effective, len(blobs))

        def on_complete(result: Any) -> None:
            new = result.all_messages()[len(history):]  # 이번 질문 + 이번 답 (툴 왕복 포함)
            activity.messages = ModelMessagesTypeAdapter.dump_json(new).decode()
            u = result.usage
            activity.usage = {
                "input_tokens": u.input_tokens, "output_tokens": u.output_tokens, "requests": u.requests, "tool_calls": u.tool_calls,
            }

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
        }
        llm = self._model_factory(model.id)
        if settings is not None and model.supports_tools and _signed_thinking(model):
            llm = _ThinkFirstOnly(llm)
        events = single.run_stream(
            model=llm,
            message_history=history,
            model_settings=settings,
            toolsets=[self._toolset] if model.supports_tools else None,
            usage_limits=UsageLimits(request_limit=MAX_MODEL_REQUESTS),
            on_complete=on_complete,
        )
        return single.streaming_response(_RunStream(events, activity, meta, req.run_id, model))  # type: ignore[arg-type]
