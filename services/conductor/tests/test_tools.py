"""툴 모양 (ToolSpec → Pydantic AI) · 화면 이름 · 날짜 줄. 내장 툴은 없다 (스킬 · MCP 앱이 맡는다)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from conductor import tools
from conductor.agent import ChatRuntime, build_toolset
from conductor.tools import ToolSpec, now_line, step_label, tool_label


def _echo(text: str) -> dict[str, Any]:
    """글을 그대로 돌려준다.

    Args:
        text: 돌려줄 글.
    """
    return {"text": text}


def test_toolspec_builds_pydantic_ai_tools_from_signature_or_schema() -> None:
    schema = {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}
    toolset = build_toolset([
        ToolSpec(name="echo", label="따라 말하기", description="글을 돌려준다.", function=_echo),
        ToolSpec(name="echo_short", label="짧게", description="돌려준다.", function=_echo, schema=schema, requires_approval=True),
    ])
    assert toolset.tools["echo"].function_schema.json_schema["required"] == ["text"]
    assert toolset.tools["echo_short"].function_schema.json_schema == schema  # 손으로 쓴 스키마 그대로 (설명 · title 없음)
    assert toolset.tools["echo_short"].requires_approval is True and toolset.tools["echo"].requires_approval is False


def test_no_builtin_tools_by_default() -> None:
    rt = ChatRuntime(gateway_url="http://gateway.invalid", gateway_key="sk-x")
    assert rt.tools == () and rt.instructions == rt.instructions.strip()
    assert "calculator" not in rt.instructions and "current_time" not in rt.instructions


def test_labels_for_steps_and_old_history() -> None:
    assert [step_label(s) for s in ("thinking", "writing", "tool:use_skill", "tool:use_app", "tool:mcp_x")] == [
        "생각", "답 쓰기", "스킬 사용", "앱 도구 고르기", "mcp_x",
    ]
    assert step_label("skill:summarize", {"summarize": "요약"}) == "스킬: 요약" and step_label("skill:x") == "스킬: x"
    assert step_label("app:exa", {"app:exa": "Exa 웹 검색"}) == "앱: Exa 웹 검색" and step_label("app:x") == "앱: x"
    assert step_label("tool:echo", {"tool:echo": "따라 말하기"}) == "따라 말하기"  # 꽂은 ToolSpec 의 화면 이름
    # 예전 대화 기록 (내장 툴 · search_tools 가 있던 때) 을 다시 열어도 한국어 이름
    assert [tool_label(n) for n in ("calculator", "current_time", "search_tools")] == ["계산기", "현재 시각", "앱 도구 찾기"]


def test_now_line_is_one_short_line_in_korea_time(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tools, "_now", lambda: datetime(2026, 10, 31, 23, 59, 30, tzinfo=UTC))
    assert now_line() == "지금: 2026-11-01 (일) 08:59 KST"  # 분 단위 · 요일 · 한국 시간
    assert now_line("UTC") == "지금: 2026-10-31 (토) 23:59 UTC+0000"
    assert len(now_line()) < 40
