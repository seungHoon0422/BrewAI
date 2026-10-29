"""conductor 툴 목록 (한곳). 지금은 안전한 내장 툴 2개 — 네트워크·파일 접근 없음.

여기 함수는 순수 파이썬이다 (Pydantic AI import 없음, ADR-0002). agent.py 가 ToolSpec → Pydantic AI Tool 로 감싼다.
MCP 툴(slice 03+)은 같은 모양(ToolSpec: name · label · 함수)으로 이 목록 옆에 꽂는다 — 승인이 필요한 툴은 requires_approval.
툴은 예외를 던지지 않고 {"error": code, "message": 한국어} 를 돌려준다 → 모델이 사용자에게 설명한다 (실행이 죽지 않게).
"""

from __future__ import annotations

import ast
import math
import operator
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from datetime import timezone as fixed_zone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "Asia/Seoul"


@dataclass(frozen=True)
class ToolSpec:
    name: str  # 모델이 부르는 이름 = AG-UI toolCallName = 활동 단계 "tool:<name>"
    label: str  # 화면 이름 (한국어)
    description: str  # 모델에게 주는 설명
    function: Callable[..., dict[str, Any]]
    requires_approval: bool = False  # P2 승인·정책: True 면 사람 승인 뒤에만 실행


# ── current_time ──────────────────────────────────────────────────────────────────

# 윈도우 파이썬은 IANA 시간대 DB 가 없을 수 있다 (tzdata 패키지 없음). 일광절약시간 없는 몇 곳만 고정 오프셋으로 대신한다
_FIXED_OFFSETS = {"UTC": 0, "Etc/UTC": 0, "Asia/Seoul": 9, "Asia/Tokyo": 9, "Asia/Shanghai": 8, "Asia/Singapore": 8}


def _zone(name: str) -> fixed_zone | ZoneInfo | None:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        hours = _FIXED_OFFSETS.get(name)
        return None if hours is None else (UTC if hours == 0 else fixed_zone(timedelta(hours=hours), name))


def _now() -> datetime:  # 테스트가 바꾼다
    return datetime.now(UTC)


def current_time(timezone: str = DEFAULT_TIMEZONE) -> dict[str, Any]:
    """지금 날짜와 시각을 알려 준다.

    Args:
        timezone: IANA 시간대 이름 (예: Asia/Seoul, UTC, America/New_York). 기본은 Asia/Seoul.
    """
    name = (timezone or DEFAULT_TIMEZONE).strip()
    if len(name) > 64:
        return {"error": "bad_timezone", "message": "시간대 이름이 너무 길어요."}
    tz = _zone(name)
    if tz is None:
        return {"error": "unknown_timezone", "message": f"'{name}' 시간대를 찾지 못했어요. 예: Asia/Seoul, UTC"}
    moment = _now().astimezone(tz)
    return {
        "timezone": name,
        "iso": moment.isoformat(timespec="seconds"),
        "date": moment.strftime("%Y-%m-%d"),
        "time": moment.strftime("%H:%M:%S"),
        "weekday": "월화수목금토일"[moment.weekday()] + "요일",
        "utc_offset": moment.strftime("%z")[:3] + ":" + moment.strftime("%z")[3:],
    }


# ── calculator ────────────────────────────────────────────────────────────────────
# eval 없이 AST 를 직접 계산한다. 허용: 숫자 · + - * / // % ** · 괄호 · 아래 함수/상수. 그 밖은 전부 거절.

MAX_EXPRESSION = 200
MAX_EXPONENT = 1000
MAX_MAGNITUDE = 1e100

_BINARY: dict[type[ast.operator], Callable[[Any, Any], Any]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY: dict[type[ast.unaryop], Callable[[Any], Any]] = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_FUNCS: dict[str, tuple[Callable[..., Any], int, int]] = {  # 이름 → (함수, 최소 인자, 최대 인자)
    "sqrt": (math.sqrt, 1, 1),
    "abs": (abs, 1, 1),
    "round": (round, 1, 2),
    "floor": (math.floor, 1, 1),
    "ceil": (math.ceil, 1, 1),
    "log": (math.log, 1, 2),
    "log10": (math.log10, 1, 1),
    "exp": (math.exp, 1, 1),
    "sin": (math.sin, 1, 1),
    "cos": (math.cos, 1, 1),
    "tan": (math.tan, 1, 1),
    "min": (min, 1, 10),
    "max": (max, 1, 10),
}
_CONSTS = {"pi": math.pi, "e": math.e}


class _CalcError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code)
        self.code = code
        self.message = message


