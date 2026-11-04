"""대화에서 에이전트 팀 (agent.py _TeamTools · _TeamRun ↔ team.py · slice 06) — FunctionModel · 가짜 MCP (tests/fake_mcp.py).

팀원 요청 = 지침이 MEMBER_INSTRUCTIONS 로 시작 (모델 함수가 총괄 · 팀원을 가른다). 요청 바이트 · 상한은 test_tokens.py.
delegate 2개 겹쳐 실행 · 이벤트 순서 · steps parent · 사용량 합 · 다시 열기 · 1명 / 4번째 = 오류 결과 · 팀원 한도 · 실패 격리 · 끊김 ·
연결 안 된 앱 = 대기 없음 · untrusted 가 줄인 뒤에도 · 3명 × 병렬 2 교착 없음 · 공개 장부 분리 · 쓰기 도구 없음 · 비밀 0 · span.
"""

from __future__ import annotations

import asyncio
import gc
import importlib.util
import inspect
import json
import sys
from collections.abc import AsyncIterator, Callable
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest
from pydantic_ai.messages import ModelMessage, ModelRequest, ToolReturnPart, UserPromptPart
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel

from conductor import agent as agent_mod
from conductor import team as tm
from conductor.connectors.vault import generate_key

ASK = "노트북 3종 비교표 여럿이 나눠서 조사해 줘"  # 게이트가 켜지는 질문 (데모 질문)
TWO = [("delegate", {"role": "가격 조사", "task": "가격 찾기"}), ("delegate", {"role": "사양 조사", "task": "사양 찾기"})]


