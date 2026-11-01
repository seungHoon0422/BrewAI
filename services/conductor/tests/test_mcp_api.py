"""MCP HTTP API (api_mcp.py · ADR-0013 · slice 05) — 관리자 공통 서버 · 사용자 서버 · 공유 · 가져오기 권한 표 · OAuth 콜백 · SSRF.

가짜 MCP · OAuth = tests/fake_mcp.py (httpx2.MockTransport · 네트워크 없음). 판정 = auth/policy.py (못 보는 서버 = 404).
"""

from __future__ import annotations

import secrets
from typing import Any

import pytest
from pydantic_ai.models.test import TestModel

from conductor.auth import tokens
from conductor.connectors.vault import generate_key

PORT = 50124


def world(make_api, fake_mcp, **kw: Any):  # noqa: ANN001, ANN201
    fake = fake_mcp.Fake()
    api = make_api(lambda _: TestModel(), secret_key=generate_key(), app_kw={"mcp_transport": fake.transport}, **kw)
    return api, fake


def start(client, server_id: str, *, port: int = PORT) -> tuple[dict[str, Any], str, str]:  # noqa: ANN001
    ds, verifier = secrets.token_urlsafe(16), secrets.token_urlsafe(48)
    res = client.post(f"/api/me/mcp/servers/{server_id}/connect/start", json={"port": port, "ds": ds, "cc": tokens.s256(verifier)})
    assert res.status_code == 200, res.text
    return res.json(), ds, verifier


def connect(api, fake, client, server_id: str, *, account: str = "alice") -> dict[str, Any]:  # noqa: ANN001
    started, ds, verifier = start(client, server_id)
    back = fake.authorize(started["authorize_url"], account=account)
    cb = api.anon().get("/api/mcp/oauth/callback", params=back, follow_redirects=False)
    assert cb.status_code == 302, cb.text
    code = cb.headers["location"].split("code=", 1)[1]
    res = client.post(f"/api/me/mcp/servers/{server_id}/connect/complete", json={"code": code, "ds": ds, "code_verifier": verifier})
    assert res.status_code == 200, res.text
    return res.json()


# ── 관리자: 전체 공통 서버 ────────────────────────────────────────────────────────────


def test_admin_adds_common_server_tests_and_tunes_tools(make_api, fake_mcp) -> None:
    api, fake = world(make_api, fake_mcp)
    res = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp", "name": "Notes", "description": "팀 메모"})
    assert res.status_code == 201, res.text
    s = res.json()
    assert (s["auth"], s["handle"], s["tool_count"], s["origin"], s["status"]) == ("none", "notes", 3, "admin", "active")
    assert s["prompt_line"] == "notes" and s["prompt_tokens"] > 0 and s["tool_tokens_est"] > 0  # 목록 한 줄 속 handle 하나
    assert s["preview"]["tool_count"] == 3 and s["connected_count"] == 0
    oauth = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.MCP}/mcp", "name": "Tracker"}).json()
    assert (oauth["auth"], oauth["issuer"], oauth["tool_count"]) == ("oauth", fake_mcp.AS, None)  # 도구 수 = 누가 로그인한 뒤
    assert api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp"}).json() == {"detail": "server_exists"}
    test = api.client.post(f"/api/admin/mcp/servers/{oauth['id']}/test").json()
    assert test["ok"] is True and test["code"] == "needs_login"
    connect(api, fake, api.client, oauth["id"])  # 관리자 본인이 연결 → 연결 테스트가 도구 수까지
    test = api.client.post(f"/api/admin/mcp/servers/{oauth['id']}/test").json()
    assert (test["ok"], test["tool_count"], test["write_count"]) == (True, 20, 8)
    tools = api.client.get(f"/api/admin/mcp/servers/{oauth['id']}/tools").json()["tools"]
    assert len(tools) == 20 and {t["name"] for t in tools if t["write"]} >= {"create_issue", "delete_issue"}
    assert next(t for t in tools if t["name"] == "search_issues")["public"] == "tracker__search_issues"
    patched = api.client.patch(f"/api/admin/mcp/servers/{oauth['id']}/tools",
                               json={"tool": "list_teams", "mode": "hidden", "always_reveal": False, "aliases": ["팀 목록"]}).json()["tools"]
    assert next(t for t in patched if t["name"] == "list_teams")["mode"] == "hidden"
    listed = api.client.get("/api/admin/mcp/servers").json()
    assert [r["handle"] for r in listed] == ["notes", "tracker"] and listed[1]["connected_count"] == 1
    # 끄기 → 사용자 목록에서 쓸 수 없음
    assert api.client.patch(f"/api/admin/mcp/servers/{s['id']}", json={"status": "disabled"}).json()["status"] == "disabled"
    mine = {a["handle"]: a for a in api.client.get("/api/me/mcp/servers").json()["mine"]}
    assert mine["notes"]["usable"] is False and mine["tracker"]["source"] == "install"
    assert api.client.delete(f"/api/admin/mcp/servers/{s['id']}").status_code == 204
    actions = [r["action"] for r in api.store.query("SELECT action FROM audit_events WHERE action LIKE 'mcp.%' ORDER BY rowid")]
    assert actions[:2] == ["mcp.server.add", "mcp.server.add"] and "mcp.connect" in actions and actions[-1] == "mcp.server.remove"


