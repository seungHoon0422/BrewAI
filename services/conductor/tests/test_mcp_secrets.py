"""관리자 서버 주소의 비밀값 가리기 · 같은 주소 두 줄 합치기 (api_mcp.py · connectors/catalog.py _merge_twins).

  가리기  관리자가 넣은 주소 query 의 키(?tavilyApiKey=…)는 사용자 응답 · 대화 이벤트 · 지침 · 기록 · 로그 어디에도 안 나온다
          (관리자 화면도 가린 주소 · url_redacted). 호출은 원래 주소 그대로 (가짜 MCP 가 받은 주소로 확인)
          경로의 키(/s/<키>/mcp) · '=' 없는 query 조각 · ';' 값도 · 로그의 예외 글(traceback)도
  합치기  내가 추가 · 가져온 서버가 전체 공통 서버와 같은 주소 = 목록 · 대화에 공통 서버 하나만 · 이름은 내가 쓰던 handle 그대로
          (공통 줄로 옮겨 간다 · 숨기면 내 줄로 돌아온다 · 옛 대화의 이름도 그대로 부른다)
          · 내 로그인은 그대로 쓰인다 (두 줄의 resource 가 달라도 = 빌려 쓴다 · 자세히 · 시험 · 끊기도 목록과 같은 인증정보)
가짜 MCP · OAuth = tests/fake_mcp.py (네트워크 없음).
"""

from __future__ import annotations

import json
import logging
import secrets
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx2
from pydantic_ai.messages import ModelMessage, ModelRequest, ToolReturnPart, UserPromptPart
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel
from pydantic_ai.models.test import TestModel

from conductor.app import redact_access_log
from conductor.auth import tokens
from conductor.connectors.ssrf import redact_url
from conductor.connectors.vault import generate_key

SECRET = "tvly-e2e-NOT-REAL-9f8e7d"
PORT = 50125


class Script:
    """요청마다 plan(messages, n) 이 정한 행동 (test_mcp_chat.Script 와 같은 모양 · 지침을 남긴다)."""

    def __init__(self, plan: Callable[[list[ModelMessage], int], Any]) -> None:
        self.plan = plan
        self.requests: list[dict[str, Any]] = []

    def model(self, _: str) -> FunctionModel:
        async def stream(messages: list[ModelMessage], info: AgentInfo) -> AsyncIterator[Any]:
            self.requests.append({"tools": [t.name for t in info.function_tools], "instructions": info.instructions or ""})
            act = self.plan(messages, len(self.requests))
            if isinstance(act, str):
                yield act
                return
            for i, (name, args) in enumerate(act):
                yield {i: DeltaToolCall(name=name, json_args=json.dumps(args, ensure_ascii=False), tool_call_id=f"c{len(self.requests)}_{i}")}

        return FunctionModel(stream_function=stream)


def returns(messages: list[ModelMessage]) -> list[ToolReturnPart]:
    out: list[ToolReturnPart] = []
    for m in messages:
        if isinstance(m, ModelRequest):
            if any(isinstance(p, UserPromptPart) for p in m.parts):
                out = []
            out += [p for p in m.parts if isinstance(p, ToolReturnPart)]
    return out


def world(make_api, fake_mcp, factory: Callable[[str], Any] | None = None):  # noqa: ANN001, ANN201
    """가짜 MCP + 받은 주소 기록 (호출이 원래 주소 · 키 그대로 가는지)."""
    fake = fake_mcp.Fake()
    seen: list[str] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(str(request.url))
        return fake.handler(request)

    api = make_api(factory or (lambda _: TestModel()), secret_key=generate_key(), app_kw={"mcp_transport": httpx2.MockTransport(handler)})
    return api, fake, seen