def _load(name: str) -> Any:
    spec = importlib.util.spec_from_file_location(f"brewai_team_{name}", Path(__file__).parent / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class Team:
    """FunctionModel 하나 = 총괄 · 팀원 둘 다. main(messages, info, n) · member(task, messages, info, n) → 글 | [(도구, 인자) …]
    (await 해도 된다). 요청마다 {kind, tools, instructions, messages} 를 남긴다."""

    def __init__(self, main: Callable[..., Any], member: Callable[..., Any] | None = None) -> None:
        self.main = main
        self.member = member or (lambda task, m, i, n: f"{task} 결과")
        self.requests: list[dict[str, Any]] = []

    def model(self, _: str) -> FunctionModel:
        async def stream(messages: list[ModelMessage], info: AgentInfo) -> AsyncIterator[Any]:
            member = (info.instructions or "").startswith(tm.MEMBER_INSTRUCTIONS)
            self.requests.append({"kind": "member" if member else "main", "tools": [t.name for t in info.function_tools],
                                  "instructions": info.instructions or "", "messages": messages})
            n = len(self.requests)
            if member:
                task = next(p.content for m in messages if isinstance(m, ModelRequest) for p in m.parts if isinstance(p, UserPromptPart))
                act = self.member(task, messages, info, n)
            else:
                act = self.main(messages, info, n)
            if inspect.isawaitable(act):
                act = await act
            if isinstance(act, str):
                yield act
                return
            for i, (name, args) in enumerate(act):
                yield {i: DeltaToolCall(name=name, json_args=json.dumps(args, ensure_ascii=False), tool_call_id=f"c{n}_{i}")}

        return FunctionModel(stream_function=stream)

    def of(self, kind: str) -> list[dict[str, Any]]:
        return [r for r in self.requests if r["kind"] == kind]


def returns(messages: list[ModelMessage]) -> list[ToolReturnPart]:
    """이번 질문 뒤의 툴 결과."""
    out: list[ToolReturnPart] = []
    for m in messages:
        if isinstance(m, ModelRequest):
            if any(isinstance(p, UserPromptPart) for p in m.parts):
                out = []
            out += [p for p in m.parts if isinstance(p, ToolReturnPart)]
    return out


def asked(messages: list[ModelMessage]) -> str:
    return [p.content for m in messages if isinstance(m, ModelRequest) for p in m.parts if isinstance(p, UserPromptPart)][-1]


def two_then_text(messages: list[ModelMessage], info: AgentInfo, n: int) -> Any:
    """ASK 면 한 응답에 delegate 2번 → 결과로 글. 다른 질문 = 글 (sticky 로 delegate 가 보여도 안 부른다)."""
    rs = returns(messages)
    if not rs and asked(messages) == ASK and "delegate" in [t.name for t in info.function_tools]:
        return TWO
    return "정리: " + " / ".join(str(r.content.get("answer", r.content.get("error"))) for r in rs if isinstance(r.content, dict))


def world(make_api, fake_mcp, team: Team, **kw: Any):  # noqa: ANN001, ANN201
    fake = fake_mcp.Fake()
    api = make_api(team.model, secret_key=generate_key(), app_kw={"mcp_transport": fake.transport}, **kw)
    return api, fake


def add_notes(api, fake_mcp) -> None:  # noqa: ANN001
    res = api.client.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp", "name": "Notes"})
    assert res.status_code in (200, 201), res.text


def custom(events: list[dict], name: str) -> list[dict]:
    return [e["value"] for e in events if e["type"] == "CUSTOM" and e["name"] == name]


def summary(events: list[dict]) -> dict[str, Any]:
    return custom(events, "brewai.run_summary")[0]


def at(events: list[dict], pred: Callable[[dict], bool]) -> int:
    return next(i for i, e in enumerate(events) if pred(e))


# ── 팀 한 바퀴 ────────────────────────────────────────────────────────────────────


def test_two_members_overlap_and_events_are_ordered(make_api, fake_mcp) -> None:
    started: list[str] = []
    both = asyncio.Event()

    async def member(task: str, m: Any, i: Any, n: int) -> str:
        started.append(task)
        if len(started) == 2:
            both.set()
        await asyncio.wait_for(both.wait(), 2)  # 둘 다 돌기 시작해야 넘어간다 = 겹쳐 실행
        return f"{task} 결과"

    team = Team(two_then_text, member)
    api, _ = world(make_api, fake_mcp, team)
    events = api.chat(ASK, thread="tt")
    assert sorted(started) == ["가격 찾기", "사양 찾기"]
    assert custom(events, "brewai.run")[0]["team"] is True
    steps = [e["stepName"] for e in events if e["type"] == "STEP_STARTED"]
    assert steps == ["agent:a1", "agent:a2", "writing"]
    for call, agent in (("c1_0", "a1"), ("c1_1", "a2")):
        step = at(events, lambda e: e["type"] == "STEP_STARTED" and e["stepName"] == f"agent:{agent}")
        start = at(events, lambda e: e["type"] == "TOOL_CALL_START" and e["toolCallId"] == call)
        end = at(events, lambda e: e["type"] == "TOOL_CALL_END" and e["toolCallId"] == call)
        result = at(events, lambda e: e["type"] == "TOOL_CALL_RESULT" and e["toolCallId"] == call)
        done = at(events, lambda e: e["type"] == "STEP_FINISHED" and e["stepName"] == f"agent:{agent}")
        mine = [i for i, e in enumerate(events) if e["type"] == "CUSTOM" and e["name"] == "brewai.team_member" and e["value"]["call_id"] == call]
        assert step < start < end < mine[0] and mine[-1] < result < done  # 팀원 이벤트 = 그 delegate 의 END 뒤 · RESULT 앞
        vals = [events[i]["value"] for i in mine]
        assert [v["status"] for v in vals] == ["running", "done"] and vals[0]["agent"] == agent and vals[0]["tools"] == []
        assert vals[-1]["usage"] == {"requests": 1, "input_tokens": vals[-1]["usage"]["input_tokens"], "output_tokens": vals[-1]["usage"]["output_tokens"], "tool_calls": 0}
        assert vals[0]["model_label"] and "ms" in vals[-1]
    roles = {v["agent"]: v["role"] for v in custom(events, "brewai.team_member")}
    assert roles == {"a1": "가격 조사", "a2": "사양 조사"}
    answer = "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")
    assert answer == "정리: 가격 찾기 결과 / 사양 찾기 결과"
    # 팀원 요청 = 지침 한 줄 + task 만 · 도구 0 (앱 없음) · delegate · use_skill 없음
    members = team.of("member")
    assert len(members) == 2 and all(r["tools"] == [] and r["instructions"] == tm.MEMBER_INSTRUCTIONS for r in members)
    assert all(len(r["messages"]) == 1 and len(r["messages"][0].parts) == 1 for r in members)
    # 총괄이 받은 결과 = untrusted 맨 앞 · source team:a1
    got = [r.content for r in returns(team.of("main")[-1]["messages"])]
    assert [list(g)[:2] for g in got] == [["untrusted", "source"]] * 2 and [g["source"] for g in got] == ["team:a1", "team:a2"]
    # 사용량 = 총괄 2 + 팀원 2 · usage_events 한 줄
    s = summary(events)
    assert s["usage"]["requests"] == 4 and s["usage"]["tool_calls"] == 2
    assert [(r["agent"], r["role"], r["requests"]) for r in s["usage"]["members"]] == [("a1", "가격 조사", 1), ("a2", "사양 조사", 1)]
    rows = api.store.query("SELECT requests, tool_calls, status FROM usage_events")
    assert [(r["requests"], r["tool_calls"], r["status"]) for r in rows] == [(4, 2, "ok")]
    run = api.client.get("/api/runs").json()[0]
    assert [(s["name"], s["label"], s["status"]) for s in run["steps"]] == [
        ("agent:a1", "가격 조사", "done"), ("agent:a2", "사양 조사", "done"), ("writing", "답 쓰기", "done")]
    # 다시 열기 = 같은 팀원 칸 (기록의 ToolReturn.metadata)
    parts = api.client.get("/api/threads/tt").json()["messages"][1]["parts"]
    cards = [p for p in parts if p["type"] == "tool"]
    assert [(c["name"], c["agent"], c["role"], c["label"], c["status"], c["task"]) for c in cards] == [
        ("delegate", "a1", "가격 조사", "가격 조사", "done", "가격 찾기"), ("delegate", "a2", "사양 조사", "사양 조사", "done", "사양 찾기")]
    assert cards[0]["usage"]["requests"] == 1 and cards[0]["tools"] == [] and cards[0]["steps"] == [] and cards[0]["model_label"]