def test_admin_preregistered_client_and_policy(make_api, fake_mcp) -> None:
    api, _ = world(make_api, fake_mcp)
    sid = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.MCP}/mcp", "name": "Tracker"}).json()["id"]
    res = api.client.put(f"/api/admin/mcp/servers/{sid}/oauth-client", json={"client_id": "gh-app", "client_secret": "shh-secret-value"})
    assert res.status_code == 200, res.text
    assert res.json() | {"updated_at": None} == {"issuer": fake_mcp.AS, "client_id": "gh-app", "source": "preregistered",
                                                  "auth_method": "client_secret_basic", "has_secret": True, "scope": None, "updated_at": None}
    assert "shh-secret-value" not in api.client.get(f"/api/admin/mcp/servers/{sid}").text
    assert "shh-secret-value" not in "\n".join(api.store._db.iterdump())  # 암호문만
    pol = api.client.patch("/api/admin/mcp/policy", json={"allow_user_servers": False, "url_allowlist": ["*.fake.test", "linear.app"]})
    assert pol.json() == {"allow_user_servers": False, "url_allowlist": ["*.fake.test", "linear.app"]}
    assert api.client.patch("/api/admin/mcp/policy", json={"url_allowlist": ["bad host!"]}).status_code == 422
    b = api.add_user("b@brewai.test")
    bc = api.login("b@brewai.test")
    assert bc.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp"}).json() == {"detail": "user_servers_disabled"}
    api.client.patch("/api/admin/mcp/policy", json={"allow_user_servers": True, "url_allowlist": ["linear.app"]})
    assert bc.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp"}).json() == {"detail": "url_not_allowed"}
    assert b


def test_admin_routes_need_admin_cookie(make_api, fake_mcp) -> None:
    api, _ = world(make_api, fake_mcp)
    api.add_user("m@brewai.test")
    member = api.login("m@brewai.test")
    assert member.get("/api/admin/mcp/servers").status_code == 401  # Bearer 로는 관리자 경로 못 씀
    assert api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp"}, headers={"x-csrf-token": "x"}).status_code == 403


# ── SSRF · 주소 ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("url", "code"),
    [
        ("http://mcp.example.com/mcp", "url_not_https"),
        ("https://10.0.0.5/mcp", "url_blocked"),
        ("https://169.254.169.254/latest", "url_blocked"),
        ("https://user:pw@mcp.example.com/mcp", "url_blocked"),
        ("https://127.0.0.1:4014/mcp", "url_blocked"),  # loopback = 테스트 전용 설정에서만
        ("not a url", "bad_url"),
    ],
)
def test_ssrf_rejected(make_api, fake_mcp, url: str, code: str) -> None:
    api, _ = world(make_api, fake_mcp)
    res = api.client.post("/api/me/mcp/servers/preview", json={"url": url})
    assert (res.status_code, res.json()) == (422, {"detail": code})