def connect(api, fake, client, server_id: str, *, account: str = "alice") -> dict[str, Any]:  # noqa: ANN001
    ds, verifier = secrets.token_urlsafe(16), secrets.token_urlsafe(48)
    res = client.post(f"/api/me/mcp/servers/{server_id}/connect/start", json={"port": PORT, "ds": ds, "cc": tokens.s256(verifier)})
    assert res.status_code == 200, res.text
    back = fake.authorize(res.json()["authorize_url"], account=account)
    cb = api.anon().get("/api/mcp/oauth/callback", params=back, follow_redirects=False)
    assert cb.status_code == 302, cb.text
    code = cb.headers["location"].split("code=", 1)[1]
    done = client.post(f"/api/me/mcp/servers/{server_id}/connect/complete", json={"code": code, "ds": ds, "code_verifier": verifier})
    assert done.status_code == 200, done.text
    return done.json()


def secret_server(api, fake_mcp) -> dict[str, Any]:  # noqa: ANN001
    res = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp?tavilyApiKey={SECRET}&team=core", "name": "Search"})
    assert res.status_code == 201, res.text
    return res.json()


# ── 가리기 ──────────────────────────────────────────────────────────────────────


def test_redact_url_masks_query_values_and_userinfo() -> None:
    assert redact_url("https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-abc") == "https://mcp.tavily.com/mcp/?tavilyApiKey=***"
    assert redact_url("https://u:p@a.test/x?q=1&flag&z=") == "https://***@a.test/x?q=***&***&z=***"  # '=' 없는 조각 = 통째로
    assert redact_url("https://mcp.linear.app/mcp") == "https://mcp.linear.app/mcp"  # 가릴 것 없음 = 그대로
    assert redact_url("https://a.test/m#frag") == "https://a.test/m"


def test_redact_url_masks_path_secrets_bare_tokens_and_matrix_params() -> None:
    assert redact_url("https://mcp.zapier.com/api/mcp/s/ZSECRET123/mcp") == "https://mcp.zapier.com/api/mcp/s/***/mcp"
    assert redact_url("https://mcp.zapier.com/api/mcp/s/YmFzZTY0LWxvb2tpbmctc2VjcmV0LXZhbHVl/mcp") == "https://mcp.zapier.com/api/mcp/s/***/mcp"
    assert redact_url("https://mcp.x.com/mcp?sk-abc123") == "https://mcp.x.com/mcp?***"
    assert redact_url("https://mcp.x.com/mcp;key=abc") == "https://mcp.x.com/mcp;key=***"
    assert redact_url("https://a.test/u/f47ac10b-58cc-4372-a567-0e02b2c3d479/sse") == "https://a.test/u/***/sse"  # uuid 같은 칸
    for plain in ("https://mcp.context7.com/mcp", "https://a.test/v1/2025-06-18/sse", "https://a.test/model-context-protocol/server",
                  "https://a.test/x/context7/mcp"):
        assert redact_url(plain) == plain  # 낱말 · 날짜 · 짧은 이름 = 그대로


def test_admin_server_with_a_path_secret_is_masked_for_everyone(make_api, fake_mcp) -> None:
    api, _, seen = world(make_api, fake_mcp)
    # 가짜 MCP 는 /mcp 만 받는다 → 정의를 직접 적고 (관리자 추가는 미리 확인을 거친다) 응답 모양만 본다
    s = secret_server(api, fake_mcp)
    secret_path = f"{fake_mcp.OPEN}/api/mcp/s/{SECRET}/mcp"
    with api.store.tx() as db:
        db.execute("UPDATE mcp_servers SET url = ? WHERE id = ?", (secret_path, s["id"]))
    one = api.client.get(f"/api/admin/mcp/servers/{s['id']}").json()
    assert one["url"] == f"{fake_mcp.OPEN}/api/mcp/s/***/mcp" and one["url_redacted"] is True
    api.add_user("m@brewai.test")
    mc = api.login("m@brewai.test")
    for res in (mc.get("/api/me/mcp/servers"), mc.get(f"/api/me/mcp/servers/{s['id']}")):
        assert res.status_code == 200 and SECRET not in res.text


