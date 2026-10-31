"""MCP 코어 (connectors/ · ADR-0013 · slice 05) — 금고 · SSRF · 이름 · 스키마 · 결과 상한 · 순위(한글) · 목록 · 권한 표 · v3 → v4.
네트워크 없음 (SSRF 의 진짜 소켓 시험만 127.0.0.1)."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from dataclasses import replace
from types import SimpleNamespace

import httpx2
import pytest

from conductor import scopes
from conductor.auth import policy
from conductor.auth.accounts import Accounts
from conductor.auth.directory import Directory
from conductor.auth.policy import Actor, Denied, McpServerFacts, McpShareFacts, SpaceFacts
from conductor.connectors import catalog as cat
from conductor.connectors import client as mc
from conductor.connectors import rank, ssrf
from conductor.connectors.vault import Vault, VaultError, aad, generate_key, parse_key
from conductor.store import MCP_SHARE_KINDS, SCHEMA_VERSION, Store, StoreConflict

# ── 금고 ──────────────────────────────────────────────────────────────────────────


def test_vault_round_trip_and_aad_binding() -> None:
    v = Vault.ephemeral("k1")
    blob, kid = v.seal_json({"access_token": "secret-at"}, aad=aad("u1", "https://mcp.x", "https://as.x"))
    assert kid == "k1" and b"secret-at" not in blob
    assert v.open_json(blob, key_id=kid, aad=aad("u1", "https://mcp.x", "https://as.x")) == {"access_token": "secret-at"}
    for wrong in (aad("u2", "https://mcp.x", "https://as.x"), aad("u1", "https://mcp.y", "https://as.x"), aad("u1", "https://mcp.x", "https://evil")):
        with pytest.raises(VaultError) as e:
            v.open(blob, key_id=kid, aad=wrong)
        assert e.value.code == "tampered"  # 다른 줄에 옮겨 붙인 암호문은 안 열린다
    tampered = blob[:-1] + bytes([blob[-1] ^ 1])
    with pytest.raises(VaultError):
        v.open(tampered, key_id=kid, aad=aad("u1", "https://mcp.x", "https://as.x"))
    with pytest.raises(VaultError) as e:
        v.open(blob, key_id="k9", aad=b"")
    assert e.value.code == "unknown_key"
    assert aad("a|b", "c") != aad("a", "b|c")  # 칸 경계가 섞이지 않는다


def test_vault_key_rotation_and_settings() -> None:
    old_key, new_key = generate_key(), generate_key()
    old = Vault({"k1": parse_key(old_key)}, "k1")
    blob, kid = old.seal(b"refresh", aad=b"x")
    settings = SimpleNamespace(secret_key=new_key, secret_key_id="k2", secret_keys_old=(("k1", old_key),))
    v = Vault.from_settings(settings)
    assert v is not None and v.key_id == "k2"
    assert v.open(blob, key_id=kid, aad=b"x") == b"refresh" and v.needs_reseal(kid)
    assert v.seal(b"y", aad=b"")[1] == "k2"
    assert new_key not in repr(v) and "k2" in repr(v)
    assert Vault.from_settings(SimpleNamespace(secret_key=None)) is None
    assert parse_key("ab" * 32) == bytes.fromhex("ab" * 32)
    with pytest.raises(VaultError):
        parse_key("too-short")


# ── SSRF ─────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "code"),
    [
        ("http://example.com/mcp", "scheme"),
        ("ftp://example.com", "scheme"),
        ("https://user:pw@example.com/mcp", "userinfo"),
        ("https://10.0.0.5/mcp", "private_address"),
        ("https://169.254.169.254/latest", "private_address"),
        ("https://[::ffff:10.0.0.1]/", "private_address"),
        ("https://[fe80::1]/", "private_address"),
        ("https://100.64.1.1/", "private_address"),
        ("https://metadata.google.internal/", "host"),
        ("https://localhost/mcp", "private_address"),
        ("http://127.0.0.1:4014/mcp", "scheme"),
        ("https://exa mple.com", "bad_url"),
    ],
)
def test_canonical_url_rejects(raw: str, code: str) -> None:
    with pytest.raises(ssrf.Blocked) as e:
        ssrf.canonical_url(raw)
    assert e.value.code == code


def test_canonical_url_normalizes_and_loopback_only_when_allowed() -> None:
    assert ssrf.canonical_url(" HTTPS://MCP.Linear.App:443/mcp#frag ") == "https://mcp.linear.app/mcp"
    assert ssrf.canonical_url("https://example.com:8443/a?x=1") == "https://example.com:8443/a?x=1"
    assert ssrf.canonical_url("http://127.0.0.1:4014/mcp", allow_loopback=True) == "http://127.0.0.1:4014/mcp"
    assert ssrf.canonical_url("http://localhost:4014/mcp", allow_loopback=True) == "http://localhost:4014/mcp"
    with pytest.raises(ssrf.Blocked):
        ssrf.canonical_url("http://10.0.0.1/mcp", allow_loopback=True)  # loopback 만 풀린다 · 사설은 그대로 막힘
    with pytest.raises(ssrf.Blocked):
        ssrf.canonical_url("http://example.com/mcp", allow_loopback=True)  # http 는 loopback 호스트만


def test_ip_table() -> None:
    blocked = ["10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "224.0.0.1", "100.64.0.1", "::1",
               "fe80::1", "fc00::1", "::ffff:192.168.0.1", "2002:c0a8:0101::1", "64:ff9b::a00:1", "127.0.0.1"]
    for ip in blocked:
        assert ssrf.ip_blocked(ip), ip
    for ip in ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "64:ff9b::808:808"]:
        assert not ssrf.ip_blocked(ip), ip
    assert not ssrf.ip_blocked("127.0.0.1", allow_loopback=True) and ssrf.ip_blocked("10.0.0.1", allow_loopback=True)


@pytest.mark.anyio
async def test_resolve_blocks_private_and_mixed_answers() -> None:
    async def private(host: str, port: int) -> list[str]:
        return ["10.0.0.7"]

    async def mixed(host: str, port: int) -> list[str]:  # rebinding · split-horizon: 하나라도 막히면 전부 거부
        return ["93.184.216.34", "127.0.0.1"]

    async def public(host: str, port: int) -> list[str]:
        return ["93.184.216.34"]

    for r in (private, mixed):
        with pytest.raises(ssrf.Blocked) as e:
            await ssrf.resolve("evil.example", 443, allow_loopback=False, resolver=r)
        assert e.value.code == "private_address"
    assert await ssrf.resolve("ok.example", 443, allow_loopback=False, resolver=public) == ["93.184.216.34"]


async def _serve_once(body: bytes = b"ok") -> tuple[asyncio.AbstractServer, int]:
    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        await reader.readuntil(b"\r\n\r\n")
        writer.write(b"HTTP/1.1 200 OK\r\ncontent-length: %d\r\nconnection: close\r\n\r\n%s" % (len(body), body))
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    return server, server.sockets[0].getsockname()[1]


@pytest.mark.anyio
async def test_pinned_client_connects_only_to_checked_ip() -> None:
    server, port = await _serve_once()
    calls: list[str] = []

    async def rebinding(host: str, port_: int) -> list[str]:
        calls.append(host)  # 처음 = loopback(테스트 서버) · 두 번째부터 = 사설 (검사 뒤 다시 풀면 뚫린다)
        return ["127.0.0.1"] if len(calls) == 1 else ["10.0.0.1"]

    try:
        async with ssrf.http_client(allow_loopback=True, resolver=rebinding) as http:
            res = await http.get(f"http://rebind.localhost.test:{port}/")  # 이름은 아무거나 · 접속은 풀어 본 IP 로
            assert res.status_code == 200 and res.text == "ok"
        assert calls == ["rebind.localhost.test"]  # 접속마다 한 번만 푼다 = 검사한 IP 로만
        async with ssrf.http_client(allow_loopback=False) as http:
            with pytest.raises(httpx2.ConnectError):
                await http.get(f"http://127.0.0.1:{port}/")  # loopback 금지 = 접속 전에 막힘
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.anyio
async def test_fetch_rechecks_redirects() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        if request.url.path == "/start":
            return httpx2.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data"})
        return httpx2.Response(200)

    async with ssrf.http_client(allow_loopback=False, transport=httpx2.MockTransport(handler)) as http:
        with pytest.raises(ssrf.Blocked) as e:
            await ssrf.fetch(http, "GET", "https://ok.example/start", allow_loopback=False)
        assert e.value.code == "scheme"


def test_host_allowlist() -> None:
    assert ssrf.host_allowed("https://mcp.linear.app/mcp", [])
    assert ssrf.host_allowed("https://mcp.linear.app/mcp", ["*.linear.app"])
    assert not ssrf.host_allowed("https://linear.app/mcp", ["*.linear.app"])
    assert ssrf.host_allowed("https://linear.app/mcp", ["linear.app"])
    assert not ssrf.host_allowed("https://evil.app/mcp", ["linear.app", "*.notion.com"])


# ── 이름 · 스키마 · 결과 ─────────────────────────────────────────────────────────────


def test_tool_names_are_safe_and_reversible() -> None:
    assert mc.tool_name("linear", "list_issues") == "linear__list_issues"
    long = "x" * 80
    weird = "issues.search/v2 (beta)"
    names = [mc.tool_name("github_issues", t) for t in (long, weird, "a" * 50, "a" * 51)]
    for n in names:
        assert mc.NAME_RE.match(n) and len(n) <= 64 and n.startswith("github_issues__")
    assert len(set(names)) == 4  # 해시로 겹치지 않는다
    m = mc.NameMap.of("github_issues", [long, weird, "list"])
    assert m.original(m.public(weird)) == weird and m.public("list") == "github_issues__list"
    assert mc.split_public("linear__list_issues") == ("linear", "list_issues")
    assert mc.split_public("nohandle") is None
    assert not cat.valid_handle("a__b") and not cat.valid_handle("_a") and cat.valid_handle("github_issues")


def test_trim_tool_drops_noise_keeps_property_named_title() -> None:
    raw = {
        "name": "create_page", "description": "D" * 900, "title": "Create page",
        "inputSchema": {"$schema": "x", "title": "Args", "type": "object", "examples": [1], "properties": {
            "title": {"type": "string", "title": "Title", "description": "p" * 500},
            "nested": {"type": "object", "properties": {"x": {"type": "string", "examples": ["a"]}}},
        }},
        "annotations": {"readOnlyHint": False},
    }
    t = mc.trim_tool(raw)
    assert t is not None and t.write and t.title == "Create page"
    assert "$schema" not in t.input_schema and "title" not in t.input_schema and "examples" not in t.input_schema
    assert set(t.input_schema["properties"]) == {"title", "nested"}  # 'title' 이라는 속성은 남는다
    assert "title" not in t.input_schema["properties"]["title"]
    assert len(t.input_schema["properties"]["title"]["description"]) == mc.PROP_DESC_MAX
    assert len(t.description) == mc.DESC_MAX and t.tokens_est > 0
    assert "examples" not in t.input_schema["properties"]["nested"]["properties"]["x"]
    assert mc.trim_tool({"name": ""}) is None
    assert not mc.trim_tool({"name": "search_issues"}).write  # type: ignore[union-attr]
    assert mc.trim_tool({"name": "createIssue"}).write  # type: ignore[union-attr]
    assert mc.trim_tool({"name": "issue_delete"}).write  # type: ignore[union-attr]
    assert not mc.trim_tool({"name": "delete_x", "annotations": {"readOnlyHint": True}}).write  # type: ignore[union-attr]


def test_cap_result() -> None:
    small = mc.cap_result({"a": 1})
    assert small == {"result": {"a": 1}}
    rows = [{"id": i, "title": "x" * 60} for i in range(1000)]
    capped = mc.cap_result(rows)
    assert capped["truncated"] and capped["omitted"] > 0 and "나머지" in capped["note"]
    assert len(json.dumps(capped, ensure_ascii=False).encode()) <= mc.MAX_RESULT_BYTES
    assert len(capped["result"]) + capped["omitted"] == 1000
    wrapped = mc.cap_result({"issues": rows, "total": 1000})
    assert wrapped["result"]["total"] == 1000 and wrapped["omitted"] > 0
    text = mc.cap_result("가" * 20000)
    assert text["truncated"] and text["omitted_bytes"] > 0 and len(json.dumps(text, ensure_ascii=False).encode()) <= mc.MAX_RESULT_BYTES
    assert mc.cap_result("boom", is_error=True) == {"error": "tool_error", "message": "boom"}


# ── 순위 (한글) ─────────────────────────────────────────────────────────────────


def _tools() -> list[mc.Tool]:
    raw = [
        ("list_issues", "List issues in a team.", False), ("search_issues", "Search issues by text query.", False),
        ("get_issue", "Get one issue by id.", False), ("create_issue", "Create a new issue.", True),
        ("update_issue", "Update an issue.", True), ("delete_issue", "Delete an issue.", True),
        ("list_projects", "List projects.", False), ("create_comment", "Add a comment to an issue.", True),
        ("list_users", "List users.", False), ("get_document", "Get a document page.", False),
    ]
    return [mc.Tool(name=n, description=d, input_schema={"type": "object", "properties": {}}, write=w) for n, d, w in raw]


def test_korean_need_finds_english_tools() -> None:
    tools = _tools()
    assert rank.rank_tools(tools, "이슈 검색해줘", k=4)[0].name == "search_issues"
    top = [t.name for t in rank.rank_tools(tools, "새 이슈 하나 만들어줘", k=4)]
    assert top[0] == "create_issue"  # 쓰기도 허용 (요청이 쓰기면 쓰기 도구가 먼저)
    reads = [t.name for t in rank.rank_tools(tools, "이슈", k=4)]
    assert reads[:3] == ["list_issues", "search_issues", "get_issue"]  # 같은 점수면 읽기 먼저 · 원래 순서
    assert [t.name for t in rank.rank_tools(tools, "댓글 달아줘", k=1)] == ["create_comment"]
    assert rank.rank_tools(tools, "문서 페이지 보여줘", k=1)[0].name == "get_document"
    # 별칭 (관리자 · 서버) = 한글 bigram
    aliased = rank.rank_tools(tools, "사용자 명단", k=1, aliases={"list_users": ["사용자 명단", "구성원"]})
    assert aliased[0].name == "list_users"
    # 결정적 = 같은 need → 같은 목록 (프롬프트 캐시)
    assert rank.rank_tools(tools, "이슈 검색", k=4) == rank.rank_tools(tools, "이슈 검색", k=4)


def test_rank_always_hidden_and_fallback() -> None:
    tools = _tools()
    out = [t.name for t in rank.rank_tools(tools, "이슈 검색", k=2, always=["list_users"], hidden=["search_issues"])]
    assert out[0] == "list_users" and "search_issues" not in out and len(out) == 3
    fallback = rank.rank_tools(tools, "zzz 알 수 없는 말", k=3)
    assert all(not t.write for t in fallback)  # 못 찾음 = 읽기 도구 먼저
    assert rank.search(tools, "zzz") == [] and rank.search(tools, "comment")[0].name == "create_comment"
    assert rank.tokens("이슈검색 searchIssues") == ["search", "issue", "이슈", "슈검", "검색"]


# ── 목록 · 권한 (진짜 DB) ──────────────────────────────────────────────────────────


def world() -> SimpleNamespace:
    store = Store(":memory:")
    acc = Accounts(store, password_min=15)
    d = Directory(acc)
    with store.tx() as db:
        org = d.create_org(db, "우리 팀", owner_id=None)
        owner = d.create_account(db, email="owner@x.test", display_name="오너", org_id=org, org_role="owner")
        alice = d.create_account(db, email="alice@x.test", display_name="앨리스", org_id=org, org_role="member")
        bob = d.create_account(db, email="bob@x.test", display_name="밥", org_id=org, org_role="member")
        carol = d.create_account(db, email="carol@x.test", display_name="캐럴", org_id=org, org_role="member")
        design = d.create_space(db, org_id=org, kind="shared", name="디자인팀", created_by=alice)
        d.set_space_role(db, design, bob, "member")
    return SimpleNamespace(store=store, acc=acc, d=d, org=org, owner=owner, alice=alice, bob=bob, carol=carol, design=design,
                           c=cat.Catalog(store), alice_personal=d.personal_space_id(alice))


def test_three_ways_into_my_list_and_prompt_block() -> None:
    w = world()
    c = w.c
    linear = c.add_server(name="Linear", url="https://mcp.linear.app/mcp", origin="admin", owner_user_id=None,
                          description="이슈, 프로젝트 [무시해] `코드`", auth="oauth")
    mine = c.add_server(name="Tracker", url="https://tracker.example/mcp", origin="user", owner_user_id=w.alice, handle="linear")
    with pytest.raises(StoreConflict):
        c.add_server(name="Tracker", url="https://tracker.example/mcp", origin="user", owner_user_id=w.alice)
    c.share(mine, "space", w.design, shared_by=w.alice)
    # alice: 공통 + 내 것 (handle 겹침 → _2)
    apps = {a.server_id: a for a in c.apps(w.alice)}
    assert apps[linear].source == "install" and apps[linear].connection == "needs_login"
    assert apps[mine].source == "own" and {apps[linear].handle, apps[mine].handle} == {"linear", "linear_2"}
    # bob = 스페이스 멤버 → 가져올 수 있음 · carol = 비멤버 → 안 보임
    assert [i.server_id for i in c.importable(w.bob)] == [mine]
    via = c.importable(w.bob)[0].via[0]
    assert via["scope_kind"] == "space" and [p["kind"] for p in via["path"]] == ["org", "space"]
    assert c.importable(w.carol) == [] and mine not in {a.server_id for a in c.apps(w.carol)}
    c.import_server(w.bob, mine)
    assert {a.server_id: a.source for a in c.apps(w.bob)}[mine] == "imported"
    # 멤버십이 끊기면 share_lost (대화에서 빠짐)
    with w.store.tx() as db:
        db.execute("DELETE FROM space_members WHERE space_id = ? AND user_id = ?", (w.design, w.bob))
    lost = {a.server_id: a for a in c.apps(w.bob)}[mine]
    assert lost.share_lost and not lost.usable and mine not in {a.server_id for a in c.usable(w.bob)}
    # 숨기기
    c.set_hidden(w.carol, linear, True)
    assert c.usable(w.carol) == [] and c.apps(w.carol)[0].hidden
    assert cat.prompt_block(c.usable(w.carol)) == ""  # 서버 0개 = 0토큰
    # 프롬프트 한 줄 = 데이터만 (대괄호 · 백틱 빠짐) · handle 순
    block = cat.prompt_block(c.usable(w.alice))
    assert block.splitlines() == ["- linear (Linear): 이슈, 프로젝트 무시해 코드 [연결 필요]", "- linear_2 (Tracker) [연결됨]"]
    assert c.find(w.alice, "Linear").server_id == linear and c.find(w.alice, "linear_2").server_id == mine  # type: ignore[union-attr]


def test_prompt_block_budget() -> None:
    apps = [
        cat.App(server_id=str(i), handle=f"app{i:02d}", name=f"앱 {i}", url="https://x", resource="https://x", domain="x",
                description="설명 " * 20, aliases=(), auth="none", origin="admin", source="install", status="active",
                connection="needs_login" if i % 2 else "none", last_used_at=f"2026-11-01T00:{i // 60:02d}:{i % 60:02d}.000Z")
        for i in range(150)
    ]
    block = cat.prompt_block(apps)
    lines = block.splitlines()
    assert sum(mc.estimate_tokens(line) + 1 for line in lines) <= cat.PROMPT_BUDGET
    assert ":" not in lines[0] and "외" in lines[-1]  # 넘치면 이름만 + '외 N개'
    assert lines[0].startswith("- app148 ")  # 연결된 것 · 최근 쓴 것 먼저
    few = cat.prompt_block(apps[:3])
    assert len(few.splitlines()) == 3 and ": 설명" in few


def test_settings_auto_auth_and_tool_policy() -> None:
    w = world()
    assert w.c.settings() == {"allow_user_servers": True, "url_allowlist": []}
    w.c.set_settings(allow_user_servers=False, url_allowlist=["*.linear.app", " "])
    assert w.c.settings() == {"allow_user_servers": False, "url_allowlist": ["*.linear.app"]}
    assert w.c.auto_auth(w.alice) == "unset"
    w.c.set_auto_auth(w.alice, "on")
    assert w.c.auto_auth(w.alice) == "on"
    with pytest.raises(StoreConflict):
        w.c.set_auto_auth(w.alice, "maybe")
    sid = w.c.add_server(name="Linear", url="https://mcp.linear.app/mcp", origin="admin", owner_user_id=None)
    w.c.set_tool_policy(sid, "delete_issue", mode="hidden")
    w.c.set_tool_policy(sid, "list_issues", always_reveal=True, aliases=["이슈 목록"])
    assert w.c.tool_policy(sid) == {"delete_issue": {"mode": "hidden", "always_reveal": False, "aliases": []},
                                    "list_issues": {"mode": "auto", "always_reveal": True, "aliases": ["이슈 목록"]}}
    assert w.c.connected_count("https://mcp.linear.app/mcp") == 0


def _space(kind: str = "shared", *, role: str | None = "member", org_role: str | None = "member", archived: bool = False) -> SpaceFacts:
    return SpaceFacts(id="s1", org_id="o1", kind=kind, owner_user_id="u1" if kind == "personal" else None, visibility="private",  # type: ignore[arg-type]
                      archived=archived, direct_role=role, org_role=org_role)  # type: ignore[arg-type]


def _denied(fn, *args) -> tuple[int, str] | None:  # noqa: ANN001
    try:
        fn(*args)
    except Denied as e:
        return e.status, e.code
    return None


def test_policy_table() -> None:
    me, admin = Actor("u1"), Actor("adm", instance_admin=True)
    other = Actor("u2")
    mine = McpServerFacts(id="m", origin="user", owner_user_id="u1")
    common = McpServerFacts(id="c", origin="admin", owner_user_id=None, shares=(McpShareFacts("install", "*", auto_include=True),))
    # 만들기
    assert _denied(lambda: policy.require_mcp_add(me, origin="user", allow_user_servers=True)) is None
    assert _denied(lambda: policy.require_mcp_add(me, origin="user", allow_user_servers=False)) == (403, "user_servers_disabled")
    assert _denied(lambda: policy.require_mcp_add(me, origin="user", allow_user_servers=True, url_allowed=False)) == (403, "url_not_allowed")
    assert _denied(lambda: policy.require_mcp_add(me, origin="admin", allow_user_servers=True)) == (403, "forbidden")
    assert _denied(lambda: policy.require_mcp_add(admin, origin="admin", allow_user_servers=False)) is None
    # 고치기 · 지우기 = 주인 · 관리자 서버 = instance admin · 남의 개인 서버 = 404
    assert _denied(policy.require_mcp_edit, me, mine) is None
    assert _denied(policy.require_mcp_edit, other, mine) == (404, "mcp_server_not_found")
    assert _denied(policy.require_mcp_edit, me, common) == (403, "forbidden")
    assert _denied(policy.require_mcp_edit, admin, common) is None
    assert _denied(policy.require_mcp_disable, me, common) == (403, "forbidden") and _denied(policy.require_mcp_disable, admin, mine) is None
    # 공유: 스페이스 = 그 스페이스 멤버 · 조직 = owner·admin 만 (사용자 결정) · install = instance admin · 개인 스페이스 = 안 됨
    assert _denied(policy.require_mcp_share, me, mine, McpShareFacts("space", "s1", space=_space())) is None
    assert _denied(policy.require_mcp_share, me, mine, McpShareFacts("space", "s1", space=_space(role=None))) == (404, "space_not_found")
    assert _denied(policy.require_mcp_share, me, mine, McpShareFacts("space", "s1", space=_space("personal", role="admin"))) == (404, "space_not_found")
    assert _denied(policy.require_mcp_share, me, mine, McpShareFacts("space", "s1", space=_space(archived=True))) == (409, "space_archived")
    assert _denied(policy.require_mcp_share, me, mine, McpShareFacts("org", "o1", org_role="member")) == (403, "forbidden")
    assert _denied(policy.require_mcp_share, me, mine, McpShareFacts("org", "o1", org_role="admin")) is None
    assert _denied(policy.require_mcp_share, me, mine, McpShareFacts("install", "*")) == (403, "forbidden")
    assert _denied(policy.require_mcp_share, other, mine, McpShareFacts("space", "s1", space=_space())) == (404, "mcp_server_not_found")
    # 가져오기 = 공유 범위 멤버 · 주인 아님 · 한 번만 · 켜진 서버
    shared = replace(mine, shares=(McpShareFacts("space", "s1", space=_space()),))
    assert _denied(policy.require_mcp_import, other, shared) is None
    assert _denied(policy.require_mcp_import, other, replace(shared, shares=(McpShareFacts("space", "s1", space=_space(role=None)),))) == (404, "mcp_server_not_found")
    assert _denied(policy.require_mcp_import, other, replace(shared, imported=True)) == (409, "already_imported")
    assert _denied(policy.require_mcp_import, me, shared) == (409, "already_listed")
    assert _denied(policy.require_mcp_import, other, replace(shared, status="disabled")) == (409, "server_disabled")
    # 공유 끊기 = 주인 · space admin · 조직 owner/admin
    assert _denied(policy.require_mcp_unshare, other, shared, McpShareFacts("space", "s1", space=_space(role="admin"))) is None
    assert _denied(policy.require_mcp_unshare, other, shared, McpShareFacts("space", "s1", space=_space())) == (403, "forbidden")
    assert _denied(policy.require_mcp_unshare, other, shared, McpShareFacts("org", "o1", org_role="owner")) is None
    # 쓰기 = 보이고 · 숨기지 않았고 · 켜짐 · 가져오기 전이면 409 needs_import (카드 D)
    assert _denied(policy.require_mcp_use, other, common) is None
    assert _denied(policy.require_mcp_use, other, replace(common, hidden=True)) == (409, "server_hidden")
    assert _denied(policy.require_mcp_use, other, replace(common, status="disabled")) == (409, "server_disabled")
    assert _denied(policy.require_mcp_use, other, shared) == (409, "needs_import")
    assert _denied(policy.require_mcp_use, other, replace(shared, imported=True)) is None
    assert _denied(policy.require_mcp_use, Actor("u3"), mine) == (404, "mcp_server_not_found")


def test_share_kinds_come_from_scopes() -> None:
    assert MCP_SHARE_KINDS == cat.SHARE_KINDS == scopes.share_kinds()
    assert MCP_SHARE_KINDS[0] == scopes.INSTALL and MCP_SHARE_KINDS[-1] == scopes.MEMBERSHIP


# ── v3 → v4 ─────────────────────────────────────────────────────────────────────


def test_v3_database_is_backed_up_and_migrated(tmp_path) -> None:
    path = tmp_path / "conductor.sqlite3"
    Store(path).close()
    db = sqlite3.connect(path)
    # v3 모양으로 되돌린다: mcp 표 없음 · users · runs 새 칸 없음 · one_time_tokens 옛 CHECK
    tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'mcp_%'")]
    db.executescript(
        "".join(f"DROP TABLE {t};" for t in tables)
        + "ALTER TABLE users DROP COLUMN mcp_auto_auth; ALTER TABLE runs DROP COLUMN pending_json; DROP TABLE one_time_tokens;"
        "CREATE TABLE one_time_tokens (hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('handoff', 'reset', 'oauth_flow', 'link')),"
        " user_id TEXT REFERENCES users (id) ON DELETE CASCADE, data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,"
        " expires_at TEXT NOT NULL, used_at TEXT);"
        "INSERT INTO users (id, email, email_norm, display_name, created_at) VALUES ('u1', 'a@x.test', 'a@x.test', 'A', '2026-10-31T00:00:00.000Z');"
        "INSERT INTO one_time_tokens (hash, kind, user_id, created_at, expires_at) VALUES ('h1', 'reset', 'u1', '2026-10-31T00:00:00.000Z', '2099-01-01T00:00:00.000Z');"
        "PRAGMA user_version = 3;"
    )
    db.close()
    store = Store(path)
    bak = sqlite3.connect(tmp_path / "conductor.sqlite3.v3.bak")
    assert bak.execute("PRAGMA user_version").fetchone()[0] == 3
    assert bak.execute("SELECT name FROM sqlite_master WHERE name = 'mcp_servers'").fetchone() is None
    bak.close()
    assert store.query("PRAGMA user_version")[0][0] == SCHEMA_VERSION == 4
    assert store.query("SELECT mcp_auto_auth FROM users WHERE id = 'u1'")[0][0] == "unset"
    assert "pending_json" in {r["name"] for r in store.query("PRAGMA table_info(runs)")}
    assert store.query("SELECT kind FROM one_time_tokens WHERE hash = 'h1'")[0][0] == "reset"  # 줄은 그대로 옮겨진다
    acc = Accounts(store, password_min=15)
    code = acc.issue_once("mcp_handoff", 60, prefix="bwm_", user_id="u1")
    assert acc.consume_once("mcp_handoff", code) == ("u1", {})
    have = {r["name"] for r in store.query("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"mcp_servers", "mcp_server_shares", "mcp_user_servers", "mcp_tool_policy", "mcp_credentials", "mcp_oauth_clients",
            "mcp_oauth_flows", "mcp_tool_cache"} <= have
    with pytest.raises(sqlite3.IntegrityError):  # scope_kind = 계층 표 밖이면 거부
        with store.tx() as tx:
            tx.execute("INSERT INTO mcp_servers (id, handle, name, url, resource, origin, created_at, updated_at)"
                       " VALUES ('s', 'ab', 'A', 'https://a', 'https://a', 'admin', 'x', 'x')")
            tx.execute("INSERT INTO mcp_server_shares (server_id, scope_kind, scope_id, created_at) VALUES ('s', 'project', 'p', 'x')")
    store.close()
    again = Store(path)  # 다시 켜도 그대로 (백업도 첫 것 그대로)
    assert again.query("SELECT COUNT(*) FROM one_time_tokens")[0][0] == 2
    again.close()


def test_tool_cache_round_trip() -> None:
    w = world()
    sid = w.c.add_server(name="Open", url="https://open.example/mcp", origin="admin", owner_user_id=None)
    cache = mc.ToolCache(w.store)
    tools = [mc.trim_tool({"name": "echo", "description": "Echo"})]
    cache.put(sid, mc.ToolCache.SHARED, tools)  # type: ignore[list-item]
    got = cache.get(sid, "*")
    assert got is not None and got.fresh and got.tools[0].name == "echo"
    row = w.c.server(sid)
    assert row["tool_count"] == 1 and row["tool_tokens_est"] == got.tokens_est  # type: ignore[index]
    from datetime import UTC, datetime, timedelta

    later = mc.ToolCache(w.store, clock=lambda: datetime.now(UTC) + timedelta(minutes=11))
    assert later.get(sid, "*") is None and later.get(sid, "*", stale_ok=True) is not None
    cache.invalidate(sid)
    assert cache.get(sid, "*") is None


def test_settings_secret_key_and_loopback_rule() -> None:
    from conductor.settings import load_settings

    base = {"LLM_GATEWAY_KEY": "sk-x"}
    s = load_settings({**base, "CONDUCTOR_SECRET_KEY": " " + generate_key() + " ", "CONDUCTOR_SECRET_KEYS_OLD": "k0:abc, bad ,k-1:def"})
    assert s.secret_key and s.secret_key_id == "k1" and s.secret_keys_old == (("k0", "abc"), ("k-1", "def"))
    assert "secret" not in repr(s).lower() or s.secret_key not in repr(s)  # 키는 repr 에 안 보인다
    assert not load_settings({**base, "CONDUCTOR_MCP_ALLOW_LOOPBACK": "1", "CONDUCTOR_PUBLIC_URL": "https://brewai.example"}).mcp_loopback_ok
    assert load_settings({**base, "CONDUCTOR_MCP_ALLOW_LOOPBACK": "1"}).mcp_loopback_ok  # 기본 공개 주소 = 127.0.0.1
    assert load_settings({**base, "CONDUCTOR_MCP_ALLOW_LOOPBACK": "1", "BREWAI_E2E": "1", "CONDUCTOR_PUBLIC_URL": "https://x.example"}).mcp_loopback_ok
    assert not load_settings(base).mcp_loopback_ok and load_settings(base).secret_key is None


@pytest.mark.anyio
async def test_mcp_client_refuses_private_targets() -> None:
    async def private(host: str, port: int) -> list[str]:
        return ["10.0.0.9"]

    client = mc.McpClient(resolver=private, timeout_s=5)
    with pytest.raises(mc.McpError) as e:
        await client.list_tools("https://internal.example/mcp")  # 이름은 공인처럼 · 풀면 사설 = 접속 전에 막힘
    assert (e.value.code, e.value.detail) == ("blocked", "private_address")
    with pytest.raises(mc.McpError) as e:
        await client.list_tools("http://127.0.0.1:9/mcp")
    assert (e.value.code, e.value.detail) == ("blocked", "scheme")