def test_ssrf_dns_rebinding_to_private_address(make_api, fake_mcp) -> None:
    """이름은 공개처럼 보여도 풀어 보니 사설 주소 = 접속 전에 막는다 (진짜 연결 경로 · 가짜 resolver)."""
    from conductor.connectors.session import Connectors

    api = make_api(lambda _: TestModel(), secret_key=generate_key())
    svc: Connectors = api.app.state.connectors

    async def rebinding(host: str, port: int) -> list[str]:
        return ["10.1.2.3"]

    svc.mcp._resolver = rebinding
    res = api.client.post("/api/me/mcp/servers/preview", json={"url": "https://looks-public.example.com/mcp"})
    assert (res.status_code, res.json()) == (422, {"detail": "url_blocked"})


# ── 사용자 서버 · 공유 · 가져오기 (권한 표) ─────────────────────────────────────────────────


def test_share_import_matrix_and_own_accounts(make_api, fake_mcp) -> None:
    api, fake = world(make_api, fake_mcp)
    a = api.add_user("a@brewai.test", name="에이")
    b = api.add_user("b@brewai.test", name="비")
    api.add_user("c@brewai.test", name="씨")
    api.add_user("o@brewai.test", name="오", org_role="admin")
    ac, bc, cc, oc = (api.login(f"{x}@brewai.test") for x in "abco")
    space = ac.post("/api/spaces", json={"name": "디자인팀", "members": [{"user_id": b, "role": "member"}]}).json()
    org_id = api.me["orgs"][0]["id"]

    prev = ac.post("/api/me/mcp/servers/preview", json={"url": f"{fake_mcp.MCP}/mcp", "name": "Tracker"}).json()
    assert (prev["auth"], prev["issuer_domain"], prev["tool_count"], prev["handle"]) == ("oauth", "auth.fake.test", None, "tracker")
    created = ac.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.MCP}/mcp", "name": "Tracker", "description": "디자인 이슈",
                                                   "share": {"scope_kind": "space", "scope_id": space["id"]}})
    assert created.status_code == 201, created.text
    sid = created.json()["id"]
    assert (created.json()["source"], created.json()["can_manage"]) == ("own", True)
    assert ac.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.MCP}/mcp"}).json() == {"detail": "server_exists"}

    # 조직 공유 = 조직 owner · admin 만 (사용자 결정) — 멤버 a 는 403
    assert ac.post(f"/api/me/mcp/servers/{sid}/shares", json={"scope_kind": "org", "scope_id": org_id}).json() == {"detail": "forbidden"}
    assert ac.post(f"/api/me/mcp/servers/{sid}/shares", json={"scope_kind": "space", "scope_id": "nope"}).json() == {"detail": "space_not_found"}
    assert ac.post(f"/api/me/mcp/servers/{sid}/shares", json={"scope_kind": "install", "scope_id": "*"}).status_code == 422

    # b (스페이스 멤버) = 가져올 수 있음 · 경로(Breadcrumb) · c (멤버 아님) = 안 보이고 404
    imp = bc.get("/api/me/mcp/servers").json()
    assert imp["mine"] == [] and [i["name"] for i in imp["importable"]] == ["Tracker"]
    assert imp["importable"][0]["owner_name"] == "에이" and imp["importable"][0]["via"][0]["path"][-1]["name"] == "디자인팀"
    assert cc.get("/api/me/mcp/servers").json()["importable"] == []
    for method, path, body in [("get", "", None), ("patch", "", {"name": "x"}), ("delete", "", None), ("post", "/import", {}),
                               ("post", "/connect/start", {"port": PORT, "ds": "d" * 16})]:
        res = getattr(cc, method)(f"/api/me/mcp/servers/{sid}{path}", **({"json": body} if body is not None else {}))
        assert (res.status_code, res.json()) == (404, {"detail": "mcp_server_not_found"}), (method, path)
    # b 는 고치기 · 지우기 = 403 (보이지만 주인 아님) · 가져오기 전에 연결 = 409 needs_import
    assert bc.patch(f"/api/me/mcp/servers/{sid}", json={"name": "내 것"}).json() == {"detail": "forbidden"}
    assert bc.post(f"/api/me/mcp/servers/{sid}/connect/start", json={"port": PORT, "ds": "d" * 16}).json() == {"detail": "needs_import"}
    got = bc.post(f"/api/me/mcp/servers/{sid}/import", json={})
    assert got.status_code == 201 and got.json()["source"] == "imported" and got.json()["connection"] == "needs_login"
    assert bc.post(f"/api/me/mcp/servers/{sid}/import", json={}).json() == {"detail": "already_imported"}
    # 각자 자기 계정으로 로그인 (공유자 토큰 안 씀) · mock 이 다른 계정 확인
    connect(api, fake, ac, sid, account="alice")
    connect(api, fake, bc, sid, account="bob")
    assert {v["account"] for v in fake.access.values()} == {"alice", "bob"}
    detail = ac.get(f"/api/me/mcp/servers/{sid}").json()
    assert len(detail["tools"]) == 20 and detail["shares"][0]["path"][-1]["name"] == "디자인팀"
    assert "shares" not in bc.get(f"/api/me/mcp/servers/{sid}").json()

    # 공유 끊기: b(멤버) = 403 · 조직 admin = 됨 → b 는 '공유가 끊겼어요' (목록엔 남고 대화에선 빠짐)
    q = {"scope_kind": "space", "scope_id": space["id"]}
    assert bc.delete(f"/api/me/mcp/servers/{sid}/shares", params=q).json() == {"detail": "forbidden"}
    assert oc.delete(f"/api/me/mcp/servers/{sid}/shares", params=q).status_code == 204
    lost = bc.get("/api/me/mcp/servers").json()["mine"][0]
    assert (lost["share_lost"], lost["usable"]) == (True, False)
    assert ac.delete(f"/api/me/mcp/servers/{sid}/shares", params=q).json() == {"detail": "share_not_found"}
    # 조직 admin 도 남의 서버는 공유 못 한다 (공유가 끊긴 뒤라 보이지도 않음 = 404)
    assert oc.post(f"/api/me/mcp/servers/{sid}/shares", json={"scope_kind": "org", "scope_id": org_id}).status_code == 404
    # b: 가져온 앱 [빼기] = 내 줄만 · a: 지우기 = 정의째
    assert bc.delete(f"/api/me/mcp/servers/{sid}").status_code == 204
    assert ac.delete(f"/api/me/mcp/servers/{sid}").status_code == 204
    assert ac.get(f"/api/me/mcp/servers/{sid}").status_code == 404
    actions = {r["action"] for r in api.store.query("SELECT action FROM audit_events WHERE action LIKE 'mcp.server.%'")}
    assert actions == {"mcp.server.add", "mcp.server.share", "mcp.server.unshare", "mcp.server.import", "mcp.server.remove"}
    assert a