def test_member_tool_rows_have_parent_and_reopen_as_the_same_tree(make_api, fake_mcp) -> None:
    def member(task: str, messages: Any, info: AgentInfo, n: int) -> Any:
        rs = returns(messages)
        if not rs:
            return [("use_app", {"app": "notes", "need": "메아리"})]
        if len(rs) == 1:
            assert "notes__echo" in [t.name for t in info.function_tools]
            return [("notes__echo", {"text": task})]
        return f"{rs[-1].content['result']} 확인 " + "자료 " * 300  # 600B 넘는 답 = 다음 턴에 줄인다

    team = Team(two_then_text, member)
    api, _ = world(make_api, fake_mcp, team)
    add_notes(api, fake_mcp)
    events = api.chat(ASK, thread="tr")
    # 팀원의 도구 호출은 AG-UI 툴 이벤트로 새지 않는다 (CUSTOM brewai.agent_step 만)
    assert [e["stepName"] for e in events if e["type"] == "STEP_STARTED"] == ["agent:a1", "agent:a2", "writing"]
    assert {e["toolCallId"] for e in events if e["type"] == "TOOL_CALL_START"} == {"c1_0", "c1_1"}
    rows = custom(events, "brewai.agent_step")
    assert {(r["agent"], r["name"], r["status"]) for r in rows} == {
        (a, n, s) for a in ("a1", "a2") for n in ("app:notes", "tool:notes__echo") for s in ("running", "done")}
    parent = {"a1": "c1_0", "a2": "c1_1"}
    assert all(r["parent"] == parent[r["agent"]] and r["call_id"].startswith(f"{r['agent']}:") and r["app"] == "notes" for r in rows)
    for r in rows:  # 팀원 도구 줄 = 그 delegate 의 END 뒤 · RESULT 앞
        i = at(events, lambda e: e["type"] == "CUSTOM" and e["name"] == "brewai.agent_step" and e["value"] == r)
        assert at(events, lambda e: e["type"] == "TOOL_CALL_END" and e["toolCallId"] == r["parent"]) < i
        assert i < at(events, lambda e: e["type"] == "TOOL_CALL_RESULT" and e["toolCallId"] == r["parent"])
    end = [v for v in custom(events, "brewai.team_member") if v["status"] == "done"]
    assert all(v["tools"][0]["name"] == "use_app" and "notes__echo" in [t["name"] for t in v["tools"]]
               and all(t["app"] == "notes" for t in v["tools"][1:]) for v in end)  # 받은 도구 = use_app + 공개된 읽기 도구
    assert all(v["usage"]["tool_calls"] == 2 and v["usage"]["requests"] == 3 for v in end)
    # runs.steps = 평평한 목록 + 자식 줄 {parent, agent} (자식 줄은 batch 를 안 늘린다)
    steps = api.client.get("/api/runs").json()[0]["steps"]
    kids = [s for s in steps if "parent" in s]
    assert len(kids) == 4 and all(s["status"] == "done" and s["duration_ms"] is not None for s in kids)
    assert [s.get("batch") for s in steps if s["name"].startswith("agent:")] == [1, 1]
    # 다시 열기: 팀원 칸의 steps = 실시간 줄과 같다
    parts = [p for p in api.client.get("/api/threads/tr").json()["messages"][1]["parts"] if p["type"] == "tool"]
    for p in parts:
        assert [(s["call_id"], s["name"], s["status"]) for s in p["steps"]] == [
            (s["call_id"], s["name"], s["status"]) for s in kids if s["parent"] == p["id"]]
    # 팀원 공개가 총괄 도구 배열에 안 섞인다 · 사용량 = 총괄 2 + 팀원 3 × 2
    main = team.of("main")
    assert all(not any(n.startswith("notes__") for n in r["tools"]) for r in main) and main[0]["tools"] == ["delegate", "use_app"]
    assert summary(events)["usage"]["requests"] == 8 and summary(events)["usage"]["tool_calls"] == 2 + 4
    # 다음 턴: 팀원 결과(600B 넘음) = 앞부분 + '줄임' · untrusted 는 그대로 · delegate 는 계속 보인다 (sticky)
    api.chat("고마워", thread="tr")
    last = team.of("main")[-1]
    assert last["tools"][:2] == ["delegate", "use_app"]
    old = [p.content for m in last["messages"] if isinstance(m, ModelRequest) for p in m.parts
           if isinstance(p, ToolReturnPart) and p.tool_name == "delegate"]
    assert len(old) == 2 and all(o["untrusted"] is True and o["source"].startswith("team:") and "줄임" in o["note"] for o in old)


