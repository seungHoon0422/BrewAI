"""conductor 툴 목록 (한곳). 안전한 내장 툴 5개 — 네트워크·파일 접근 없음 · 결정적 (같은 입력 = 같은 답, 현재 시각만 예외).
  current_time · calculator · unit_convert(길이·무게·온도·데이터 크기) · date_calc(날짜 차이·더하기·요일) · text_stats(글자·단어·줄)
스킬(runtime/skills)을 불러오는 use_skill 은 skills.py 가 같은 ToolSpec 모양으로 만든다 (스킬이 있을 때만).

여기 함수는 순수 파이썬이다 (Pydantic AI import 없음, ADR-0002). agent.py 가 ToolSpec → Pydantic AI Tool 로 감싼다.
MCP 툴(slice 03+)은 같은 모양(ToolSpec: name · label · 함수)으로 이 목록 옆에 꽂는다 — 승인이 필요한 툴은 requires_approval.
툴은 예외를 던지지 않고 {"error": code, "message": 한국어} 를 돌려준다 → 모델이 사용자에게 설명한다 (실행이 죽지 않게).
"""

from __future__ import annotations

import ast
import math
import operator
import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from datetime import timezone as fixed_zone
from typing import Any, Literal
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
    "min": (min, 2, 10),  # min(1) 은 TypeError (숫자 하나는 반복 가능한 값이 아니다)
    "max": (max, 2, 10),
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
        except (ValueError, OverflowError, ZeroDivisionError, TypeError) as e:  # log(x, 1) = ZeroDivisionError
            raise _CalcError("math_domain", f"{node.func.id} 에 쓸 수 없는 값이에요.") from e
    raise _CalcError("unsupported", "숫자, + - * / // % **, 괄호, sqrt, log, sin 같은 함수만 쓸 수 있어요.")


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


# ── unit_convert ──────────────────────────────────────────────────────────────────
# 단위 → (종류, 기준 단위로 곱할 값). 온도는 곱셈이 아니라 따로 계산한다. 데이터 = KB·MB 는 1000 배, KiB·MiB 는 1024 배.

# 정규 기호 → (종류, 기준 단위 배수, 한국어 이름). 별칭(소문자) → 정규 기호
_UNITS: dict[str, tuple[str, float, str]] = {}
_ALIASES: dict[str, str] = {}
_UNIT_TABLE: tuple[tuple[str, str, float, str, tuple[str, ...]], ...] = (
    ("length", "mm", 0.001, "밀리미터", ("millimeter", "millimeters")),
    ("length", "cm", 0.01, "센티미터", ("센치", "centimeter", "centimeters")),
    ("length", "m", 1.0, "미터", ("meter", "meters", "metre")),
    ("length", "km", 1000.0, "킬로미터", ("킬로", "kilometer", "kilometers")),
    ("length", "in", 0.0254, "인치", ("inch", "inches")),
    ("length", "ft", 0.3048, "피트", ("feet", "foot")),
    ("length", "yd", 0.9144, "야드", ("yard", "yards")),
    ("length", "mi", 1609.344, "마일", ("mile", "miles")),
    ("weight", "mg", 0.001, "밀리그램", ("milligram",)),
    ("weight", "g", 1.0, "그램", ("gram", "grams")),
    ("weight", "kg", 1000.0, "킬로그램", ("kilogram", "kilograms")),
    ("weight", "t", 1_000_000.0, "톤", ("ton", "tonne", "tonnes")),
    ("weight", "oz", 28.349523125, "온스", ("ounce", "ounces")),
    ("weight", "lb", 453.59237, "파운드", ("lbs", "pound", "pounds")),
    ("temperature", "C", 1.0, "섭씨", ("°c", "celsius", "도")),
    ("temperature", "F", 1.0, "화씨", ("°f", "fahrenheit")),
    ("temperature", "K", 1.0, "켈빈", ("kelvin",)),
    ("data", "B", 1.0, "바이트", ("byte", "bytes")),
    ("data", "KB", 1e3, "킬로바이트", ("kilobyte",)),
    ("data", "MB", 1e6, "메가바이트", ("megabyte", "메가")),
    ("data", "GB", 1e9, "기가바이트", ("gigabyte", "기가")),
    ("data", "TB", 1e12, "테라바이트", ("terabyte", "테라")),
    ("data", "PB", 1e15, "페타바이트", ("petabyte",)),
    ("data", "KiB", 1024.0, "키비바이트", ()),
    ("data", "MiB", 1024.0**2, "메비바이트", ()),
    ("data", "GiB", 1024.0**3, "기비바이트", ()),
    ("data", "TiB", 1024.0**4, "테비바이트", ()),
)
for _kind, _sym, _factor, _name, _more in _UNIT_TABLE:
    _UNITS[_sym] = (_kind, _factor, _name)
    for _alias in (_sym, _name, *_more):
        _ALIASES.setdefault(_alias.lower(), _sym)  # 't'(톤) · 'T'(없음) 처럼 대소문자가 겹치면 먼저 쓴 것
