"""내장 툴 — 네트워크·파일 접근 없음 · eval 없음."""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfoNotFoundError

import pytest

from conductor import tools
from conductor.agent import build_toolset
from conductor.tools import BUILTIN_TOOLS, calculator, current_time, date_calc, step_label, text_stats, unit_convert


@pytest.mark.parametrize(
    ("expression", "result"),
    [
        ("12*(3+4)", "84"),
        ("2**10", "1024"),
        ("2^10", "1024"),  # ^ = 거듭제곱 (사람이 쓰는 표기)
        ("7 / 2", "3.5"),
        ("7 // 2", "3"),
        ("-7 % 3", "2"),
        ("3 × 4 ÷ 2", "6"),
        ("sqrt(16) + abs(-2)", "6"),
        ("round(3.14159, 2)", "3.14"),
        ("max(1, 5, 3)", "5"),
        ("0.1 + 0.2", "0.3"),
        ("pi", "3.14159265359"),
        ("1e3", "1000"),
    ],
)
def test_calculator(expression: str, result: str) -> None:
    assert calculator(expression)["result"] == result


@pytest.mark.parametrize(
    ("expression", "error"),
    [
        ("1/0", "division_by_zero"),
        ("__import__('os').system('echo x')", "unsupported"),
        ("(1).__class__", "unsupported"),
        ("open('x')", "unsupported"),
        ("[1, 2]", "unsupported"),
        ("'a' * 3", "unsupported"),
        ("x + 1", "unsupported"),
        ("lambda: 1", "unsupported"),
        ("10**10**10", "out_of_range"),  # 메모리 폭주 방지
        ("9**999", "out_of_range"),
        ("1e308 * 10", "out_of_range"),
        ("log(-1)", "math_domain"),
        ("sqrt(1, 2)", "bad_arguments"),
        ("round(1, 99)", "bad_arguments"),
        ("sqrt(x=1)", "unsupported"),
        ("1 +", "syntax"),
        ("", "empty"),
        ("1+" * 150 + "1", "too_long"),
        ("(-8) ** 0.5", "not_a_number"),  # 복소수
        ("True + 1", "unsupported"),
    ],
)
def test_calculator_rejects(expression: str, error: str) -> None:
    out = calculator(expression)
    assert out["error"] == error and out["message"]


def test_current_time(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tools, "_now", lambda: datetime(2026, 10, 29, 3, 4, 5, tzinfo=UTC))
    assert current_time() == {
        "timezone": "Asia/Seoul", "iso": "2026-10-29T12:04:05+09:00", "date": "2026-10-29", "time": "12:04:05",
        "weekday": "목요일", "utc_offset": "+09:00",
    }
    assert current_time("UTC")["time"] == "03:04:05"
    assert current_time("Mars/Olympus")["error"] == "unknown_timezone"
    assert current_time("x" * 65)["error"] == "bad_timezone"


def test_current_time_without_tz_database(monkeypatch: pytest.MonkeyPatch) -> None:
    """윈도우 파이썬은 tzdata 가 없으면 ZoneInfo 가 실패한다 → 일광절약시간 없는 시간대는 고정 오프셋으로."""

    def missing(name: str):
        raise ZoneInfoNotFoundError(name)

    monkeypatch.setattr(tools, "ZoneInfo", missing)
    monkeypatch.setattr(tools, "_now", lambda: datetime(2026, 10, 29, 3, 4, 5, tzinfo=UTC))
    assert current_time()["iso"] == "2026-10-29T12:04:05+09:00"
    assert current_time("UTC")["utc_offset"] == "+00:00"
    assert current_time("America/New_York")["error"] == "unknown_timezone"


def test_registry_builds_pydantic_ai_tools() -> None:
    toolset = build_toolset(BUILTIN_TOOLS)
    assert set(toolset.tools) == {"current_time", "calculator", "unit_convert", "date_calc", "text_stats"}
    calc = toolset.tools["calculator"]
    assert calc.function_schema.json_schema["required"] == ["expression"]
    assert "timezone" in toolset.tools["current_time"].function_schema.json_schema["properties"]
    assert not any(t.requires_approval for t in BUILTIN_TOOLS)
    assert [step_label(s) for s in ("thinking", "tool:calculator", "tool:current_time", "writing", "tool:mcp_x", "tool:unit_convert")] == [
        "생각", "계산기", "현재 시각", "답 쓰기", "mcp_x", "단위 변환",
    ]
    assert step_label("skill:summarize", {"summarize": "요약"}) == "스킬: 요약" and step_label("skill:x") == "스킬: x"
    assert toolset.tools["unit_convert"].function_schema.json_schema["required"] == ["value", "from_unit", "to_unit"]
    op = toolset.tools["date_calc"].function_schema.json_schema["properties"]["operation"]
    assert op["enum"] == ["diff", "add_days", "weekday"]


# ── unit_convert ──


@pytest.mark.parametrize(
    ("value", "src", "dst", "result"),
    [
        (5, "km", "mi", "3.106855961"),
        (1, "mi", "km", "1.609344"),
        (12, "in", "cm", "30.48"),
        (6, "ft", "m", "1.8288"),
        (0.1, "m", "cm", "10"),
        (3, "파운드", "킬로그램", "1.36077711"),
        (1, "kg", "lb", "2.204622622"),
        (16, "oz", "g", "453.59237"),
        (100, "C", "F", "212"),
        (-40, "F", "C", "-40"),
        (0, "K", "섭씨", "-273.15"),
        (36.5, "°c", "°f", "97.7"),
        (1, "GiB", "MB", "1073.741824"),
        (1, "TB", "GiB", "931.3225746"),
        (1024, "KiB", "MiB", "1"),
        (1500, "kb", "MB", "1.5"),
        (0, "km", "m", "0"),
    ],
)
def test_unit_convert(value: float, src: str, dst: str, result: str) -> None:
    out = unit_convert(value, src, dst)
    assert out["result"] == result, out