def test_lone_delegate_and_fourth_member_get_error_results(make_api, fake_mcp) -> None:
    def main(messages: list[ModelMessage], info: AgentInfo, n: int) -> Any:
        rs = returns(messages)
        if not rs:
            return [("delegate", {"role": "혼자", "task": "하나"})]
        if len(rs) == 1:
            return [("delegate", {"role": f"역할{k}", "task": f"일{k}"}) for k in range(4)]
        return "끝"

    team = Team(main)
    api, _ = world(make_api, fake_mcp, team)
    events = api.chat(ASK, thread="tf")
    first = returns(team.of("main")[1]["messages"])[0].content
    assert first["error"] == "team_too_small" and "2명 이상" in first["message"]
    second = [r.content for r in returns(team.of("main")[2]["messages"])[1:]]
    assert [c.get("status") for c in second[:3]] == ["done"] * 3 and second[3]["error"] == "team_full"
    assert len(team.of("member")) == 3  # 거절된 delegate 는 팀원을 만들지 않는다
    run = api.client.get("/api/runs").json()[0]
    assert run["status"] == "done"
    assert [(s["name"], s["status"]) for s in run["steps"] if s["name"].startswith("agent:")] == [
        ("agent:a1", "error"), ("agent:a2", "done"), ("agent:a3", "done"), ("agent:a4", "done"), ("agent:a5", "error")]
    ends = {v["agent"]: v for v in custom(events, "brewai.team_member") if v["status"] in ("done", "error")}
    assert ends["a1"]["code"] == "team_too_small" and ends["a5"]["code"] == "team_full"
    assert [r["agent"] for r in summary(events)["usage"]["members"]] == ["a2", "a3", "a4"]