def test_org_admin_can_share_own_server_to_org(make_api, fake_mcp) -> None:
    api, _ = world(make_api, fake_mcp)
    api.add_user("o@brewai.test", org_role="admin")
    api.add_user("m@brewai.test")
    oc, mc = api.login("o@brewai.test"), api.login("m@brewai.test")
    sid = oc.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp", "name": "Notes"}).json()["id"]
    org_id = api.me["orgs"][0]["id"]
    assert oc.post(f"/api/me/mcp/servers/{sid}/shares", json={"scope_kind": "org", "scope_id": org_id}).status_code == 201
    assert [i["name"] for i in mc.get("/api/me/mcp/servers").json()["importable"]] == ["Notes"]
    imported = mc.post(f"/api/me/mcp/servers/{sid}/import", json={"handle": "team_notes"}).json()
    assert (imported["handle"], imported["connection"], imported["usable"]) == ("team_notes", "none", True)


def test_common_server_hide_alias_and_delete_means_hide(make_api, fake_mcp) -> None:
    api, _ = world(make_api, fake_mcp)
    sid = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp", "name": "Notes"}).json()["id"]
    api.add_user("m@brewai.test")
    mc = api.login("m@brewai.test")
    assert mc.patch(f"/api/me/mcp/servers/{sid}", json={"handle": "memo"}).json()["handle"] == "memo"
    assert mc.patch(f"/api/me/mcp/servers/{sid}", json={"handle": "Bad Handle"}).json() == {"detail": "bad_handle"}
    assert mc.patch(f"/api/me/mcp/servers/{sid}", json={"name": "x"}).json() == {"detail": "forbidden"}  # 공통 정의 = 관리자만
    assert mc.delete(f"/api/me/mcp/servers/{sid}").status_code == 204  # 공통 = 숨기기
    row = mc.get("/api/me/mcp/servers").json()["mine"][0]
    assert (row["hidden"], row["usable"]) == (True, False)
    assert mc.patch(f"/api/me/mcp/servers/{sid}", json={"hidden": False}).json()["usable"] is True
    test = mc.post(f"/api/me/mcp/servers/{sid}/test").json()
    assert (test["ok"], test["tool_count"]) == (True, 3)