KIND_LABELS = {"length": "길이", "weight": "무게", "temperature": "온도", "data": "데이터 크기"}
MAX_UNIT_VALUE = 1e18


def _symbol(raw: str) -> str | None:
    text = raw.strip().replace(" ", "")
    if text in _UNITS:  # 대소문자 그대로 먼저 (KB · Kib 구분)
        return text
    return _ALIASES.get(text.lower())


def _to_kelvin(v: float, unit: str) -> float:
    return v + 273.15 if unit == "C" else (v - 32) * 5 / 9 + 273.15 if unit == "F" else v


def _from_kelvin(k: float, unit: str) -> float:
    return k - 273.15 if unit == "C" else (k - 273.15) * 9 / 5 + 32 if unit == "F" else k


def _num(value: float) -> str:
    if value == 0:
        return "0"
    text = f"{value:.10g}"
    if "e" in text:
        return text
    return text.rstrip("0").rstrip(".") if "." in text else text


def unit_convert(value: float, from_unit: str, to_unit: str) -> dict[str, Any]:
    """길이·무게·온도·데이터 크기 단위를 바꾼다. 단위 환산은 직접 하지 말고 이 도구를 쓴다.

    Args:
        value: 바꿀 값 (예: 5).
        from_unit: 원래 단위 (예: km, mi, kg, lb, C, F, K, GB, GiB · 한국어 이름도 된다: 킬로미터, 파운드, 섭씨).
        to_unit: 바꿀 단위.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return {"error": "bad_value", "message": "숫자 값을 주세요."}
    if abs(value) > MAX_UNIT_VALUE:
        return {"error": "out_of_range", "message": "값이 너무 커요."}
    src, dst = _symbol(from_unit or ""), _symbol(to_unit or "")
    if src is None or dst is None:
        bad = str(from_unit if src is None else to_unit)[:32]
        return {"error": "unknown_unit", "message": f"'{bad}' 단위를 모르겠어요. 예: km, mi, kg, lb, C, F, GB, GiB"}
    kind_src, kind_dst = _UNITS[src][0], _UNITS[dst][0]
    if kind_src != kind_dst:
        return {
            "error": "incompatible_units",
            "message": f"{KIND_LABELS[kind_src]}({src})와 {KIND_LABELS[kind_dst]}({dst})는 서로 바꿀 수 없어요.",
        }
    if kind_src == "temperature":
        kelvin = _to_kelvin(float(value), src)
        if kelvin < 0:
            return {"error": "below_absolute_zero", "message": "절대 영도(-273.15°C)보다 낮은 온도는 없어요."}
        result = _from_kelvin(kelvin, dst)
    else:
        if value < 0:
            return {"error": "negative", "message": f"{KIND_LABELS[kind_src]}는 음수일 수 없어요."}
        result = float(value) * _UNITS[src][1] / _UNITS[dst][1]
    result = round(result, 10) if abs(result) < 1e6 else result
    show = (lambda u: f"°{u}" if u in ("C", "F") else u) if kind_src == "temperature" else (lambda u: u)
    return {
        "kind": KIND_LABELS[kind_src],
        "value": _num(float(value)),
        "from_unit": src,
        "to_unit": dst,
        "result": _num(result),
        "text": f"{_num(float(value))} {show(src)} = {_num(result)} {show(dst)}",
    }


# ── date_calc ─────────────────────────────────────────────────────────────────────

MAX_DAYS = 100_000
_WEEKDAYS = "월화수목금토일"
_DATE_RE = re.compile(r"^\s*(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?\s*$")


def _today(timezone: str = DEFAULT_TIMEZONE) -> date:
    tz = _zone(timezone) or UTC
    return _now().astimezone(tz).date()


def _parse_date(raw: str | None, timezone: str) -> date | None:
    text = (raw or "").strip()
    if text in ("", "today", "오늘", "now"):
        return _today(timezone)
    if text in ("내일", "tomorrow"):
        return _today(timezone) + timedelta(days=1)
    if text in ("어제", "yesterday"):
        return _today(timezone) - timedelta(days=1)
    m = _DATE_RE.match(text)
    if not m:
        return None
    try:
        return date(int(m[1]), int(m[2]), int(m[3]))
    except ValueError:
        return None


def _day(d: date) -> dict[str, str]:
    return {"date": d.isoformat(), "weekday": _WEEKDAYS[d.weekday()] + "요일"}


def date_calc(
    operation: Literal["diff", "add_days", "weekday"],
    date: str = "today",
    other_date: str | None = None,
    days: int | None = None,
    timezone: str = DEFAULT_TIMEZONE,
) -> dict[str, Any]:
    """날짜 계산: 두 날짜 사이 일수(diff) · 며칠 뒤/앞(add_days) · 요일(weekday). 'D-몇', '100일 뒤' 같은 질문에 쓴다.

    Args:
        operation: diff = date 부터 other_date 까지 일수 · add_days = date 에 days 를 더한 날 · weekday = date 의 요일.
        date: 기준 날짜 YYYY-MM-DD (또는 today/오늘 · 내일 · 어제). 기본은 오늘 (한국 시간).
        other_date: diff 의 끝 날짜 YYYY-MM-DD.
        days: add_days 에 더할 일수 (음수 = 며칠 전).
        timezone: '오늘' 을 정할 시간대. 기본 Asia/Seoul.
    """
    tz = (timezone or DEFAULT_TIMEZONE).strip()
    if len(tz) > 64 or _zone(tz) is None:
        return {"error": "unknown_timezone", "message": f"'{tz[:64]}' 시간대를 찾지 못했어요. 예: Asia/Seoul"}
    start = _parse_date(date, tz)
    if start is None:
        return {"error": "bad_date", "message": f"'{str(date)[:40]}' 날짜를 읽지 못했어요. 예: 2026-12-25"}
    if operation == "weekday":
        return {"operation": "weekday", **_day(start)}
    if operation == "add_days":
        if days is None or isinstance(days, bool) or not isinstance(days, int):
            return {"error": "missing_days", "message": "더할 일수(days)를 정수로 주세요."}
        if abs(days) > MAX_DAYS:
            return {"error": "out_of_range", "message": f"일수는 ±{MAX_DAYS}일까지예요."}
        try:
            end = start + timedelta(days=days)
        except OverflowError:
            return {"error": "out_of_range", "message": "날짜 범위(1~9999년)를 벗어나요."}
        return {"operation": "add_days", "from": _day(start), "days": days, **_day(end)}
    if operation == "diff":
        end = _parse_date(other_date, tz) if other_date is not None else None
        if end is None:
            return {"error": "bad_date", "message": f"끝 날짜(other_date) '{str(other_date)[:40]}' 를 읽지 못했어요. 예: 2026-12-25"}
        n = (end - start).days
        weeks, rest = divmod(abs(n), 7)
        return {
            "operation": "diff", "from": _day(start), "to": _day(end), "days": n,
            "weeks": weeks, "remaining_days": rest,
            "text": f"{abs(n)}일 {'뒤' if n > 0 else '전' if n < 0 else '(같은 날)'}" if n else "같은 날",
        }
    return {"error": "bad_operation", "message": "operation 은 diff, add_days, weekday 중 하나예요."}


# ── text_stats ────────────────────────────────────────────────────────────────────

MAX_TEXT = 100_000
_HANGUL = re.compile(r"[가-힣]")
_SENTENCE = re.compile(r"[^.!?。！？\n]+(?:[.!?。！？]+|$)", re.M)


def text_stats(text: str) -> dict[str, Any]:
    """글 길이 세기: 글자 수(공백 포함·제외) · 단어 수 · 줄 수 · 한글 음절 수 · 문장 수 · UTF-8 바이트. '몇 자야?' 같은 질문에 쓴다.

    Args:
        text: 셀 글 (10만 자까지).
    """
    if not isinstance(text, str):
        return {"error": "bad_text", "message": "글을 주세요."}
    if len(text) > MAX_TEXT:
        return {"error": "too_long", "message": f"{MAX_TEXT:,}자까지 셀 수 있어요."}
    norm = unicodedata.normalize("NFC", text)  # 자모로 나뉜 한글(맥에서 붙여 넣은 글)도 음절 하나 = 한 글자
    chars = [c for c in norm if unicodedata.category(c) not in ("Cc", "Cf") or c in "\n\t"]
    lines = norm.splitlines() if norm else []
    return {
        "characters": sum(1 for c in chars if c not in "\n\r"),
        "characters_no_spaces": sum(1 for c in chars if not c.isspace()),
        "words": len(norm.split()),
        "lines": len(lines),
        "non_empty_lines": sum(1 for ln in lines if ln.strip()),
        "hangul_syllables": len(_HANGUL.findall(norm)),
        "sentences": sum(1 for s in _SENTENCE.findall(norm) if s.strip()),
        "bytes_utf8": len(norm.encode("utf-8")),
    }


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
    ToolSpec(
        name="unit_convert",
        label="단위 변환",
        description="길이(km·mi·ft…) · 무게(kg·lb…) · 온도(C·F·K) · 데이터 크기(GB·GiB…) 단위를 바꾼다. 환산은 이 도구로.",
        function=unit_convert,
    ),
    ToolSpec(
        name="date_calc",
        label="날짜 계산",
        description="두 날짜 사이 일수 · 며칠 뒤/앞 날짜 · 요일을 계산한다 (오늘 = 한국 시간). 'D-몇', '100일 뒤' 같은 질문에.",
        function=date_calc,
    ),
    ToolSpec(
        name="text_stats",
        label="글자 수 세기",
        description="글의 글자 수(공백 포함·제외) · 단어 · 줄 · 한글 음절 · 문장 수를 센다. 글 길이는 이 도구로 센다.",
        function=text_stats,
    ),
)

USE_SKILL = "use_skill"  # skills.py 가 만드는 툴 이름 (활동 단계는 tool:use_skill 대신 skill:<스킬 이름>)
EXTRA_LABELS = {USE_SKILL: "스킬 사용"}
STEP_LABELS = {"thinking": "생각", "writing": "답 쓰기"}  # 활동 단계 이름 → 화면 이름 (tool:<name> 은 툴 label)


def tool_label(name: str) -> str:
    return next((t.label for t in BUILTIN_TOOLS if t.name == name), EXTRA_LABELS.get(name, name))


def step_label(step: str, skill_labels: dict[str, str] | None = None) -> str:
    """thinking · writing · tool:<툴> · skill:<스킬> → 화면 이름. skill_labels = 스킬 이름 → 한국어 이름."""
    if step.startswith("tool:"):
        return tool_label(step.removeprefix("tool:"))
    if step.startswith("skill:"):
        name = step.removeprefix("skill:")
        return f"스킬: {(skill_labels or {}).get(name, name)}"
    return STEP_LABELS.get(step, step)