@pytest.mark.parametrize(
    ("value", "src", "dst", "error"),
    [
        (1, "kg", "km", "incompatible_units"),
        (1, "GB", "C", "incompatible_units"),
        (1, "furlong", "m", "unknown_unit"),
        (1, "m", "", "unknown_unit"),
        (-300, "C", "K", "below_absolute_zero"),
        (-1, "K", "C", "below_absolute_zero"),
        (-5, "km", "m", "negative"),
        (float("nan"), "m", "km", "bad_value"),
        (float("inf"), "m", "km", "bad_value"),
        (True, "m", "km", "bad_value"),
        (1e19, "m", "km", "out_of_range"),
    ],
)
def test_unit_convert_rejects(value: float, src: str, dst: str, error: str) -> None:
    out = unit_convert(value, src, dst)
    assert out["error"] == error and out["message"]


def test_unit_convert_text_and_kind() -> None:
    assert unit_convert(100, "C", "F")["text"] == "100 °C = 212 °F"
    assert unit_convert(5, "km", "mi") | {"kind": "길이", "from_unit": "km", "to_unit": "mi"} == unit_convert(5, "km", "mi")


# ── date_calc (오늘 = 한국 시간) ──


def test_date_calc(monkeypatch: pytest.MonkeyPatch) -> None:
    # UTC 10-29 15:30 = 한국 10-30 00:30 → '오늘' 은 한국 날짜
    monkeypatch.setattr(tools, "_now", lambda: datetime(2026, 10, 29, 15, 30, tzinfo=UTC))
    assert date_calc("weekday")["date"] == "2026-10-30" and date_calc("weekday")["weekday"] == "금요일"
    assert date_calc("weekday", timezone="UTC")["date"] == "2026-10-29"
    d = date_calc("diff", "오늘", "2026-12-25")
    assert (d["days"], d["weeks"], d["remaining_days"], d["text"]) == (56, 8, 0, "56일 뒤")
    assert date_calc("diff", "2026-12-25", "2026-10-30")["days"] == -56
    assert date_calc("diff", "2026-10-30", "2026-10-30")["text"] == "같은 날"
    assert date_calc("diff", "2024-02-28", "2024-03-01")["days"] == 2  # 윤년
    a = date_calc("add_days", "2026-10-30", days=100)
    assert (a["date"], a["weekday"], a["from"]["date"]) == ("2027-02-07", "일요일", "2026-10-30")
    assert date_calc("add_days", "2026년 1월 1일", days=-1)["date"] == "2025-12-31"
    assert date_calc("add_days", "내일", days=0)["date"] == "2026-10-31"
    assert date_calc("weekday", "2026.12.25")["weekday"] == "금요일"


@pytest.mark.parametrize(
    ("kwargs", "error"),
    [
        ({"operation": "diff", "date": "2026-02-30", "other_date": "2026-03-01"}, "bad_date"),
        ({"operation": "diff", "date": "today"}, "bad_date"),
        ({"operation": "diff", "date": "today", "other_date": "다음 주"}, "bad_date"),
        ({"operation": "add_days", "date": "today"}, "missing_days"),
        ({"operation": "add_days", "date": "today", "days": 100_001}, "out_of_range"),
        ({"operation": "add_days", "date": "9999-12-31", "days": 1}, "out_of_range"),
        ({"operation": "add_days", "date": "today", "days": True}, "missing_days"),
        ({"operation": "weekday", "date": "today", "timezone": "Mars/Base"}, "unknown_timezone"),
        ({"operation": "nope", "date": "today"}, "bad_operation"),
    ],
)
def test_date_calc_rejects(kwargs: dict, error: str) -> None:
    assert date_calc(**kwargs)["error"] == error


# ── text_stats (한국어) ──


def test_text_stats_korean() -> None:
    s = text_stats("안녕하세요 세계!\n두 번째 줄.")
    assert s == {
        "characters": 16, "characters_no_spaces": 13, "words": 5, "lines": 2, "non_empty_lines": 2,
        "hangul_syllables": 11, "sentences": 2, "bytes_utf8": 39,
    }
    # 맥에서 붙여 넣은 자모 분리(NFD) 한글도 한 음절 = 한 글자
    import unicodedata

    nfd = unicodedata.normalize("NFD", "한글")
    assert len(nfd) == 6 and text_stats(nfd)["characters"] == 2 and text_stats(nfd)["hangul_syllables"] == 2
    assert text_stats("") | {"characters": 0, "words": 0, "lines": 0, "sentences": 0} == text_stats("")
    assert text_stats("a\u200bb")["characters"] == 2  # 보이지 않는 글자(제로폭)는 안 센다
    assert text_stats("가" * 100_001)["error"] == "too_long"
    assert text_stats(3)["error"] == "bad_text"  # type: ignore[arg-type]


@pytest.mark.parametrize("expression", ["log(5, 1)", "log(1, 1)", "max(1)", "min(2)"])
def test_calculator_never_raises_on_bad_function_args(expression) -> None:
    out = calculator(expression)
    assert out["error"] in ("math_domain", "bad_arguments")


def test_tool_errors_do_not_echo_huge_input() -> None:
    assert len(unit_convert(1, "x" * 5000, "m")["message"]) < 120
    assert len(date_calc("weekday", date="y" * 5000)["message"]) < 120
    assert len(date_calc("diff", date="2026-01-01", other_date="z" * 5000)["message"]) < 120