def test_member_limit_wraps_up_with_what_it_found_and_failure_stays_inside(make_api, fake_mcp) -> None:
    """요청 한도 = 버리지 않고 받은 자료로 도구 없이 한 번 더 (보고 · 총괄 결과에 note) · 다른 팀원 실패는 그 팀원만."""
    wrap: list[dict[str, Any]] = []

    def member(task: str, messages: Any, info: AgentInfo, n: int) -> Any:
        if task.startswith("가격 찾기") and tm.WRAP_UP_PROMPT in task:  # 마무리 요청 = 도구 없음 · 자료가 프롬프트에
            wrap.append({"tools": [t.name for t in info.function_tools], "task": task})
            return "가격 일부: 메아리"
        if task == "가격 찾기":  # 끝없이 도구 = 요청 한도
            return [("use_app", {"app": "notes", "need": "메아리"})] if not returns(messages) else [("notes__echo", {"text": "또"})]
        raise RuntimeError("provider said sk-live-SECRET-123")  # 원문은 결과 · 이벤트 · 기록에 안 간다

    team = Team(two_then_text, member)
    api, _ = world(make_api, fake_mcp, team)
    add_notes(api, fake_mcp)
    events = api.chat(ASK, thread="tl")
    ends = {v["agent"]: v for v in custom(events, "brewai.team_member") if v["status"] != "running"}
    assert (ends["a1"]["status"], ends["a1"].get("code"), ends["a1"]["usage"]["requests"]) == ("done", None, tm.MEMBER_REQUEST_LIMIT + 1)
    assert wrap[0]["tools"] == [] and "<자료 untrusted>" in wrap[0]["task"] and len(wrap[0]["task"]) < tm.WRAP_UP_CHARS + 500
    assert (ends["a2"]["status"], ends["a2"]["code"]) == ("error", "member_model_error")
    first = returns(team.of("main")[-1]["messages"])[0].content
    assert first["answer"] == "가격 일부: 메아리" and "요청 한도" in first["note"]
    run = api.client.get("/api/runs").json()[0]
    assert run["status"] == "done" and [s["status"] for s in run["steps"] if s["name"].startswith("agent:")] == ["done", "error"]
    assert "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT").startswith("정리: 가격 일부: 메아리 / member_model_error")
    dump = json.dumps(events, ensure_ascii=False) + "\n".join(api.store._db.iterdump())
    assert "SECRET" not in dump
    assert summary(events)["usage"]["requests"] == 2 + tm.MEMBER_REQUEST_LIMIT + 1  # 실패한 요청은 응답이 없어 안 센다 · 마무리 1


def test_member_limit_without_material_is_still_member_limit(make_api, fake_mcp) -> None:
    def member(task: str, messages: Any, info: AgentInfo, n: int) -> Any:
        return [("use_app", {"app": "nope", "need": "x"})]  # 결과가 오류뿐 = ToolReturn 은 있다 → 마무리 자료가 있다

    team = Team(two_then_text, member)
    api, _ = world(make_api, fake_mcp, team)
    events = api.chat(ASK, thread="tn")
    ends = {v["agent"]: v for v in custom(events, "brewai.team_member") if v["status"] != "running"}
    assert all(e["status"] in ("done", "error") for e in ends.values())


def test_not_connected_app_is_a_result_not_a_pause(make_api, fake_mcp) -> None:
    tracker = _load("test_mcp_chat").add_tracker

    def member(task: str, messages: Any, info: AgentInfo, n: int) -> Any:
        rs = returns(messages)
        if not rs:
            return [("use_app", {"app": "tracker", "need": "이슈 검색"})]
        return f"연결 필요: {rs[0].content['error']}"

    team = Team(two_then_text, member)
    api, _ = world(make_api, fake_mcp, team)
    add_notes(api, fake_mcp)
    tracker(api, fake_mcp)  # OAuth 앱 · 연결 안 함 = ready 아님 (팀원 목록에 없다)
    events = api.chat(ASK, thread="tn")
    assert custom(events, "brewai.app_auth") == [] and summary(events)["pending"] == []
    got = [r.content for r in returns(team.of("main")[-1]["messages"])]
    assert all(g["status"] == "done" and g["needs_app"] == ["tracker"] for g in got)
    assert all("tracker" not in r["instructions"] for r in team.of("member"))  # 팀원 앱 목록 = ready 앱만
    assert api.store.query("SELECT pending_json FROM runs")[0]["pending_json"] is None


def test_three_members_with_two_parallel_tools_each_do_not_deadlock(make_api, fake_mcp, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tm, "MEMBER_TIMEOUT_S", 5.0)  # 교착이면 시간 초과 = error 로 드러난다

    def main(messages: list[ModelMessage], info: AgentInfo, n: int) -> Any:
        return [("delegate", {"role": f"역할{k}", "task": f"일{k}"}) for k in range(3)] if not returns(messages) else "끝"

    def member(task: str, messages: Any, info: AgentInfo, n: int) -> Any:
        rs = returns(messages)
        if not rs:
            return [("use_app", {"app": "notes", "need": "메아리"})]
        if len(rs) == 1:
            return [("notes__echo", {"text": f"{task} 하나"}), ("notes__echo", {"text": f"{task} 둘"})]
        return "됐다"

    team = Team(main, member)
    api, _ = world(make_api, fake_mcp, team)
    add_notes(api, fake_mcp)
    events = api.chat(ASK, thread="td")
    ends = [v for v in custom(events, "brewai.team_member") if v["status"] != "running"]
    assert [v["status"] for v in ends] == ["done"] * 3
    kids = [s for s in api.client.get("/api/runs").json()[0]["steps"] if "parent" in s]
    assert len(kids) == 9 and all(s["status"] == "done" for s in kids)


