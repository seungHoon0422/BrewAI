"""conductor 툴 이름 · 화면 이름 · 툴 모양 (한곳). 내장 툴은 없다 — 할 일은 스킬(runtime/skills)과 MCP 앱이 맡는다.

툴 모양 = ToolSpec (name · label · 함수 · 선택 schema). 스킬을 불러오는 use_skill 은 skills.py 가 이 모양으로 만든다 (스킬이 있을 때만).
MCP 앱 도구는 agent.py 의 _AppTools 가 따로 싣는다 (use_app 으로 꺼낸 것만). 테스트는 이 모양으로 가짜 툴을 꽂는다.
여기 함수는 순수 파이썬이다 (Pydantic AI import 없음, ADR-0002). 툴은 예외를 던지지 않고 {"error": code, "message": 한국어} 를 돌려준다.
날짜 · 시각 = now_line() 한 줄을 그 턴의 사용자 메시지 앞에 둔다 (agent.py · 시스템 프롬프트는 날마다 같은 글 = 프롬프트 캐시).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from datetime import timezone as fixed_zone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "Asia/Seoul"
TIMEZONE_LABEL = "KST"


@dataclass(frozen=True)
class ToolSpec:
    name: str  # 모델이 부르는 이름 = AG-UI toolCallName = 활동 단계 "tool:<name>"
    label: str  # 화면 이름 (한국어)
    description: str  # 모델에게 주는 설명
    function: Callable[..., dict[str, Any]]
    requires_approval: bool = False  # P2 승인·정책: True 면 사람 승인 뒤에만 실행
    schema: dict[str, Any] | None = None  # 손으로 쓴 인자 JSON Schema (짧게 = 토큰). None = 함수 서명에서 만든다


USE_SKILL = "use_skill"  # skills.py 가 만드는 툴 이름 (활동 단계는 tool:use_skill 대신 skill:<스킬 이름>)
USE_APP = "use_app"  # MCP 앱 도구 꺼내기 (agent.py · connectors/session.py — 활동 단계는 tool:use_app 대신 app:<handle>)
DELEGATE = "delegate"  # 팀원에게 맡기기 (team.py · agent.py — 활동 단계는 tool:delegate 대신 agent:<a1|a2|a3>)
EXTRA_LABELS = {USE_SKILL: "스킬 사용", USE_APP: "앱 도구 고르기", DELEGATE: "팀원에게 맡기기", "read_file": "파일 읽기", "make_file": "파일 만들기",
                "folder_list": "폴더 보기", "folder_read": "폴더 파일 읽기", "folder_search": "폴더 검색"}  # 로컬 폴더 (localfs.py)
SKILL_TOOLS = ("make_file",)  # 스킬 머리말 tools 에 적을 수 있는 도구 (그 스킬을 부르면 도구 배열에 · agent._skill_toolset)
# 예전 기록의 화면 이름 (내장 툴 5개 · search_tools 는 없어졌다 · 옛 대화를 다시 열 때만)
LEGACY_LABELS = {
    "current_time": "현재 시각", "calculator": "계산기", "unit_convert": "단위 변환", "date_calc": "날짜 계산",
    "text_stats": "글자 수 세기", "search_tools": "앱 도구 찾기",
}
STEP_LABELS = {"thinking": "생각", "writing": "답 쓰기"}  # 활동 단계 이름 → 화면 이름 (tool:<name> 은 툴 label)


def tool_label(name: str) -> str:
    return EXTRA_LABELS.get(name) or LEGACY_LABELS.get(name, name)


def step_label(step: str, skill_labels: dict[str, str] | None = None) -> str:
    """thinking · writing · tool:<툴> · skill:<스킬> · app:<handle> · agent:<n> → 화면 이름. skill_labels = 스킬 이름 → 한국어 이름
    (+ 'app:<handle>' → 앱 이름 · 'tool:<handle>__<도구>' → '앱: 도구' — MCP 는 실행마다 connectors/session.py 가 채운다
    · 'agent:a1' → 팀원 역할 (agent.py 가 delegate 인자에서 채운다 · 없으면 '팀원 1'))."""
    labels = skill_labels or {}
    if step in labels and not step.startswith("skill:"):
        return f"앱: {labels[step]}" if step.startswith("app:") else labels[step]
    if step.startswith("agent:"):
        n = step.removeprefix("agent:").removeprefix("a")
        return f"팀원 {n}" if n.isdigit() else "팀원"
    if step.startswith("app:"):
        return f"앱: {step.removeprefix('app:')}"
    if step.startswith("tool:"):
        return tool_label(step.removeprefix("tool:"))
    if step.startswith("skill:"):
        name = step.removeprefix("skill:")
        return f"스킬: {labels.get(name, name)}"
    return STEP_LABELS.get(step, step)


# ── 지금 날짜 · 시각 (한 줄) ───────────────────────────────────────────────────────

# 윈도우 파이썬은 IANA 시간대 DB 가 없을 수 있다 (tzdata 패키지 없음). 일광절약시간 없는 몇 곳만 고정 오프셋으로 대신한다
_FIXED_OFFSETS = {"UTC": 0, "Etc/UTC": 0, "Asia/Seoul": 9, "Asia/Tokyo": 9, "Asia/Shanghai": 8, "Asia/Singapore": 8}
NOW_PREFIX = "지금: "  # mock 게이트웨이가 이 줄을 '질문' 으로 세지 않는다 (e2e/mock/gateway.mjs userTexts)


def _zone(name: str) -> fixed_zone | ZoneInfo | None:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        hours = _FIXED_OFFSETS.get(name)
        return None if hours is None else (UTC if hours == 0 else fixed_zone(timedelta(hours=hours), name))


def _now() -> datetime:  # 테스트가 바꾼다
    return datetime.now(UTC)


def now_line(timezone: str = DEFAULT_TIMEZONE) -> str:
    """'지금: 2026-11-01 (일) 17:30 KST' — 분 단위 (실행 하나 동안 같은 값 · 기록에 남아 다음 턴에도 같은 바이트)."""
    moment = _now().astimezone(_zone(timezone) or UTC)
    zone = TIMEZONE_LABEL if timezone == DEFAULT_TIMEZONE else f"UTC{moment:%z}"
    return f"{NOW_PREFIX}{moment:%Y-%m-%d} ({'월화수목금토일'[moment.weekday()]}) {moment:%H:%M} {zone}"