def test_user_api_never_returns_the_admin_url_secret(make_api, fake_mcp) -> None:
    api, _, seen = world(make_api, fake_mcp)
    s = secret_server(api, fake_mcp)
    masked = f"{fake_mcp.OPEN}/mcp?tavilyApiKey=***&team=***"
    assert s["url"] == masked and s["url_redacted"] is True and SECRET not in json.dumps(s)  # 관리자 응답도 가린다
    api.add_user("m@brewai.test")
    mc = api.login("m@brewai.test")
    raws = [
        mc.get("/api/me/mcp/servers"), mc.get(f"/api/me/mcp/servers/{s['id']}"), mc.post(f"/api/me/mcp/servers/{s['id']}/test"),
        mc.get("/api/me/mcp/presets"), mc.patch(f"/api/me/mcp/servers/{s['id']}", json={"handle": "search_me"}),
    ]
    for res in raws:
        assert res.status_code == 200, res.text
        assert SECRET not in res.text, res.request.url
    app = next(a for a in raws[0].json()["mine"] if a["id"] == s["id"])
    assert (app["url"], app["source"], app["connection"], app["usable"]) == (masked, "install", "none", True)  # 연결 안 눌러도 바로 쓴다
    assert raws[2].json()["ok"] is True
    # 관리자 목록 · 자세히도 가린 주소 (주소는 아무도 못 고친다 = 원래 값이 필요한 화면이 없다)
    for res in (api.client.get("/api/admin/mcp/servers"), api.client.get(f"/api/admin/mcp/servers/{s['id']}")):
        assert SECRET not in res.text
    # 호출은 원래 주소 · 키 그대로
    assert any(SECRET in u for u in seen)


def test_chat_events_prompt_and_records_never_carry_the_secret(make_api, fake_mcp, caplog) -> None:
    def plan(messages: list[ModelMessage], n: int) -> Any:
        rs = returns(messages)
        if not rs:
            return [("use_app", {"app": "search", "need": "echo text"})]
        if len(rs) == 1:
            return [("search__echo", {"text": "안녕"})]
        return "끝"

    script = Script(plan)
    api, _, seen = world(make_api, fake_mcp, script.model)
    s = secret_server(api, fake_mcp)
    redact_access_log()
    with caplog.at_level(logging.DEBUG):
        events = api.chat("검색해줘")
    assert "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT") == "끝"
    assert [e["stepName"] for e in events if e["type"] == "STEP_STARTED"] == ["app:search", "tool:search__echo", "writing"]
    assert any(SECRET in u for u in seen)  # 도구는 원래 주소로 불렸다
    assert SECRET not in json.dumps(events, ensure_ascii=False)
    assert all(SECRET not in r["instructions"] for r in script.requests)
    runs = api.client.get("/api/runs")
    assert SECRET not in runs.text and SECRET not in api.client.get(f"/api/admin/mcp/servers/{s['id']}").text
    usage = api.client.get("/api/admin/usage")
    assert SECRET not in usage.text
    assert SECRET not in caplog.text  # httpx2 'HTTP Request: POST …' · mcp SDK 로그도 가린 주소


def test_log_filter_masks_outgoing_request_urls(caplog) -> None:
    redact_access_log()
    with caplog.at_level(logging.INFO, logger="httpx2"):
        logging.getLogger("httpx2").info('HTTP Request: %s %s "%s %d %s"', "POST", httpx2.URL(f"https://mcp.tavily.com/mcp/?tavilyApiKey={SECRET}"),
                                         "HTTP/1.1", 200, "OK")
    assert SECRET not in caplog.text and "tavilyApiKey=***" in caplog.text