def _check(value: Any) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _CalcError("not_a_number", "숫자가 아닌 결과가 나왔어요.")
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        raise _CalcError("out_of_range", "결과가 너무 크거나 정의되지 않아요.")
    if abs(value) > MAX_MAGNITUDE:
        raise _CalcError("out_of_range", "결과가 너무 커요.")
    return value


def _eval(node: ast.AST) -> int | float:
    if isinstance(node, ast.Expression):
        return _eval(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return _check(node.value)
    if isinstance(node, ast.Name) and node.id in _CONSTS:
        return _CONSTS[node.id]
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
        return _check(_UNARY[type(node.op)](_eval(node.operand)))
    if isinstance(node, ast.BinOp) and type(node.op) in _BINARY:
        left, right = _eval(node.left), _eval(node.right)
        if isinstance(node.op, ast.Pow) and (abs(right) > MAX_EXPONENT or (abs(left) > 1 and abs(right) * math.log10(abs(left)) > 100)):
            raise _CalcError("out_of_range", "거듭제곱이 너무 커요.")
        try:
            return _check(_BINARY[type(node.op)](left, right))
        except ZeroDivisionError as e:
            raise _CalcError("division_by_zero", "0으로 나눌 수 없어요.") from e
        except OverflowError as e:
            raise _CalcError("out_of_range", "결과가 너무 커요.") from e
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS and not node.keywords:
        func, lo, hi = _FUNCS[node.func.id]
        if not lo <= len(node.args) <= hi:
            raise _CalcError("bad_arguments", f"{node.func.id} 함수의 인자 개수가 맞지 않아요.")
        args = [_eval(a) for a in node.args]
        if node.func.id == "round" and len(args) == 2 and (not isinstance(args[1], int) or abs(args[1]) > 15):
            raise _CalcError("bad_arguments", "round 의 자릿수는 -15~15 정수여야 해요.")
        try:
            return _check(func(*args))
        except (ValueError, OverflowError) as e:
            raise _CalcError("math_domain", f"{node.func.id} 에 쓸 수 없는 값이에요.") from e
    raise _CalcError("unsupported", "숫자, + - * / // % **, 괄호, sqrt·log·sin 같은 함수만 쓸 수 있어요.")


def _format(value: int | float) -> str:
    if isinstance(value, float) and value.is_integer() and abs(value) < 1e15:
        return str(int(value))
    return str(value) if isinstance(value, int) else f"{value:.12g}"


def calculator(expression: str) -> dict[str, Any]:
    """사칙연산·거듭제곱·sqrt/log/sin 같은 수식을 정확히 계산한다. 계산이 필요하면 직접 하지 말고 이 도구를 쓴다.

    Args:
        expression: 계산할 수식 (예: 12*(3+4), 2**10, sqrt(2), 15% 는 0.15 로).
    """
    text = (expression or "").strip().replace("×", "*").replace("÷", "/").replace("^", "**")
    if not text:
        return {"error": "empty", "message": "계산할 수식이 비어 있어요."}
    if len(text) > MAX_EXPRESSION:
        return {"error": "too_long", "message": f"수식은 {MAX_EXPRESSION}자까지예요."}
    try:
        tree = ast.parse(text, mode="eval")
    except SyntaxError:
        return {"error": "syntax", "message": "수식을 읽지 못했어요."}
    try:
        value = _eval(tree)
    except _CalcError as e:
        return {"error": e.code, "message": e.message, "expression": text}
    except RecursionError:
        return {"error": "too_deep", "message": "괄호가 너무 깊어요.", "expression": text}
    return {"expression": text, "result": _format(value)}


# ── 목록 ──────────────────────────────────────────────────────────────────────────

BUILTIN_TOOLS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="current_time",
        label="현재 시각",
        description="지금 날짜·시각·요일을 알려 준다. '오늘', '지금 몇 시' 같은 질문에 쓴다.",
        function=current_time,
    ),
    ToolSpec(
        name="calculator",
        label="계산기",
        description="수식을 정확히 계산한다. 숫자 계산은 암산하지 말고 이 도구를 쓴다.",
        function=calculator,
    ),
)

STEP_LABELS = {"thinking": "생각", "writing": "답 쓰기"}  # 활동 단계 이름 → 화면 이름 (tool:<name> 은 툴 label)


def tool_label(name: str) -> str:
    return next((t.label for t in BUILTIN_TOOLS if t.name == name), name)


def step_label(step: str) -> str:
    if step.startswith("tool:"):
        return tool_label(step.removeprefix("tool:"))
    return STEP_LABELS.get(step, step)
