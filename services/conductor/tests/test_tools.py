"""내장 툴 — 네트워크·파일 접근 없음 · eval 없음."""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfoNotFoundError

import pytest

from conductor import tools
from conductor.agent import build_toolset
from conductor.tools import BUILTIN_TOOLS, calculator, current_time, step_label


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
    assert set(toolset.tools) == {"current_time", "calculator"}
    calc = toolset.tools["calculator"]
    assert calc.function_schema.json_schema["required"] == ["expression"]
    assert "timezone" in toolset.tools["current_time"].function_schema.json_schema["properties"]
    assert not any(t.requires_approval for t in BUILTIN_TOOLS)
    assert [step_label(s) for s in ("thinking", "tool:calculator", "tool:current_time", "writing", "tool:mcp_x")] == [
        "생각", "계산기", "현재 시각", "답 쓰기", "mcp_x",
    ]