def test_log_filter_masks_exception_text_and_stack(caplog) -> None:
    """mcp SDK 는 HTTPStatusError(“for url '…'”)를 exc_info 로 찍는다 → traceback 글도 가린다."""
    redact_access_log()
    url = f"https://mcp.tavily.com/mcp/?tavilyApiKey={SECRET}"
    lg = logging.getLogger("mcp.client.streamable_http")
    with caplog.at_level(logging.DEBUG, logger="mcp.client.streamable_http"):
        try:
            raise httpx2.HTTPStatusError(f"Client error '401 Unauthorized' for url '{url}'",
                                         request=httpx2.Request("GET", url), response=httpx2.Response(401))
        except httpx2.HTTPStatusError:
            lg.debug("GET stream error", exc_info=True)
            lg.exception("Error in post_writer")
        lg.debug("dict args %(u)s", {"u": url})
        lg.debug("stack", stack_info=True, extra={})
    assert SECRET not in caplog.text and "tavilyApiKey=***" in caplog.text and "HTTPStatusError" in caplog.text
    assert all(r.exc_info is None for r in caplog.records)


# ── 같은 주소 두 줄 = 전체 공통 하나 ──────────────────────────────────────────────


def test_own_server_with_the_same_url_as_a_common_server_shows_once(make_api, fake_mcp) -> None:
    api, _, _ = world(make_api, fake_mcp)
    api.add_user("m@brewai.test")
    mc = api.login("m@brewai.test")
    own = mc.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp?team=core&lang=ko", "name": "Notes"})
    assert own.status_code == 201, own.text
    own_id = own.json()["id"]
    assert [a["handle"] for a in mc.get("/api/me/mcp/servers").json()["mine"]] == ["notes"]
    common = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp?lang=ko&team=core", "name": "Notes"}).json()  # query 순서만 다름
    first = mc.get("/api/me/mcp/servers").json()["mine"]
    assert [(a["id"], a["source"]) for a in first] == [(common["id"], "install")]  # 공통 서버 하나만
    # handle = 내가 쓰던 이름 그대로 (내 줄의 'notes' 가 공통 줄로 옮겨 간다 · 숨은 내 줄 = 'notes_2' · 다시 읽어도 같다 = 프롬프트 캐시)
    handle = first[0]["handle"]
    assert handle == "notes"
    for _ in range(3):
        assert [a["handle"] for a in mc.get("/api/me/mcp/servers").json()["mine"]] == [handle]
    assert mc.get(f"/api/me/mcp/servers/{own_id}").json()["handle"] == "notes_2"
    # 서버 하나를 다루는 응답 = 그 줄 + merged_into (화면 안내)
    detail = mc.get(f"/api/me/mcp/servers/{own_id}").json()
    assert detail["listed"] is False
    again = mc.patch(f"/api/me/mcp/servers/{own_id}", json={"description": "메모"}).json()
    assert (again["id"], again["merged_into"]) == (own_id, common["id"])
    # 공통 서버를 숨기면 내 줄이 다시 보인다 (내 정의는 DB 에 남아 있었다) · 이름도 함께 돌아온다
    assert mc.delete(f"/api/me/mcp/servers/{common['id']}").status_code == 204
    shown = {a["id"]: (a["handle"], a["hidden"]) for a in mc.get("/api/me/mcp/servers").json()["mine"]}
    assert shown == {own_id: ("notes", False), common["id"]: ("notes_2", True)}
    # 다시 보이게 = 다시 공통 줄 하나 · 이름 'notes'
    assert mc.patch(f"/api/me/mcp/servers/{common['id']}", json={"hidden": False}).status_code == 200
    assert [(a["id"], a["handle"]) for a in mc.get("/api/me/mcp/servers").json()["mine"]] == [(common["id"], "notes")]