def test_member_sees_read_tools_only_and_no_secrets_leak(make_api, fake_mcp, monkeypatch: pytest.MonkeyPatch) -> None:
    mc = _load("test_mcp_chat")

    def member(task: str, messages: Any, info: AgentInfo, n: int) -> Any:
        rs = returns(messages)
        if not rs:
            return [("use_app", {"app": "tracker", "need": "이슈 만들기 create issue 와 검색"})]
        if len(rs) == 1:
            return [("tracker__create_issue", {"team": "x", "title": "y"})]  # 공개 안 된 쓰기 도구 = 부르지 못한다
        return "읽기만 했다"

    team = Team(two_then_text, member)
    api, fake = world(make_api, fake_mcp, team)
    sid = mc.add_tracker(api, fake_mcp)
    mc.connect(api, fake, api.client, sid, account="alice")
    from conductor.connectors import session as app_session

    spans: list[dict[str, Any]] = []
    monkeypatch.setattr(app_session, "_span", lambda **attrs: spans.append(attrs))
    events = api.chat(ASK, thread="tw")
    calls = [s for s in spans if s.get("gen_ai.tool.name") == "use_app"]
    assert len(calls) == 2 and {s["brewai.agent.id"] for s in calls} == {"a1", "a2"}  # MCP span 에 팀원 id
    writes = {n for n, _, _ in fake_mcp.WRITE_TOOLS}
    for r in team.of("member"):
        assert not any(t.split("__", 1)[-1] in writes for t in r["tools"]) and "delegate" not in r["tools"] and "use_skill" not in r["tools"]
    revealed = [t for r in team.of("member") for t in r["tools"] if t.startswith("tracker__")]
    assert revealed and all(t.split("__", 1)[1] not in writes for t in revealed)
    assert not any(name in writes for _, name in fake.calls)  # 쓰기 실행 0
    assert all(not any(t.startswith("tracker__") for t in r["tools"]) for r in team.of("main"))  # 공개 장부 분리
    secrets_seen = [*fake.access, *fake.refresh]
    assert secrets_seen
    dump = json.dumps([*custom(events, "brewai.agent_step"), *custom(events, "brewai.team_member")], ensure_ascii=False)
    sse = json.dumps(events, ensure_ascii=False)
    steps = json.dumps(api.client.get("/api/runs").json(), ensure_ascii=False)
    assert all(s not in dump and s not in sse and s not in steps for s in secrets_seen)


# ── 끊김 · span ──────────────────────────────────────────────────────────────────


def test_disconnect_cancels_members_and_the_gateway_hears_nothing_more(make_api, fake_mcp, h, monkeypatch: pytest.MonkeyPatch) -> None:
    import anyio

    inside: list[str] = []
    both = asyncio.Event()

    async def member(task: str, m: Any, i: Any, n: int) -> str:
        inside.append(task)
        if len(inside) == 2:
            both.set()  # 팀원 둘이 모델 요청 중 → 이때 끊는다
        await asyncio.sleep(30)  # 끊기 전에 끝나지 않는다
        return "늦음"

    team = Team(two_then_text, member)
    api, _ = world(make_api, fake_mcp, team)
    finished: list[str] = []
    real = agent_mod._Activity.finish

    def count(self: Any) -> None:
        if not self.closed:
            finished.append(self.status)
        real(self)

    monkeypatch.setattr(agent_mod._Activity, "finish", count)
    body = json.dumps(h.chat_body(ASK, thread="tc", run="run-cut")).encode()
    headers = [(b"host", b"127.0.0.1"), (b"content-type", b"application/json"), (b"authorization", f"Bearer {api.client.bearer}".encode())]
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "scheme": "http", "path": "/api/chat",
        "raw_path": b"/api/chat", "query_string": b"", "root_path": "", "headers": headers, "client": ("127.0.0.1", 50000),
        "server": ("127.0.0.1", 80),
    }

    async def go() -> tuple[str, int, int, int]:
        sent = False
        out = ""
        before = set(asyncio.all_tasks())

        async def receive() -> dict[str, Any]:
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            await both.wait()
            return {"type": "http.disconnect"}

        async def send(msg: dict[str, Any]) -> None:
            nonlocal out
            if msg["type"] == "http.response.body":
                out += msg.get("body", b"").decode()

        with anyio.fail_after(10):
            await api.app(scope, receive, send)
        cut = len(team.requests)
        await asyncio.sleep(0.3)
        gc.collect()
        await asyncio.sleep(0)
        left = set(asyncio.all_tasks()) - before - {asyncio.current_task()}
        return out, cut, len(team.requests), len(left)

    out, cut, later, left = api.client.portal.call(go)  # type: ignore[union-attr]
    gc.collect()
    events = h.sse_events(out)
    assert not any(e["type"] == "TOOL_CALL_RESULT" for e in events)
    assert cut == later == 3 and left == 0  # 총괄 1 + 팀원 2 · 끊은 뒤 게이트웨이 요청 0 · 남은 태스크 0
    run = api.store.query("SELECT status, error_code, steps FROM runs WHERE id = 'run-cut'")[0]
    assert (run["status"], run["error_code"]) == ("cancelled", "client_disconnected")
    agents = [s for s in json.loads(run["steps"]) if s["name"].startswith("agent:")]
    assert len(agents) == 2 and all(s["status"] == "cancelled" for s in agents)
    assert finished == ["cancelled"]  # finish 정확히 한 번
    assert [r["status"] for r in api.store.query("SELECT status FROM usage_events")] == ["cancelled"]