def test_admin_disables_user_server(make_api, fake_mcp) -> None:
    api, _ = world(make_api, fake_mcp)
    api.add_user("m@brewai.test", name="엠")
    mc = api.login("m@brewai.test")
    sid = mc.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp", "name": "Mine"}).json()["id"]
    rows = api.client.get("/api/admin/mcp/user-servers").json()
    assert [(r["name"], r["owner_name"], r["share_count"], r["connected_count"]) for r in rows] == [("Mine", "엠", 0, 0)]
    assert api.client.patch(f"/api/admin/mcp/servers/{sid}", json={"name": "x"}).json() == {"detail": "user_server"}
    assert api.client.patch(f"/api/admin/mcp/user-servers/{sid}", json={"status": "disabled"}).json()["status"] == "disabled"
    assert mc.get("/api/me/mcp/servers").json()["mine"][0]["usable"] is False
    assert mc.post(f"/api/me/mcp/servers/{sid}/connect/start", json={"port": PORT, "ds": "d" * 16}).json() == {"detail": "server_disabled"}


# ── OAuth 콜백 · 연결 CSRF · 끊기 ───────────────────────────────────────────────────


def test_callback_state_iss_and_handoff_rules(make_api, fake_mcp) -> None:
    api, fake = world(make_api, fake_mcp)
    sid = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.MCP}/mcp", "name": "Tracker"}).json()["id"]
    anon = api.anon()
    bad = anon.get("/api/mcp/oauth/callback", params={"state": "made-up", "code": "x"}, follow_redirects=False)
    assert bad.status_code == 400 and "만료" in bad.text and bad.headers["cache-control"] == "no-store"

    started, ds, verifier = start(api.client, sid)
    back = fake.authorize(started["authorize_url"], account="alice")
    forged = anon.get("/api/mcp/oauth/callback", params=back | {"iss": "https://evil.test"}, follow_redirects=False)
    assert forged.status_code == 302 and forged.headers["location"] == f"http://127.0.0.1:{PORT}/cb?error=iss_mismatch"
    reused = anon.get("/api/mcp/oauth/callback", params=back, follow_redirects=False)
    assert reused.status_code == 400  # state 는 한 번만 (실패한 시도로도 소진)

    started, ds, verifier = start(api.client, sid)
    back = fake.authorize(started["authorize_url"], account="alice")
    cb = anon.get("/api/mcp/oauth/callback", params=back, follow_redirects=False)
    code = cb.headers["location"].split("code=", 1)[1]
    assert code.startswith("bwm_") and "ds=" not in cb.headers["location"]
    # 남이 code 를 가로채도 못 쓴다 (시작한 사람 · ds · PKCE verifier)
    api.add_user("x@brewai.test")
    xc = api.login("x@brewai.test")
    assert xc.post(f"/api/me/mcp/servers/{sid}/connect/complete", json={"code": code, "ds": ds, "code_verifier": verifier}).json() == {
        "detail": "wrong_user"}
    started, ds, verifier = start(api.client, sid)
    back = fake.authorize(started["authorize_url"], account="alice")
    code = anon.get("/api/mcp/oauth/callback", params=back, follow_redirects=False).headers["location"].split("code=", 1)[1]
    assert api.client.post(f"/api/me/mcp/servers/{sid}/connect/complete", json={"code": code, "ds": "w" * 16, "code_verifier": verifier}).json() == {
        "detail": "ds_mismatch"}
    denied = fake.authorize(start(api.client, sid)[0]["authorize_url"], deny=True)
    res = anon.get("/api/mcp/oauth/callback", params=denied, follow_redirects=False)
    assert res.headers["location"].endswith("?error=cancelled")
    assert api.client.post(f"/api/me/mcp/servers/{sid}/connect/start", json={"port": 80, "ds": "d" * 16}).status_code == 422
    assert api.client.post(f"/api/me/mcp/servers/{sid}/connect/start", json={"port": PORT, "ds": "bad ds!"}).json() == {"detail": "bad_request"}


