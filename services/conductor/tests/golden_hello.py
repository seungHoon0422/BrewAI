"""팀 없는 실행의 골든 캡처 (slice 06 전 코드로 찍었다 · tests/fixtures/pre-team-golden.json) — test_tokens.py 가 비교한다.

게이트웨이로 가는 요청 본문(바이트 그대로 · OpenAIChatModel → httpx2.MockTransport)과 SSE 이벤트(시각 · 무작위 id · 시간 칸만 지움)를
경우 4개로 남긴다: hello 앱 0개 · hello 앱 54개 · MCP 3턴(공개 → 도구 → 후속) · 한 응답의 병렬 MCP 도구 2개.
사용자 · 서버 id (uuid4) 는 '<uuid>' 로 바꾼다. 다시 찍기 = 이 파일의 capture() (게이트가 꺼진 길이 바뀌지 않았다는 걸 보이는 게 목적이라
일부러 다시 찍지 않는다). 다시 찍은 때: 2026-11-04 slice 08 (스킬 줄 · use_skill 인자 need · 스타터 5개 — 그 세 곳만 달라진 것을 diff 로 확인).
"""

from __future__ import annotations

import json
import re
from datetime import timedelta
from pathlib import Path
from typing import Any

GOLDEN = Path(__file__).parent / "fixtures" / "pre-team-golden.json"
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_DROP = {"timestamp", "duration_ms", "started_ms", "created_at", "finished_at", "updated_at"}


def scrub(value: Any) -> Any:
    """uuid → '<uuid>' · 시각 · 시간 칸 지움 (나머지는 그대로)."""
    def walk(v: Any) -> Any:
        if isinstance(v, dict):
            return {k: walk(x) for k, x in v.items() if k not in _DROP}
        if isinstance(v, list):
            return [walk(x) for x in v]
        return v
    return json.loads(_UUID.sub("<uuid>", json.dumps(walk(value), ensure_ascii=False)))


def canon(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """병렬 툴 결과는 끝나는 순서대로 온다 (agent.py 계약 · 정해지지 않음) → 붙어 있는 (TOOL_CALL_RESULT, STEP_FINISHED) 쌍을 call id 순으로."""
    out: list[dict[str, Any]] = []
    i = 0
    while i < len(events):
        pairs = []
        while (i + 1 < len(events) and events[i]["type"] == "TOOL_CALL_RESULT" and events[i + 1]["type"] == "STEP_FINISHED"
               and events[i + 1]["stepName"].startswith("tool:")):
            pairs.append(events[i : i + 2])
            i += 2
        if pairs:
            out += [e for pair in sorted(pairs, key=lambda p: p[0]["toolCallId"]) for e in pair]
        else:
            out.append(events[i])
            i += 1
    return out


def scenarios(make: Any, make_api: Any, h: Any, fake_mcp: Any, clock: Any, wire_cls: Any, user_turn_tool_msgs: Any) -> dict[str, Any]:
    """경우 4개 → {이름: {requests, events}} (events = 턴별 SSE). test_tokens.make · Wire 를 받아 쓴다."""
    out: dict[str, Any] = {}

    wire = wire_cls()
    api = make(make_api, h, wire)
    ev = api.chat("hello")
    out["hello_0_apps"] = {"requests": wire.sent, "events": [ev]}

    wire = wire_cls()
    api = make(make_api, h, wire)
    cat = api.app.state.connectors.catalog
    for i in range(54):
        cat.add_server(name=f"Preset {i:02d}", url=f"https://p{i}.preset.test/mcp", origin="admin", owner_user_id=None,
                       description=f"설명이 아주 긴 앱 {i} " * 4, auth="none" if i < 18 else "oauth")
    ev = api.chat("hello")
    out["hello_54_apps"] = {"requests": wire.sent, "events": [ev]}

    def plan(body: dict[str, Any], n: int) -> tuple[str, Any]:
        cur = user_turn_tool_msgs(body, current=True)
        q = [m for m in body["messages"] if m["role"] == "user"][-1]["content"]
        if q == "메모 찾아줘" and not cur:
            return ("tools", [("use_app", {"app": "notes", "need": "메모 검색"})])
        if q == "메모 찾아줘" and len(cur) == 1:
            return ("tools", [("notes__echo", {"text": "회의"})])
        if q == "둘 다 메아리" and not cur:
            return ("tools", [("use_app", {"app": "notes", "need": "메모 검색"})])
        if q == "둘 다 메아리" and len(cur) == 1:
            return ("tools", [("notes__echo", {"text": "하나"}), ("notes__echo", {"text": "둘"})])
        return ("text", f"답 {n}")

    wire = wire_cls(plan)
    api = make(make_api, h, wire, fake_mcp)
    api.client.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp", "name": "Notes"})
    turns = [api.chat("안녕", thread="tp")]
    clock["t"] += timedelta(minutes=3)
    turns.append(api.chat("메모 찾아줘", thread="tp"))
    clock["t"] += timedelta(minutes=1)
    turns.append(api.chat("고마워", thread="tp"))
    out["mcp_three_turns"] = {"requests": wire.sent, "events": turns,
                              "thread": api.client.get("/api/threads/tp").json()["messages"]}

    wire = wire_cls(plan)
    api = make(make_api, h, wire, fake_mcp)
    api.client.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp", "name": "Notes"})
    ev = api.chat("둘 다 메아리", thread="tq")
    out["mcp_parallel"] = {"requests": wire.sent, "events": [ev], "runs": api.client.get("/api/runs").json()[0]["steps"]}
    return scrub(out)


def capture(data: dict[str, Any]) -> None:  # pragma: no cover - 한 번 찍을 때만
    GOLDEN.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