def test_member_span_has_ids_and_numbers_only(make_api, fake_mcp, monkeypatch: pytest.MonkeyPatch) -> None:
    spans: list[dict[str, Any]] = []

    class Span:
        def __init__(self, attrs: dict[str, Any]) -> None:
            self.attrs = dict(attrs)
            spans.append(self.attrs)

        def set_attribute(self, k: str, v: Any) -> None:
            self.attrs[k] = v

    class Tracer:
        @contextmanager
        def start_as_current_span(self, name: str, attributes: dict[str, Any], **_: Any) -> Any:
            assert name == "brewai.team.member"
            yield Span(attributes)

    class Otel:
        @staticmethod
        def get_tracer(_: str) -> Tracer:
            return Tracer()

    monkeypatch.setattr(agent_mod, "_otel", Otel)
    team = Team(two_then_text)
    api, _ = world(make_api, fake_mcp, team)
    api.chat(ASK, thread="ts")
    assert len(spans) == 2
    for s, agent in zip(spans, ("a1", "a2"), strict=True):
        assert s["brewai.agent.id"] == agent and s["gen_ai.agent.name"] == "member" and s["session.id"] == "ts"
        assert s["user.id"] == api.me["id"] and s["brewai.agent.status"] == "done" and isinstance(s["gen_ai.usage.input_tokens"], int)
    text = json.dumps(spans, ensure_ascii=False)
    assert "가격" not in text and "찾기" not in text  # 역할 · 할 일 · 결과 글은 안 남긴다


def test_hello_in_a_new_thread_never_offers_delegate(make_api, fake_mcp) -> None:
    team = Team(lambda m, i, n: "안녕하세요")
    api, _ = world(make_api, fake_mcp, team)
    events = api.chat("hello", thread="th")
    assert team.requests[0]["tools"] == [] and custom(events, "brewai.run")[0]["team"] is False
    assert not any(e.get("name") in ("brewai.team_member", "brewai.agent_step") for e in events)


def test_bad_delegate_args_close_the_step_as_error(make_api, fake_mcp) -> None:
    def main(messages: list[ModelMessage], info: AgentInfo, n: int) -> Any:
        return [("delegate", {"role": "역할만"}), ("delegate", {"role": "둘째"})] if n == 1 else "끝"  # task 없음 = 인자 검사 실패

    team = Team(main)
    api, _ = world(make_api, fake_mcp, team)
    api.chat(ASK, thread="tb")
    run = api.client.get("/api/runs").json()[0]
    assert run["status"] == "done" and [s["status"] for s in run["steps"] if s["name"].startswith("agent:")] == ["error", "error"]
    assert team.of("member") == []