def test_connect_disconnect_and_no_vault(make_api, fake_mcp) -> None:
    api, fake = world(make_api, fake_mcp)
    sid = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.MCP}/mcp", "name": "Tracker"}).json()["id"]
    app = connect(api, fake, api.client, sid)
    assert app["connection"] == "connected" and app["tool_count"] == 20  # 연결 직후 도구 목록을 미리 받아 둔다
    assert api.client.delete(f"/api/me/mcp/servers/{sid}/connection").status_code == 204
    assert api.client.get("/api/me/mcp/servers").json()["mine"][0]["connection"] == "needs_login"
    assert api.client.delete(f"/api/me/mcp/servers/{sid}/connection").json() == {"detail": "not_connected"}
    assert "mcp.disconnect" in {r["action"] for r in api.store.query("SELECT action FROM audit_events")}

    fake2 = fake_mcp.Fake()
    nokey = make_api(lambda _: TestModel(), app_kw={"mcp_transport": fake2.transport})
    sid2 = nokey.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.MCP}/mcp", "name": "Tracker"}).json()["id"]
    assert nokey.client.get("/api/me/mcp/servers").json()["vault_ready"] is False
    res = nokey.client.post(f"/api/me/mcp/servers/{sid2}/connect/start", json={"port": PORT, "ds": "d" * 16})
    assert (res.status_code, res.json()) == (503, {"detail": "vault_missing"})


# ── 사용자 서버 경계 (AS mix-up · 주소 비밀값 · 허용 목록 · 서버 정의 덮어쓰기) ─────────────────────────