def test_custom_handle_on_my_row_moves_to_the_common_twin(make_api, fake_mcp) -> None:
    """내가 정한 별칭(set_my_handle)도 공통 줄이 생기면 그대로 보인다."""
    api, _, _ = world(make_api, fake_mcp)
    own = api.client.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp?team=x", "name": "Notes"}).json()
    assert api.client.patch(f"/api/me/mcp/servers/{own['id']}", json={"handle": "my_notes"}).json()["handle"] == "my_notes"
    common = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp?team=x", "name": "Notes"}).json()
    assert [(a["id"], a["handle"]) for a in api.client.get("/api/me/mcp/servers").json()["mine"]] == [(common["id"], "my_notes")]


def test_merged_common_server_uses_my_existing_login(make_api, fake_mcp) -> None:
    def plan(messages: list[ModelMessage], n: int) -> Any:
        rs = returns(messages)
        if not rs:
            return [("use_app", {"app": "tracker", "need": "이슈 검색"})]
        if len(rs) == 1:
            return [("tracker__search_issues", {"query": "버그"})]
        return f"계정 {rs[-1].content['result']['account']}"

    script = Script(plan)
    api, fake, _ = world(make_api, fake_mcp, script.model)
    own = api.client.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.MCP}/mcp", "name": "Tracker"})
    assert own.status_code == 201, own.text
    assert connect(api, fake, api.client, own.json()["id"], account="alice")["connection"] == "connected"
    common = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.MCP}/mcp", "name": "Tracker"}).json()
    mine = api.client.get("/api/me/mcp/servers").json()["mine"]
    assert [(a["id"], a["connection"]) for a in mine] == [(common["id"], "connected")]  # 다시 로그인하지 않는다
    tracker = mine[0]["handle"]
    script.plan = lambda messages, n: (  # noqa: E731
        [("use_app", {"app": tracker, "need": "이슈 검색"})] if not returns(messages)
        else [(f"{tracker}__search_issues", {"query": "버그"})] if len(returns(messages)) == 1
        else f"계정 {returns(messages)[-1].content['result']['account']}"
    )
    events = api.chat("버그 찾아줘")
    assert not [e for e in events if e["type"] == "CUSTOM" and e["name"] == "brewai.app_auth"]  # 로그인 카드 없음
    assert "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT") == "계정 alice"
    assert fake.calls[-1] == ("alice", "search_issues")
    block = script.requests[0]["instructions"]
    assert block.count(tracker) == 1  # 프롬프트 앱 목록에도 한 번


def test_shared_server_with_a_common_twin_is_not_importable(make_api, fake_mcp) -> None:
    api, _, _ = world(make_api, fake_mcp)
    api.add_user("m@brewai.test")
    mc = api.login("m@brewai.test")
    org = api.me["orgs"][0]["id"]
    url = f"{fake_mcp.OPEN}/mcp?team=core"
    shared = api.client.post("/api/me/mcp/servers", json={"url": url, "name": "Team Notes", "share": {"scope_kind": "org", "scope_id": org}})
    assert shared.status_code == 201, shared.text
    assert [i["id"] for i in mc.get("/api/me/mcp/servers").json()["importable"]] == [shared.json()["id"]]
    api.client.post("/api/admin/mcp/servers", json={"url": url, "name": "Notes"})
    body = mc.get("/api/me/mcp/servers").json()
    assert body["importable"] == [] and [a["source"] for a in body["mine"]] == ["install"]


