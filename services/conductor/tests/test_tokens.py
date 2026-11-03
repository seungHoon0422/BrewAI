"""요청 토큰 다이어트 (slice 05 '토큰') — LiteLLM 으로 가는 진짜 바이트 (OpenAIChatModel → httpx2.MockTransport) 를 잰다.

상한 (estimate_tokens · 요청 본문 JSON 전체 · 실측의 약 1.25배 · 실측 전 값은 docs/slices/05-mcp.md '토큰'):
  hello · 앱 0개 (스타터 스킬 2개)         ≤ 280   (지금 225 · 전: 1,505)
  hello · 앱 54개 (바로 18 · 로그인 필요 36) ≤ 520   (지금 413 · 전: 2,566)
  큰 도구 결과 둘 다음 턴의 hello           ≤ 1,250 (지금 1,001 · 전: 9,397 · 지난 턴 결과 = 앞부분 + '줄임')
고정 앞부분 (도구 정의 + 시스템 지침) = 턴 · 분이 바뀌어도 같은 바이트. 앞 요청이 다음 요청의 앞부분 그대로인 건 한 턴의 도구 루프 안 ·
그리고 지난 턴에 600B 넘는 결과가 없을 때까지 (턴이 바뀌면 그 결과가 '줄임'으로 바뀐다). use_app 공개 = 도구 배열이 바뀐다 (Anthropic 캐시는 처음부터).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from conductor import tools as tools_mod
from conductor.agent import HISTORY_RESULT_BYTES, compact_result
from conductor.connectors.client import MAX_RESULT_BYTES, cap_result, estimate_tokens
from conductor.connectors.vault import generate_key
from conductor.skills import load_skills

HELLO_0_APPS = 280
HELLO_54_APPS = 520
HELLO_AFTER_BIG_RESULTS = 1250


class Wire:
    """가짜 LiteLLM (/v1/chat/completions 스트림). plan(body, n) → ('text', 글) | ('tools', [(이름, 인자) …]). 받은 본문을 남긴다."""

    def __init__(self, plan: Any = None) -> None:
        self.sent: list[dict[str, Any]] = []
        self.plan = plan or (lambda body, n: ("text", "안녕하세요"))

    def client(self) -> Any:
        import httpx2
        from openai import AsyncOpenAI

        def chunk(delta: dict[str, Any] | None, finish: str | None = None) -> str:
            body = {"id": "x", "created": 1, "model": "m", "object": "chat.completion.chunk",
                    "choices": [] if delta is None else [{"index": 0, "delta": delta, "finish_reason": finish}]}
            return f"data: {json.dumps(body, ensure_ascii=False)}\n\n"

        def handler(req: httpx2.Request) -> httpx2.Response:
            body = json.loads(req.content)
            self.sent.append(body)
            kind, value = self.plan(body, len(self.sent))
            if kind == "tools":
                calls = [{"index": i, "id": f"call_{len(self.sent)}_{i}", "type": "function",
                          "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}} for i, (name, args) in enumerate(value)]
                out = chunk({"role": "assistant", "tool_calls": calls}) + chunk({}, "tool_calls")
            else:
                out = chunk({"role": "assistant", "content": value}) + chunk({}, "stop")
            return httpx2.Response(200, content=(out + "data: [DONE]\n\n").encode(), headers={"content-type": "text/event-stream"})

        return AsyncOpenAI(base_url="http://gateway.invalid/v1", api_key="sk-test-secret-0000", max_retries=0,
                           http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)))


def est(body: dict[str, Any]) -> int:
    return estimate_tokens(body)


def user_turn_tool_msgs(body: dict[str, Any], *, current: bool) -> list[dict[str, Any]]:
    """요청 본문의 role tool 메시지 — current = 마지막 사용자 질문 뒤 (이번 턴) · 아니면 그 앞 (지난 턴)."""
    msgs = body["messages"]
    last = max(i for i, m in enumerate(msgs) if m["role"] == "user")
    pick = msgs[last + 1 :] if current else msgs[:last]
    return [m for m in pick if m["role"] == "tool"]


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> dict[str, datetime]:
    now = {"t": datetime(2026, 11, 1, 5, 30, tzinfo=UTC)}
    monkeypatch.setattr(tools_mod, "_now", lambda: now["t"])
    return now


def make(make_api, h, wire: Wire, fake_mcp: Any = None, **kw: Any) -> Any:  # noqa: ANN001, ANN401
    app_kw = {"mcp_transport": fake_mcp.Fake().transport} if fake_mcp is not None else {}
    return make_api(None, openai_client=wire.client(), skills=load_skills(h.SKILLS_DIR), secret_key=generate_key(), app_kw=app_kw, **kw)


# ── 상한 ──────────────────────────────────────────────────────────────────────────


def test_hello_with_no_apps_is_small(make_api, h, clock) -> None:
    wire = Wire()
    api = make(make_api, h, wire)
    api.chat("hello")
    body = wire.sent[0]
    assert est(body) <= HELLO_0_APPS, est(body)
    assert [t["function"]["name"] for t in body["tools"]] == ["use_skill"]  # 내장 툴 0 · use_app 0 (앱 없음)
    system = body["messages"][0]["content"]
    assert "calculator" not in system and "2026" not in system  # 지침엔 날짜가 없다 (캐시 앞부분)
    assert body["messages"][1] == {"role": "user", "content": "지금: 2026-11-01 (일) 14:30 KST"}  # 날짜 · 시각 = 사용자 쪽 한 줄
    assert body["messages"][2] == {"role": "user", "content": "hello"}
    assert "cache_control_injection_points" not in body  # OpenAI 계열 = 앞부분이 같으면 저절로 캐시


def test_hello_with_54_apps_lists_only_ready_handles(make_api, h, clock) -> None:
    wire = Wire()
    api = make(make_api, h, wire)
    cat = api.app.state.connectors.catalog
    for i in range(54):  # 바로 쓸 수 있는 앱 18 (인증 없음) · 로그인이 필요한 앱 36
        cat.add_server(name=f"Preset {i:02d}", url=f"https://p{i}.preset.test/mcp", origin="admin", owner_user_id=None,
                       description=f"설명이 아주 긴 앱 {i} " * 4, auth="none" if i < 18 else "oauth")
    api.chat("hello")
    body = wire.sent[0]
    assert est(body) <= HELLO_54_APPS, est(body)
    # 시스템 메시지 = 고정 지침 (첫째) + 실행 지침 (앱 목록 한 줄 · 프로젝트 지침) 둘
    assert [m["role"] for m in body["messages"]] == ["system", "system", "user", "user"]
    system = "\n".join(m["content"] for m in body["messages"] if m["role"] == "system")
    line = body["messages"][1]["content"]
    assert line.startswith("앱 (use_app") and line.endswith("preset_17 외 36개") and line.count(", ") == 17  # 한 줄 · 이름만
    assert "설명이 아주 긴" not in system and "preset_18" not in system  # 설명 · 로그인 필요 앱 이름은 안 싣는다
    names = [t["function"]["name"] for t in body["tools"]]
    assert names == ["use_skill", "use_app"]  # search_tools 없음 · MCP 도구 정의 0


def test_followup_hello_after_two_big_results_replays_them_compacted(make_api, h, fake_mcp, clock) -> None:
    def plan(body: dict[str, Any], n: int) -> tuple[str, Any]:
        cur = user_turn_tool_msgs(body, current=True)
        last_user = [m for m in body["messages"] if m["role"] == "user"][-1]["content"]
        if last_user != "노트 둘 다 보여줘" or len(cur) >= 3:
            return ("text", "네")
        if not cur:
            return ("tools", [("use_app", {"app": "notes", "need": "목록"})])
        return ("tools", [("notes__big_list", {"n": 400}), ("notes__big_list", {"n": 10, "format": "records"})])

    wire = Wire(plan)
    api = make(make_api, h, wire, fake_mcp)
    api.client.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp", "name": "Notes"})
    api.chat("노트 둘 다 보여줘", thread="tb")
    final = wire.sent[-1]
    full = user_turn_tool_msgs(final, current=True)
    big = [m for m in full if len(m["content"].encode()) > 4000]
    assert len(big) == 2 and all(len(m["content"].encode()) <= MAX_RESULT_BYTES + 200 for m in big)  # 이번 턴 = 원본 (8KB 상한)
    records = json.loads(big[1]["content"])
    assert records["result"].count("Title: ") == 10 and "결과 9" in records["result"]  # 기록 모양 = 기록마다 줄여서 (뒤 기록도 보인다)
    assert records["untrusted"] is True

    clock["t"] += timedelta(minutes=7)
    api.chat("hello", thread="tb")
    body = wire.sent[-1]
    assert est(body) <= HELLO_AFTER_BIG_RESULTS, est(body)
    old = user_turn_tool_msgs(body, current=False)
    shrunk = [json.loads(m["content"]) for m in old if "줄임" in m["content"]]
    assert len(shrunk) == 2 and all(len(m["content"].encode()) <= HISTORY_RESULT_BYTES + 200 for m in old)
    assert all(s["untrusted"] is True and s["source"] == "notes" for s in shrunk)  # 남이 쓴 데이터 표시는 줄여도 그대로
    use_app = json.loads(old[0]["content"])
    assert use_app["app"] == "notes" and use_app["tools"]  # use_app 결과는 안 줄인다 (공개한 도구 이름)
    # 턴이 바뀌면 줄인 결과에서 앞부분이 갈린다: 시스템 · 도구 · 그 앞 메시지는 같은 바이트, 첫 '줄임' 결과부터 다르다
    cut = next(i for i, m in enumerate(body["messages"]) if m["role"] == "tool" and "줄임" in m["content"])
    assert body["tools"] == final["tools"] and body["messages"][:cut] == final["messages"][:cut]
    assert body["messages"][cut] != final["messages"][cut]
    # 저장된 기록은 원본 그대로 (화면 · 이어서 하기)
    parts = api.client.get("/api/threads/tb").json()["messages"][1]["parts"]
    assert len(json.dumps(parts[1]["result"], ensure_ascii=False).encode()) > 4000


# ── 캐시: 고정 앞부분 ─────────────────────────────────────────────────────────────


def test_stable_prefix_is_byte_identical_across_turns_and_minutes(make_api, h, fake_mcp, clock) -> None:
    def plan(body: dict[str, Any], n: int) -> tuple[str, Any]:
        cur = user_turn_tool_msgs(body, current=True)
        q = [m for m in body["messages"] if m["role"] == "user"][-1]["content"]
        if q == "메모 찾아줘" and not cur:
            return ("tools", [("use_app", {"app": "notes", "need": "메모 검색"})])
        if q == "메모 찾아줘" and len(cur) == 1:
            return ("tools", [("notes__echo", {"text": "회의"})])
        return ("text", f"답 {n}")

    wire = Wire(plan)
    api = make(make_api, h, wire, fake_mcp)
    api.client.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp", "name": "Notes"})
    api.chat("안녕", thread="tp")
    clock["t"] += timedelta(minutes=3)
    api.chat("메모 찾아줘", thread="tp")
    clock["t"] += timedelta(hours=2, minutes=1)
    api.chat("고마워", thread="tp")
    first, *loop, last = wire.sent
    assert len(loop) == 3
    # 시스템 지침 = 모든 요청에서 같은 바이트 (날짜 · 시각 · 최근 쓴 앱 순서가 없다) · 중간에 끼는 system 글 없음 (공개 알림 X)
    assert len({json.dumps(b["messages"][:2], ensure_ascii=False) for b in wire.sent}) == 1
    assert all([m["role"] for m in b["messages"]].count("system") == 2 for b in wire.sent)
    assert not any("now available" in json.dumps(b, ensure_ascii=False) for b in wire.sent)
    # 도구 배열: 고정 도구가 앞 · 공개된 MCP 도구는 뒤에 공개 순서대로 (그 앞부분은 그대로)
    fixed = first["tools"]
    assert [t["function"]["name"] for t in fixed] == ["use_skill", "use_app"]
    for b in [*loop, last]:
        assert b["tools"][: len(fixed)] == fixed
    assert loop[1]["tools"] == loop[2]["tools"] == last["tools"] and len(last["tools"]) > len(fixed)
    # 앞 요청 = 뒤 요청 메시지의 앞부분 (실행 안 · 턴 사이 · 분이 바뀌어도: 시각 줄은 그 턴의 기록에 남는다)
    seq = [first, *loop, last]
    for a, b in zip(seq, seq[1:], strict=False):
        assert b["messages"][: len(a["messages"])] == a["messages"]
    nows = [m["content"] for m in last["messages"] if m["role"] == "user" and m["content"].startswith("지금: ")]
    assert nows == ["지금: 2026-11-01 (일) 14:30 KST", "지금: 2026-11-01 (일) 14:33 KST", "지금: 2026-11-01 (일) 16:34 KST"]


def test_claude_requests_ask_litellm_for_cache_breakpoints(make_api, h, clock) -> None:
    wire = Wire()
    claude = h.group("claude-sonnet-5-5", ["anthropic"], supports_function_calling=True)
    api = make(make_api, h, wire, items=[*h.fixture_items(), claude], bootstrap_models=("claude-sonnet-5-5", "fake-chat-small"))
    api.chat("hello", model="claude-sonnet-5-5")
    api.chat("hello", model="fake-chat-small", thread="t2")
    claude_body, gpt_body = wire.sent
    # LiteLLM 1.106.2: cache_control_injection_points (LITELLM_ONLY_PARAMS = provider 로는 안 간다) → system · 마지막 메시지에 cache_control
    assert claude_body["cache_control_injection_points"] == [{"location": "message", "role": "system"}, {"location": "message", "index": -1}]
    assert "cache_control_injection_points" not in gpt_body and "drop_params" not in claude_body


# ── 결과 줄이기 (단위) ───────────────────────────────────────────────────────────


def test_compact_result_keeps_head_and_untrusted_marker() -> None:
    small = {"source": "notes", "untrusted": True, "result": "짧다"}
    assert compact_result(small) is small
    big = {"source": "exa", "untrusted": True, "result": "Title: 푸들\nURL: https://x.example\n" + "본문 " * 3000, "truncated": True}
    out = compact_result(big)
    assert out["source"] == "exa" and out["untrusted"] is True and out["result"].startswith("Title: 푸들")
    assert out["note"].startswith("줄임:") and len(json.dumps(out, ensure_ascii=False).encode()) <= HISTORY_RESULT_BYTES + 200
    assert compact_result("가" * 5000)["result"].endswith("…")


def test_search_records_keep_every_record_under_the_cap() -> None:
    text = "\n\n---\n\n".join(f"Title: 결과 {i}\nURL: https://s{i}.example/p\nPublished: N/A\nAuthor: N/A\nHighlights:\n" + "긴 본문 " * 900
                              for i in range(10))
    out = cap_result(text)
    assert len(json.dumps(out, ensure_ascii=False).encode()) <= MAX_RESULT_BYTES
    assert out["result"].count("Title: ") == 10 and "https://s9.example/p" in out["result"] and out["note"] == "결과 10개, 긴 본문은 앞부분만"
    assert "N/A" not in out["result"]  # 빈 머리 줄은 뺀다
    plain = cap_result("그냥 긴 글 " * 3000)  # 기록 모양이 아니면 예전처럼 앞에서 자른다
    assert plain["truncated"] and "omitted_bytes" in plain


def test_old_search_tools_return_is_never_compacted() -> None:
    """예전 기록의 search_tools 결과 (ToolSearchReturnPart) 가 600B 를 넘어도 줄이지 않는다 — discovered_tools 가 사라지면
    revealed_order 가 KeyError 로 그 대화의 모든 턴을 깬다."""
    from pydantic_ai._tool_search import ToolSearchReturnPart
    from pydantic_ai.messages import ModelMessagesTypeAdapter, ModelRequest, ModelResponse, TextPart, ToolCallPart, UserPromptPart

    from conductor.agent import ready_history, revealed_order

    names = [f"very_long_server_handle_{i}__a_very_long_tool_name_for_searching_things" for i in range(8)]
    found = ToolSearchReturnPart(content={"discovered_tools": [{"name": n} for n in names]}, tool_call_id="s1")
    old = [ModelRequest(parts=[UserPromptPart("찾아줘")]), ModelResponse(parts=[ToolCallPart("search_tools", {"q": "x"}, "s1")]),
           ModelRequest(parts=[found]), ModelResponse(parts=[TextPart("네")])]
    assert len(json.dumps(found.content).encode()) > HISTORY_RESULT_BYTES
    history = ready_history([ModelMessagesTypeAdapter.dump_json(old).decode()], resume=False)
    assert revealed_order(history) == names
    broken = ToolSearchReturnPart(content={"result": "…", "note": "줄임"}, tool_call_id="s1")  # type: ignore[typeddict-item]
    assert revealed_order([ModelRequest(parts=[broken])]) == []  # 모양이 틀린 옛 결과도 깨지지 않는다


def test_search_records_preamble_is_a_header_not_a_record() -> None:
    text = "Search results for 푸들\n" + "\n".join(f"Title: 결과 {i}\nURL: https://s{i}.example/p\n" + "본문 " * 1400 for i in range(3))
    out = cap_result(text)
    assert out["note"] == "결과 3개, 긴 본문은 앞부분만" and len(json.dumps(out, ensure_ascii=False).encode()) <= MAX_RESULT_BYTES
    assert out["result"].startswith("Search results for 푸들\n---\nTitle: 결과 0") and out["result"].count("Title: ") == 3


# ── slice 06 팀: 게이트가 꺼진 길은 그대로 · 켜진 턴은 delegate 정의만 더 (상한 = docs/slices/06-agent-team.md '토큰 전략') ──────────

TEAM_TOOL_EXTRA = 100  # 팀 턴 첫 요청 − 같은 질문 게이트 꺼짐 (delegate 정의 하나 · 지금 96)
MEMBER_FIRST_0 = 250  # 팀원 첫 요청 (고정 task 40자 · 앱 0개)
MEMBER_FIRST_54 = 450  # 팀원 첫 요청 (앱 54개 = ready 18개만 목록 · use_app 하나)
TEAM_TURN_TOTAL = 4500  # 팀원 2명 팀 턴의 모든 요청 합 (MCP 없음)
TEAM_ASK = "노트북 3종 비교표 여럿이 나눠서 조사해 줘"
MEMBER_TASK = "노트북 세 종류의 가격을 찾아서 표로 정리한다. 모델명과 출시가, 할인가를 적는다."[:40]


def _load(name: str) -> Any:
    import importlib.util
    import sys
    from pathlib import Path

    spec = importlib.util.spec_from_file_location(f"brewai_{name}", Path(__file__).parent / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def is_member(body: dict[str, Any]) -> bool:
    from conductor.team import MEMBER_INSTRUCTIONS

    return body["messages"][0]["content"].startswith(MEMBER_INSTRUCTIONS)


def team_plan(answer_bytes: int = 0, task: str = MEMBER_TASK) -> Any:
    """총괄: delegate 가 보이면 한 응답에 2번 → 결과를 받으면 글. 팀원: 글 하나 (answer_bytes = 결과 크기 · 줄임 확인용)."""
    def plan(body: dict[str, Any], n: int) -> tuple[str, Any]:
        if is_member(body):
            role = body["messages"][-1]["content"][:6]
            return ("text", f"{role} 결과: " + "사실 " * (answer_bytes // 7))
        names = [t["function"]["name"] for t in body.get("tools", [])]
        if "delegate" in names and not user_turn_tool_msgs(body, current=True) and body["messages"][-1]["content"] == TEAM_ASK:
            return ("tools", [("delegate", {"role": "가격 조사", "task": task}), ("delegate", {"role": "사양 조사", "task": task})])
        return ("text", "정리했어요")
    return plan


def test_pre_team_golden_requests_and_events_unchanged(make_api, h, fake_mcp, clock) -> None:
    """게이트가 꺼진 실행 = slice 06 전 코드로 찍은 골든과 같다: 게이트웨이 요청 본문(바이트) · SSE 이벤트 순서 · 값 · 기록 · 단계.
    다른 점은 brewai.run 의 team: false 하나 (더하기만)."""
    g = _load("golden_hello")
    got = g.scenarios(make, make_api, h, fake_mcp, clock, Wire, user_turn_tool_msgs)
    want = json.loads(g.GOLDEN.read_text(encoding="utf-8"))
    for case in got.values():
        for events in case["events"]:
            run = next(e for e in events if e.get("name") == "brewai.run")
            assert run["value"].pop("team") is False
    assert [json.dumps(c["requests"], ensure_ascii=False) for c in got.values()] == [json.dumps(c["requests"], ensure_ascii=False) for c in want.values()]
    for case in (*got.values(), *want.values()):
        case["events"] = [g.canon(events) for events in case["events"]]
    assert got == want


def test_team_turn_adds_only_the_delegate_definition(make_api, h, clock, monkeypatch: pytest.MonkeyPatch) -> None:
    from conductor import agent as agent_mod

    wire = Wire(team_plan())
    api = make(make_api, h, wire)
    events = api.chat(TEAM_ASK, thread="team")
    main = [b for b in wire.sent if not is_member(b)]
    members = [b for b in wire.sent if is_member(b)]
    assert len(main) == 2 and len(members) == 2
    first = main[0]
    assert [t["function"]["name"] for t in first["tools"]] == ["use_skill", "delegate"]  # 고정 앞부분 = use_skill 뒤 (공개 도구는 계속 맨 뒤)
    assert next(e for e in events if e.get("name") == "brewai.run")["value"]["team"] is True

    off = Wire(team_plan())
    monkeypatch.setattr(agent_mod.tm, "offer_team", lambda *a, **k: False)
    api_off = make(make_api, h, off)
    api_off.chat(TEAM_ASK, thread="team")
    base = off.sent[0]
    extra = est(first) - est(base)
    assert 0 < extra <= TEAM_TOOL_EXTRA, extra
    # 다른 곳은 바이트까지 같다: 지침(system) · 메시지 · 설정 · 도구 순서 (delegate 만 빠진 것)
    assert {**first, "tools": [t for t in first["tools"] if t["function"]["name"] != "delegate"], "user": "u"} == {**base, "user": "u"}
    assert [m for m in first["messages"] if m["role"] == "system"] == [m for m in base["messages"] if m["role"] == "system"]
    # 한 턴 앞부분 규칙: 앞 요청 = 다음 요청의 앞부분 · 도구 배열 그대로
    assert main[1]["tools"] == first["tools"] and main[1]["messages"][: len(first["messages"])] == first["messages"]


def test_member_first_request_is_small(make_api, h, clock) -> None:
    wire = Wire(team_plan())
    api = make(make_api, h, wire)
    api.chat(TEAM_ASK, thread="m0")
    member = next(b for b in wire.sent if is_member(b))
    assert len(MEMBER_TASK) == 40
    assert est(member) <= MEMBER_FIRST_0, est(member)
    # system 1개 (고정 한 줄) + user = task 만 (대화 기록 · now_line 없음) · 도구 0 (앱 없음 = 글만) · 추론 끔 · max_tokens
    assert [m["role"] for m in member["messages"]] == ["system", "user"] and member["messages"][1]["content"] == MEMBER_TASK
    assert "tools" not in member and "reasoning_effort" not in member and member["max_completion_tokens"] == 1500
    assert member["user"] == api.me["id"]

    wire54 = Wire(team_plan())
    api54 = make(make_api, h, wire54)
    cat = api54.app.state.connectors.catalog
    for i in range(54):
        cat.add_server(name=f"Preset {i:02d}", url=f"https://p{i}.preset.test/mcp", origin="admin", owner_user_id=None,
                       description=f"설명이 아주 긴 앱 {i} " * 4, auth="none" if i < 18 else "oauth")
    api54.chat(TEAM_ASK, thread="m54")
    first = wire54.sent[0]
    assert [t["function"]["name"] for t in first["tools"]] == ["use_skill", "delegate", "use_app"]
    member54 = next(b for b in wire54.sent if is_member(b))
    assert est(member54) <= MEMBER_FIRST_54, est(member54)
    assert [t["function"]["name"] for t in member54["tools"]] == ["use_app"]  # use_skill · delegate 없음 (깊이 1)
    line = member54["messages"][1]["content"]
    assert line.startswith("앱 (use_app") and line.endswith("preset_17") and "로그인 필요" not in line  # ready 앱만 (로그인 필요 36개는 목록에도 없다)


def test_team_turn_total_and_sticky_hello_after_it(make_api, h, fake_mcp, clock) -> None:
    wire = Wire(team_plan(answer_bytes=3000))
    api = make(make_api, h, wire, fake_mcp)
    api.client.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp", "name": "Notes"})
    api.chat(TEAM_ASK, thread="ts")
    turn = list(wire.sent)
    total = sum(est(b) for b in turn)
    assert len(turn) == 4 and total <= TEAM_TURN_TOTAL, total
    fixed = [t["function"]["name"] for t in turn[0]["tools"]]
    assert fixed == ["use_skill", "delegate", "use_app"]

    clock["t"] += timedelta(minutes=5)
    api.chat("hello", thread="ts")
    body = wire.sent[-1]
    assert est(body) <= HELLO_AFTER_BIG_RESULTS, est(body)
    assert [t["function"]["name"] for t in body["tools"]][:3] == fixed and body["tools"][:3] == turn[0]["tools"][:3]  # sticky = 배열 고정
    old = [json.loads(m["content"]) for m in user_turn_tool_msgs(body, current=False)]
    assert len(old) == 2 and all("줄임" in o["note"] and o["untrusted"] is True and o["source"].startswith("team:a") for o in old)
    # 새 대화 hello = 게이트 꺼짐 = delegate 없음
    api.chat("hello", thread="fresh")
    assert [t["function"]["name"] for t in wire.sent[-1]["tools"]] == ["use_skill", "use_app"]


def test_claude_member_gets_cache_points_and_no_thinking(make_api, h, clock) -> None:
    wire = Wire(team_plan())
    claude = h.group("claude-sonnet-5-5", ["anthropic"], supports_function_calling=True, supports_reasoning=True)
    api = make(make_api, h, wire, items=[*h.fixture_items(), claude], bootstrap_models=("claude-sonnet-5-5", "fake-chat-small"))
    api.chat(TEAM_ASK, model="claude-sonnet-5-5", reasoning="high", thread="tc")
    main = [b for b in wire.sent if not is_member(b)]
    members = [b for b in wire.sent if is_member(b)]
    assert len(members) == 2 and main[0]["reasoning_effort"] == "high"  # 총괄은 생각 그대로
    for b in members:  # 팀원 = 같은 모델 · 생각 끔 · 캐시 표시 (팀원 a2 가 a1 이 쓴 앞부분을 읽는다)
        assert b["model"] == "claude-sonnet-5-5" and "reasoning_effort" not in b
        assert b["cache_control_injection_points"] == main[0]["cache_control_injection_points"]
    assert members[0]["messages"][0] == members[1]["messages"][0]  # 같은 지침 한 줄 = 같은 앞부분


def test_gated_turn_without_delegate_keeps_the_tool_array_for_the_thread(make_api, h, clock) -> None:
    """게이트가 켜졌는데 모델이 혼자 답한 턴 (p4-team-skip) 다음 hello = 같은 도구 배열 (보인 적이 있으면 sticky = 캐시 앞부분 그대로)."""
    wire = Wire(lambda body, n: ("text", "혼자 답했어요"))
    api = make(make_api, h, wire)
    api.chat("아이폰과 갤럭시 비교해서 정리해 줘", thread="skip")
    gated = wire.sent[-1]
    assert [t["function"]["name"] for t in gated["tools"]] == ["use_skill", "delegate"]
    clock["t"] += timedelta(minutes=5)
    api.chat("고마워", thread="skip")
    after = wire.sent[-1]
    assert after["tools"][:3] == gated["tools"][:3]
    api.chat("고마워", thread="other")  # 다른 대화 = 게이트 꺼짐 그대로
    assert [t["function"]["name"] for t in wire.sent[-1]["tools"]] == ["use_skill"]


def json_events(text: str) -> list[dict[str, Any]]:
    return [json.loads(line.removeprefix("data: ")) for line in text.split("\n\n") if line.startswith("data: ")]


def test_resume_in_a_sticky_thread_keeps_the_paused_tool_array(make_api, h, fake_mcp, clock) -> None:
    """팀을 쓴 대화에서 연결 대기로 멈춘 실행 → 연결 → 이어서 하기 요청의 도구 배열 = 멈춘 요청과 같다 (delegate 포함 · 한 턴 앞부분 규칙)."""
    from conductor.connectors.vault import generate_key as key

    mc = _load("test_mcp_chat")
    team = team_plan()

    def plan(body: dict[str, Any], n: int) -> tuple[str, Any]:
        last = [m for m in body["messages"] if m["role"] == "user"][-1]["content"]
        if is_member(body) or last == TEAM_ASK:
            return team(body, n)
        cur = user_turn_tool_msgs(body, current=True)
        if not cur:
            return ("tools", [("use_app", {"app": "tracker", "need": "이슈 검색"})])
        return ("text", "찾았어요")

    wire = Wire(plan)
    fake = fake_mcp.Fake()
    api = make_api(None, openai_client=wire.client(), skills=load_skills(h.SKILLS_DIR), secret_key=key(), app_kw={"mcp_transport": fake.transport})
    tracker = mc.add_tracker(api, fake_mcp)
    api.chat(TEAM_ASK, thread="tr")
    clock["t"] += timedelta(minutes=5)
    events = api.chat("이슈 찾아줘", thread="tr", run="run-p")
    paused = wire.sent[-1]
    pending = next(e for e in events if e.get("name") == "brewai.run_summary")["value"]["pending"]
    assert [t["function"]["name"] for t in paused["tools"]][:3] == ["use_skill", "delegate", "use_app"] and pending
    mc.connect(api, fake, api.client, tracker)
    resume = {"threadId": "tr", "runId": "run-r", "state": {}, "messages": [], "tools": [], "context": [],
              "forwardedProps": {"resume": {"call_id": pending[0]["call_id"]}}}
    res = api.client.post("/api/chat", json=resume)
    assert res.status_code == 200, res.text
    resumed = wire.sent[-1]
    assert resumed is not paused and resumed["tools"][: len(paused["tools"])] == paused["tools"]  # 공개 도구만 맨 뒤에 더
    assert mc.custom(json_events(res.text), "brewai.run")[0]["team"] is True