def test_user_server_cannot_borrow_a_foreign_or_preregistered_login(make_api, fake_mcp) -> None:
    """사용자 서버의 PRM 이 남의 AS(예: GitHub)를 가리켜도 우리 client 로 받은 토큰이 그 서버로 가지 않는다."""
    fake = fake_mcp.Fake(prm_as=fake_mcp.OTHER_AS)
    api = make_api(lambda _: TestModel(), secret_key=generate_key(), app_kw={"mcp_transport": fake.transport})
    api.add_user("m@brewai.test")
    mc = api.login("m@brewai.test")
    # 미리 확인 · 추가 = 로그인 사이트가 서버와 다르면 422 (관리자 서버는 된다)
    assert mc.post("/api/me/mcp/servers/preview", json={"url": f"{fake_mcp.MCP}/mcp"}).json() == {"detail": "issuer_foreign"}
    assert mc.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.MCP}/mcp"}).json() == {"detail": "issuer_foreign"}
    admin = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.MCP}/mcp", "name": "Hub"})
    assert admin.status_code == 201 and admin.json()["issuer_domain"] == "login.other.test"
    # 추가 뒤에 PRM 이 바뀐 사용자 서버 = connect/start 에서 거절 (토큰을 만들지도 않는다)
    fake.prm_as = fake_mcp.AS
    api.app.state.connectors.oauth._discovery.clear()
    made = mc.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.MCP}/mcp", "name": "Mine"})
    assert made.status_code == 201, made.text
    sid = made.json()["id"]
    fake.prm_as = fake_mcp.OTHER_AS
    api.app.state.connectors.oauth._discovery.clear()
    res = mc.post(f"/api/me/mcp/servers/{sid}/connect/start", json={"port": PORT, "ds": "d" * 16})
    assert (res.status_code, res.json()) == (502, {"detail": "oauth_issuer_foreign"})
    # 같은 사이트 AS 라도 관리자가 사전 등록한 client(secret)는 사용자 서버 로그인에 쓰지 않는다
    fake.prm_as = fake_mcp.AS
    api.app.state.connectors.oauth._discovery.clear()
    api.app.state.connectors.oauth.set_client(fake_mcp.AS, client_id="pre_gh", client_secret="s3cret")
    res = mc.post(f"/api/me/mcp/servers/{sid}/connect/start", json={"port": PORT, "ds": "d" * 16})
    assert (res.status_code, res.json()) == (502, {"detail": "oauth_client_admin_only"})
    assert fake.registrations == 0 and fake.token_requests == 0


def test_user_server_url_with_secret_query_is_rejected(make_api, fake_mcp) -> None:
    api, fake = world(make_api, fake_mcp)
    for q in ("?api_key=sk_live_1", "?Token=x", "?x-auth=1", "?access_secret=1"):
        res = api.client.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp{q}"})
        assert (res.status_code, res.json()) == (422, {"detail": "url_has_secret"}), q
    assert fake.log == []  # 바깥으로 요청 0
    ok = api.client.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp?team=core"})
    assert ok.status_code == 201, ok.text


def test_allowlist_checked_before_probe_and_after_add(make_api, fake_mcp) -> None:
    api, fake = world(make_api, fake_mcp)
    api.add_user("m@brewai.test")
    mc = api.login("m@brewai.test")
    sid = mc.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp", "name": "Notes"}).json()["id"]
    assert api.client.patch("/api/admin/mcp/policy", json={"url_allowlist": ["linear.app"]}).status_code == 200
    fake.log.clear()
    for path in ("/preview", ""):
        res = mc.post(f"/api/me/mcp/servers{path}", json={"url": f"{fake_mcp.MCP}/mcp"})
        assert (res.status_code, res.json()) == (403, {"detail": "url_not_allowed"})
    assert fake.log == []  # 허용 목록 밖 = 미리 확인도 안 보낸다
    # 이미 추가한 서버도 지금 정책으로: 목록엔 남고(막힘) 대화 · 연결에서는 빠진다
    row = mc.get("/api/me/mcp/servers").json()["mine"][0]
    assert (row["blocked"], row["usable"]) == ("url_not_allowed", False)
    assert mc.post(f"/api/me/mcp/servers/{sid}/connect/start", json={"port": PORT, "ds": "d" * 16}).json() == {"detail": "url_not_allowed"}
    assert api.app.state.connectors.session(api.store.query("SELECT owner_user_id FROM mcp_servers")[0][0]) is None
    api.client.patch("/api/admin/mcp/policy", json={"url_allowlist": [], "allow_user_servers": False})
    assert mc.get("/api/me/mcp/servers").json()["mine"][0]["blocked"] == "user_servers_disabled"
    api.client.patch("/api/admin/mcp/policy", json={"allow_user_servers": True})
    assert mc.get("/api/me/mcp/servers").json()["mine"][0]["usable"] is True