def test_member_tools_fail_closed_on_unannotated_writes_and_approval_policy(make_api, fake_mcp, monkeypatch: pytest.MonkeyPatch) -> None:
    """주석 없는 trash · forward 같은 이름 (is_write = 표시용 추측이 놓친다) · 관리자가 approval 로 둔 읽기 도구 = 팀원 목록에도 호출에도 없다."""
    from conductor.connectors.client import ToolCache, trim_tool

    banned = ["trash_message", "forward", "mark_thread_spam", "label_message", "search_mail"]

    def member(task: str, messages: Any, info: AgentInfo, n: int) -> Any:
        rs = returns(messages)
        if not rs:
            return [("use_app", {"app": "notes", "need": "메일 trash forward spam label search mail 정리"})]
        if len(rs) == 1:
            return [(f"notes__{name}", {}) for name in [*banned, "list_mail"]]
        return "읽기만 했다"

    team = Team(two_then_text, member)
    api, _ = world(make_api, fake_mcp, team)
    res = api.client.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp", "name": "Notes"})
    assert res.status_code in (200, 201), res.text
    sid = res.json()["id"]
    svc = api.app.state.connectors
    raw = [{"name": n, "description": f"{n} mail"} for n in banned[:-1]]  # 주석 없음
    raw += [{"name": "search_mail", "description": "search mail", "annotations": {"readOnlyHint": True}},
            {"name": "list_mail", "description": "list mail"}]  # list_mail = 읽기 동사 이름 (주석 없어도 된다)
    tools = [t for t in (trim_tool(r) for r in raw) if t is not None]
    assert not any(t.write for t in tools if t.name in banned)  # 표시용 추측은 이 이름들을 쓰기로 못 본다 (그래서 write 로 거르면 샌다)
    svc.cache.put(sid, ToolCache.SHARED, tools)
    svc.catalog.set_tool_policy(sid, "search_mail", mode="approval")  # 사람 확인이 필요한 도구 = 팀원은 못 쓴다
    called: list[str] = []
    real = svc.mcp.call_tool

    async def spy(url: str, tool: str, *a: Any, **k: Any) -> Any:
        called.append(tool)
        return await real(url, tool, *a, **k)

    monkeypatch.setattr(svc.mcp, "call_tool", spy)
    api.chat(ASK, thread="tf")
    members = team.of("member")
    assert members
    offered = {t.split("__", 1)[1] for r in members for t in r["tools"] if t.startswith("notes__")}
    assert offered == {"list_mail"}  # 공개 = 확실한 읽기 도구만
    assert not any(name in banned for name in called) and "list_mail" in called  # 막힌 도구는 서버까지 안 간다
    # 모델이 이름을 지어 불러도: 목록에 없는 도구 = Pydantic AI 가 다시 하라고 돌려보낸다 · 성공한 결과 0
    ok = [r for r in returns(members[-1]["messages"]) if r.tool_name.split("__", 1)[-1] in banned]
    assert ok == []
    # 호출 길도 따로 막힌다 (공개 장부를 거치지 않고 바로 불러도 = unknown_tool · 서버까지 안 간다)
    view = svc.session(api.me["id"]).member_view("a9")
    assert view is not None
    for name in banned:
        got, _ = asyncio.run(view.call(f"notes__{name}", {}))
        assert got == {"error": "unknown_tool", "message": got["message"]}, name
    assert not any(name in banned for name in called)


def test_pump_reads_main_events_only_as_fast_as_the_consumer() -> None:
    """팀 실행의 pump = 총괄 이벤트는 당겨 읽기 그대로 (소비자가 다음을 달라고 해야 다음을 읽는다) · 팀원 이벤트만 끼어든다.
    앞서 가면 같은 응답의 앱 대기(CallDeferred)가 그 툴의 TOOL_CALL_START 보다 먼저 처리돼 waiting 이 사라진다."""
    from types import SimpleNamespace

    pulled: list[int] = []

    async def events() -> AsyncIterator[Any]:
        for i in range(4):
            pulled.append(i)
            yield f"e{i}"

    async def go() -> list[Any]:
        team = SimpleNamespace(queue=asyncio.Queue())
        gen = agent_mod._RunStream._pumped(events(), team)  # type: ignore[arg-type]
        got = [await gen.__anext__()]
        for _ in range(20):  # 소비자가 처리하는 동안 (보내기 대기 등) pump 는 다음 이벤트를 읽지 않는다
            await asyncio.sleep(0)
        assert pulled == [0]
        team.queue.put_nowait(("member", "c1", "m1"))  # 팀원 이벤트는 그 사이에도 들어온다
        got += [item async for item in gen]
        return got

    got = asyncio.run(go())
    assert got[0] == ("main", None, "e0") and ("member", "c1", "m1") in got
    assert [g[2] for g in got if g[0] == "main"] == ["e0", "e1", "e2", "e3"]