def test_common_twin_with_another_resource_borrows_my_login_everywhere(make_api, fake_mcp) -> None:
    """두 줄의 resource 가 다르면(PRM 없는 서버 · url_key 만 같은 주소) 공통 줄은 로그인 전 → 내 줄의 인증정보를 빌린다.
    목록 · 자세히 · 시험 · 대화 · 끊기가 모두 같은 인증정보를 본다 (빌림이 없으면 이 테스트가 깨진다)."""
    def plan(messages: list[ModelMessage], n: int) -> Any:
        rs = returns(messages)
        if not rs:
            return [("use_app", {"app": "tracker", "need": "이슈 검색"})]
        if len(rs) == 1:
            return [("tracker__search_issues", {"query": "버그"})]
        return f"계정 {rs[-1].content['result']['account']}"

    script = Script(plan)
    api, fake, _ = world(make_api, fake_mcp, script.model)
    own = api.client.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.MCP}/mcp", "name": "Tracker"}).json()
    assert connect(api, fake, api.client, own["id"], account="alice")["connection"] == "connected"
    res = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.MCP}/mcp", "name": "Tracker"})
    assert res.status_code == 201, res.text
    common = res.json()
    other = f"{fake_mcp.MCP}/mcp?tenant=common"  # PRM 없는 서버가 주소로 정한 resource 처럼 = 내 로그인과 다른 resource
    with api.store.tx() as db:
        db.execute("UPDATE mcp_servers SET resource = ? WHERE id = ?", (other, common["id"]))
    assert api.store.query("SELECT COUNT(*) AS n FROM mcp_credentials WHERE resource = ?", (other,))[0]["n"] == 0
    mine = api.client.get("/api/me/mcp/servers").json()["mine"]
    assert [(a["id"], a["connection"], a["handle"]) for a in mine] == [(common["id"], "connected", "tracker")]
    detail = api.client.get(f"/api/me/mcp/servers/{common['id']}").json()
    assert (detail["connection"], detail["listed"]) == ("connected", True)  # 목록과 같다 (needs_login 아님)
    tested = api.client.post(f"/api/me/mcp/servers/{common['id']}/test").json()
    assert (tested["ok"], tested["connection"], tested["code"]) == (True, "connected", None)
    events = api.chat("버그 찾아줘")
    assert not [e for e in events if e["type"] == "CUSTOM" and e["name"] == "brewai.app_auth"]
    assert "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT") == "계정 alice"
    assert fake.calls[-1] == ("alice", "search_issues")
    # 끊기 = 빌려 쓰던 내 인증정보 (목록 · 내 줄 둘 다 로그인 전으로)
    assert api.client.delete(f"/api/me/mcp/servers/{common['id']}/connection").status_code == 204
    assert [a["connection"] for a in api.client.get("/api/me/mcp/servers").json()["mine"]] == ["needs_login"]
    assert api.client.get(f"/api/me/mcp/servers/{own['id']}").json()["connection"] == "needs_login"


def test_old_thread_keeps_calling_the_name_after_the_common_twin_appears(make_api, fake_mcp) -> None:
    """대화 기록이 'notes__echo' 를 내 줄에 묶었는데 같은 주소의 공통 줄이 생겼다 = 같은 서버로 보고 그대로 부른다 (unknown_tool 아님)."""
    seen_results: list[Any] = []

    def plan(messages: list[ModelMessage], n: int) -> Any:
        rs = returns(messages)
        if n == 1:
            return [("use_app", {"app": "notes", "need": "echo text"})]
        if n == 2:
            return [("notes__echo", {"text": "회의"})]
        if n == 3:
            return "첫 답"
        if not rs:  # 둘째 턴 = use_app 없이 바로 (기록이 이미 공개한 이름)
            return [("notes__echo", {"text": "다시"})]
        seen_results.append(rs[-1].content)
        return "둘째 답"

    script = Script(plan)
    api, _, _ = world(make_api, fake_mcp, script.model)
    api.client.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp?team=pin", "name": "Notes"})
    assert "".join(e["delta"] for e in api.chat("메모 찾아줘") if e["type"] == "TEXT_MESSAGE_CONTENT") == "첫 답"
    common = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp?team=pin", "name": "Notes"}).json()
    assert [(a["id"], a["handle"]) for a in api.client.get("/api/me/mcp/servers").json()["mine"]] == [(common["id"], "notes")]
    events = api.chat("다시 찾아줘")
    assert "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT") == "둘째 답"
    assert seen_results and "error" not in seen_results[-1], seen_results