def test_connect_start_reads_header_only_prm_and_keeps_the_shared_definition(make_api, fake_mcp) -> None:
    fake = fake_mcp.Fake(prm_header_only=True)
    api = make_api(lambda _: TestModel(), secret_key=generate_key(), app_kw={"mcp_transport": fake.transport})
    sid = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.MCP}/mcp", "name": "Tracker"}).json()["id"]
    api.app.state.connectors.oauth._discovery.clear()  # 미리 확인 때 찾은 것 말고 start 가 스스로 (헤더의 PRM 주소)
    assert connect(api, fake, api.client, sid)["connection"] == "connected"
    row = api.store.query("SELECT resource, issuer FROM mcp_servers WHERE id = ?", (sid,))[0]
    assert (row["resource"], row["issuer"]) == (fake_mcp.MCP, fake_mcp.AS)
    # 쓰기만 하는 사람의 로그인이 모두의 서버 정의(인증정보 열쇠)를 바꾸지 않는다 · 관리자(고칠 수 있는 사람)는 된다
    api.add_user("m@brewai.test")
    mc = api.login("m@brewai.test")
    fake.prm_as = fake_mcp.OTHER_AS
    api.app.state.connectors.oauth._discovery.clear()
    res = mc.post(f"/api/me/mcp/servers/{sid}/connect/start", json={"port": PORT, "ds": "d" * 16})
    assert (res.status_code, res.json()) == (502, {"detail": "oauth_server_changed"})
    assert api.store.query("SELECT issuer FROM mcp_servers WHERE id = ?", (sid,))[0]["issuer"] == fake_mcp.AS
    started, _, _ = start(api.client, sid)
    assert started["authorize_url"].startswith(f"{fake_mcp.OTHER_AS}/authorize")
    assert api.store.query("SELECT issuer FROM mcp_servers WHERE id = ?", (sid,))[0]["issuer"] == fake_mcp.OTHER_AS


def test_import_with_a_taken_handle_is_409(make_api, fake_mcp) -> None:
    api, _ = world(make_api, fake_mcp)
    api.add_user("o@brewai.test", org_role="admin")
    api.add_user("m@brewai.test")
    oc, mc = api.login("o@brewai.test"), api.login("m@brewai.test")
    org_id = api.me["orgs"][0]["id"]
    sid = oc.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp", "name": "Notes"}).json()["id"]
    oc.post(f"/api/me/mcp/servers/{sid}/shares", json={"scope_kind": "org", "scope_id": org_id})
    mine = mc.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp?team=a", "name": "Memo"}).json()
    mc.patch(f"/api/me/mcp/servers/{mine['id']}", json={"handle": "memo"})
    res = mc.post(f"/api/me/mcp/servers/{sid}/import", json={"handle": "memo"})
    assert (res.status_code, res.json()) == (409, {"detail": "handle_taken"})


def test_handles_stay_put_when_servers_come_and_go(make_api, fake_mcp) -> None:
    """처음 정한 handle 은 그 서버 몫: 같은 handle 의 새 서버가 와도 옛 서버의 이름을 빼앗지 않는다."""
    api, _ = world(make_api, fake_mcp)
    api.add_user("m@brewai.test")
    mc = api.login("m@brewai.test")
    own = mc.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp", "name": "Notes"}).json()
    assert own["handle"] == "notes"
    common = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp?v=2", "name": "Notes"}).json()
    handles = {a["id"]: a["handle"] for a in mc.get("/api/me/mcp/servers").json()["mine"]}
    assert handles == {own["id"]: "notes", common["id"]: "notes_2"}  # 전체 공통이 먼저 정렬돼도 이미 쓰던 'notes' 는 그대로
