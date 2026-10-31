"""MCP 앱 로그인 · 연결 (connectors/oauth.py · client.py) — 가짜 MCP + 가짜 OAuth 서버 (tests/fake_mcp.py · httpx2.MockTransport).

PRM → AS 메타데이터 → DCR → start(PKCE · resource) → callback(state 1회 · iss) → handoff → complete(시작한 사람 · ds · verifier)
→ 암호문 저장 → tools/list · tools/call → 만료 60초 전 refresh (한 번만) → invalid_grant = 다시 로그인 · scope 올리기 · 연결 끊기.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest

from conductor.auth import tokens
from conductor.auth.accounts import Accounts
from conductor.auth.directory import Directory
from conductor.connectors import catalog as cat
from conductor.connectors.client import McpClient, NeedsAuth
from conductor.connectors.oauth import OAuth, OAuthError
from conductor.connectors.vault import Vault
from conductor.store import Store

PUBLIC = "http://127.0.0.1:8787"


class Clock:
    def __init__(self) -> None:
        self.t = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += timedelta(seconds=seconds)


def setup(fake_mcp: Any, **fake_kw: Any) -> SimpleNamespace:
    fake = fake_mcp.Fake(**fake_kw)
    store = Store(":memory:")
    acc = Accounts(store, password_min=15)
    clock = Clock()
    acc.clock = clock
    d = Directory(acc)
    with store.tx() as db:
        org = d.create_org(db, "우리 팀", owner_id=None)
        alice = d.create_account(db, email="alice@x.test", display_name="앨리스", org_id=org, org_role="member")
        bob = d.create_account(db, email="bob@x.test", display_name="밥", org_id=org, org_role="member")
    c = cat.Catalog(store)
    server = c.add_server(name="Tracker", url=f"{fake_mcp.MCP}/mcp", origin="admin", owner_user_id=None, auth="oauth")
    vault = Vault.ephemeral()
    oauth = OAuth(store, vault, acc, public_url=PUBLIC, transport=fake.transport)
    mcp = McpClient(transport=fake.transport)
    return SimpleNamespace(fake=fake, store=store, acc=acc, clock=clock, alice=alice, bob=bob, c=c, server=server, oauth=oauth, mcp=mcp,
                           vault=vault, url=f"{fake_mcp.MCP}/mcp", m=fake_mcp)


def desktop() -> tuple[str, str, str]:
    """데스크톱 main 이 만드는 것: ds · PKCE verifier · challenge."""
    verifier = secrets.token_urlsafe(48)
    return secrets.token_urlsafe(16), verifier, tokens.s256(verifier)


async def connect(w: SimpleNamespace, user: str, *, account: str = "alice", port: int = 50123) -> Any:
    ds, verifier, cc = desktop()
    started = await w.oauth.start(user_id=user, server_id=w.server, url=w.url, port=port, ds=ds, cc=cc)
    back = w.fake.authorize(started.authorize_url, account=account)
    cb = await w.oauth.callback(state=back["state"], code=back["code"], iss=back.get("iss"))
    assert cb.code and cb.redirect and cb.redirect.startswith(f"http://127.0.0.1:{port}/cb?code=bwm_")
    return w.oauth.complete(user_id=user, code=cb.code, ds=ds, code_verifier=verifier)


@pytest.mark.anyio
async def test_full_flow_then_tools(fake_mcp: Any, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    w = setup(fake_mcp)
    # 연결 전 = 401 → NeedsAuth (WWW-Authenticate 의 PRM 주소 · scope)
    with pytest.raises(NeedsAuth) as e:
        await w.mcp.list_tools(w.url)
    assert e.value.reason == "not_connected" and e.value.resource_metadata and e.value.scope == "issues:read"
    ds, verifier, cc = desktop()
    started = await w.oauth.start(user_id=w.alice, server_id=w.server, url=w.url, port=50123, ds=ds, cc=cc,
                                  resource_metadata=e.value.resource_metadata)
    assert started.resource == w.m.MCP and started.issuer == w.m.AS  # PRM resource = 같은 주소의 모든 항목이 쓰는 열쇠
    q = w.m.query_of(started.authorize_url)
    assert q["code_challenge_method"] == "S256" and q["resource"] == w.m.MCP and q["redirect_uri"] == f"{PUBLIC}/api/mcp/oauth/callback"
    assert q["scope"] == "issues:read" and w.fake.registrations == 1  # DCR 한 번
    back = w.fake.authorize(started.authorize_url, account="alice")
    cb = await w.oauth.callback(state=back["state"], code=back["code"], iss=back["iss"])
    assert cb.code and cb.server_id == w.server
    again = await w.oauth.callback(state=back["state"], code=back["code"], iss=back["iss"])
    assert again.port is None and again.error == "state_invalid"  # state 는 1회
    done = w.oauth.complete(user_id=w.alice, code=cb.code, ds=ds, code_verifier=verifier)
    assert done.resource == w.m.MCP
    # 저장 = 암호문만 (DB 를 통째로 훑어도 토큰 글자가 없다)
    issued = [t for t, v in w.fake.access.items() if v["account"] == "alice"]
    dump = "\n".join(w.store._db.iterdump())
    assert issued and all(t not in dump for t in issued) and all(r not in dump for r in w.fake.refresh)
    assert w.c.apps(w.alice)[0].connection == "connected" and w.c.apps(w.bob)[0].connection == "needs_login"
    token = await w.oauth.access_token(w.alice, w.m.MCP)
    tools = await w.mcp.list_tools(w.url, token=token)
    assert len(tools) == 20 and sum(t.write for t in tools) == 8  # 3쪽 (8 · 8 · 4) 을 다 받는다 · 쓰기 표시
    res = await w.mcp.call_tool(w.url, "search_issues", {"query": "버그"}, token=token)
    assert res["result"]["account"] == "alice"
    audit = [r["action"] for r in w.store.query("SELECT action FROM audit_events")]
    assert "mcp.connect" in audit
    assert not any(t in rec.getMessage() for rec in caplog.records for t in issued)  # 로그에 토큰 0


@pytest.mark.anyio
async def test_each_user_logs_in_with_own_account(fake_mcp: Any) -> None:
    w = setup(fake_mcp)
    await connect(w, w.alice, account="alice")
    await connect(w, w.bob, account="bob")
    assert w.fake.registrations == 1  # client 는 (issuer, redirect_uri) 하나 · 사람마다 등록하지 않는다
    ta, tb = await w.oauth.access_token(w.alice, w.m.MCP), await w.oauth.access_token(w.bob, w.m.MCP)
    assert ta != tb
    await w.mcp.call_tool(w.url, "list_issues", {}, token=tb)
    assert w.fake.calls[-1] == ("bob", "list_issues")  # 공유자 토큰을 안 쓴다


@pytest.mark.anyio
async def test_complete_checks_user_ds_and_verifier(fake_mcp: Any) -> None:
    w = setup(fake_mcp)

    async def handoff() -> tuple[str, str, str]:
        ds, verifier, cc = desktop()
        started = await w.oauth.start(user_id=w.alice, server_id=w.server, url=w.url, port=50123, ds=ds, cc=cc)
        back = w.fake.authorize(started.authorize_url)
        cb = await w.oauth.callback(state=back["state"], code=back["code"], iss=back["iss"])
        return cb.code, ds, verifier

    code, ds, verifier = await handoff()
    with pytest.raises(OAuthError) as e:
        w.oauth.complete(user_id=w.bob, code=code, ds=ds, code_verifier=verifier)  # 남이 시작한 흐름 = 안 붙는다
    assert e.value.code == "wrong_user"
    with pytest.raises(OAuthError) as e:
        w.oauth.complete(user_id=w.alice, code=code, ds=ds, code_verifier=verifier)
    assert e.value.code == "handoff_invalid"  # handoff 는 1회 (위에서 이미 씀)
    code, ds, verifier = await handoff()
    with pytest.raises(OAuthError) as e:
        w.oauth.complete(user_id=w.alice, code=code, ds="different-ds-value", code_verifier=verifier)
    assert e.value.code == "ds_mismatch"
    code, ds, verifier = await handoff()
    with pytest.raises(OAuthError) as e:
        w.oauth.complete(user_id=w.alice, code=code, ds=ds, code_verifier=secrets.token_urlsafe(48))
    assert e.value.code == "verifier_mismatch"
    code, ds, verifier = await handoff()
    w.clock.advance(61)  # handoff 60초
    with pytest.raises(OAuthError) as e:
        w.oauth.complete(user_id=w.alice, code=code, ds=ds, code_verifier=verifier)
    assert e.value.code == "handoff_invalid"
    assert w.oauth.status(w.alice, w.m.MCP) is None


@pytest.mark.anyio
async def test_callback_iss_rules_and_errors(fake_mcp: Any) -> None:
    w = setup(fake_mcp)

    async def begin() -> str:
        ds, _, cc = desktop()
        return (await w.oauth.start(user_id=w.alice, server_id=w.server, url=w.url, port=50123, ds=ds, cc=cc)).authorize_url

    back = w.fake.authorize(await begin(), iss="https://evil.example")
    assert (await w.oauth.callback(state=back["state"], code=back["code"], iss=back["iss"])).error == "iss_mismatch"
    back = w.fake.authorize(await begin(), iss=None)  # 광고한 AS 인데 iss 가 없다
    assert (await w.oauth.callback(state=back["state"], code=back["code"], iss=None)).error == "iss_missing"
    back = w.fake.authorize(await begin(), deny=True)
    cb = await w.oauth.callback(state=back["state"], error=back["error"], iss=back["iss"])
    assert cb.error == "cancelled" and cb.redirect == "http://127.0.0.1:50123/cb?error=cancelled"
    url = await begin()
    back = w.fake.authorize(url)
    w.clock.advance(601)  # 흐름 10분
    assert (await w.oauth.callback(state=back["state"], code=back["code"], iss=back["iss"])).error == "state_invalid"
    assert (await w.oauth.callback(state="", code="x")).port is None


@pytest.mark.anyio
async def test_refresh_is_single_flight_and_rotates(fake_mcp: Any) -> None:
    w = setup(fake_mcp, access_ttl=600)
    await connect(w, w.alice)
    first = await w.oauth.access_token(w.alice, w.m.MCP)
    w.clock.advance(600 - 30)  # 만료 30초 전 = 60초 창 안
    got = await asyncio.gather(*(w.oauth.access_token(w.alice, w.m.MCP) for _ in range(5)))
    assert w.fake.refresh_requests == 1 and len(set(got)) == 1 and got[0] != first  # 다섯 요청이 refresh 하나를 나눠 쓴다
    assert len(w.fake.refresh) == 1  # 회전 = 옛 refresh 는 사라지고 새 것 하나 (저장도 새 것 → 다음 refresh 가 된다)
    w.clock.advance(600)
    assert await w.oauth.access_token(w.alice, w.m.MCP) not in got and w.fake.refresh_requests == 2
    tools = await w.mcp.list_tools(w.url, token=got[0])
    assert len(tools) == 20


@pytest.mark.anyio
async def test_revoked_refresh_means_login_again(fake_mcp: Any) -> None:
    w = setup(fake_mcp, access_ttl=600)
    await connect(w, w.alice)
    w.fake.revoke_refresh()
    w.fake.expire_all()
    w.clock.advance(700)
    with pytest.raises(NeedsAuth) as e:
        await w.oauth.access_token(w.alice, w.m.MCP)
    assert e.value.reason == "expired" and w.oauth.status(w.alice, w.m.MCP) == "expired"
    assert w.c.apps(w.alice)[0].connection == "expired"  # 설정 '다시 로그인 필요'
    # 서버가 아직 안 끝난 토큰에 401 (서버 쪽 만료) → 클라이언트는 expired → rejected 로 조용히 refresh → 다시 됨
    w2 = setup(fake_mcp)
    await connect(w2, w2.alice)
    token = await w2.oauth.access_token(w2.alice, w2.m.MCP)
    w2.fake.expire_all()
    with pytest.raises(NeedsAuth) as e:
        await w2.mcp.list_tools(w2.url, token=token)
    assert e.value.reason == "expired"
    fresh = await asyncio.gather(*(w2.oauth.access_token(w2.alice, w2.m.MCP, rejected=token) for _ in range(3)))
    assert len(set(fresh)) == 1 and fresh[0] != token and w2.fake.refresh_requests == 1  # 셋이 와도 refresh 하나
    assert len(await w2.mcp.list_tools(w2.url, token=fresh[0])) == 20
    # refresh 까지 폐기 (revoke) → 다시 로그인 필요 (카드 없이 바로 브라우저 = mcp_auto_auth on 일 때 에이전트 몫)
    w2.fake.expire_all()
    w2.fake.revoke_refresh()
    with pytest.raises(NeedsAuth) as e:
        await w2.oauth.access_token(w2.alice, w2.m.MCP, rejected=fresh[0])
    assert e.value.reason == "expired" and w2.oauth.status(w2.alice, w2.m.MCP) == "expired"


@pytest.mark.anyio
async def test_write_tool_scope_step_up(fake_mcp: Any) -> None:
    w = setup(fake_mcp)
    await connect(w, w.alice)
    token = await w.oauth.access_token(w.alice, w.m.MCP)
    with pytest.raises(NeedsAuth) as e:
        await w.mcp.call_tool(w.url, "create_issue", {"title": "새 이슈"}, token=token)
    assert e.value.reason == "insufficient_scope" and e.value.scope == "issues:write"
    scope = w.oauth.step_up_scope(w.alice, w.m.MCP, e.value.scope)
    assert scope == "issues:read issues:write"
    ds, verifier, cc = desktop()
    started = await w.oauth.start(user_id=w.alice, server_id=w.server, url=w.url, port=50124, ds=ds, cc=cc, scope=scope)
    assert w.m.query_of(started.authorize_url)["scope"] == "issues:read issues:write"
    back = w.fake.authorize(started.authorize_url)
    cb = await w.oauth.callback(state=back["state"], code=back["code"], iss=back["iss"])
    w.oauth.complete(user_id=w.alice, code=cb.code, ds=ds, code_verifier=verifier)
    res = await w.mcp.call_tool(w.url, "create_issue", {"title": "새 이슈"}, token=await w.oauth.access_token(w.alice, w.m.MCP))
    assert res["result"]["tool"] == "create_issue"  # 쓰기 도구 = 지금 바로 허용 (사용자 결정)


@pytest.mark.anyio
async def test_discovery_rules(fake_mcp: Any) -> None:
    w = setup(fake_mcp, pkce=False)
    with pytest.raises(OAuthError) as e:
        await w.oauth.discover(w.url)
    assert e.value.code == "no_pkce"  # S256 을 광고하지 않는 AS = 거절 (MCP 규칙)
    w = setup(fake_mcp, dcr=False)
    ds, _, cc = desktop()
    with pytest.raises(OAuthError) as e:
        await w.oauth.start(user_id=w.alice, server_id=w.server, url=w.url, port=50123, ds=ds, cc=cc)
    assert e.value.code == "no_client"  # DCR 없음 = 관리자가 사전 등록
    w.fake.clients["pre_1"] = {"redirect_uris": [f"{PUBLIC}/api/mcp/oauth/callback"], "auth": "none"}
    w.oauth.set_client(w.m.AS, client_id="pre_1")
    started = await w.oauth.start(user_id=w.alice, server_id=w.server, url=w.url, port=50123, ds=ds, cc=cc)
    assert w.m.query_of(started.authorize_url)["client_id"] == "pre_1" and w.fake.registrations == 0
    # PRM 없는 옛 서버 = 서버 출처가 issuer
    w = setup(fake_mcp, prm=False)
    d = await w.oauth.discover(w.url)
    assert d.auth_server.issuer == w.m.MCP and d.resource == w.url and d.resource_metadata_url is None


@pytest.mark.anyio
async def test_disconnect(fake_mcp: Any) -> None:
    w = setup(fake_mcp)
    await connect(w, w.alice)
    assert await w.oauth.disconnect(w.alice, w.m.MCP, server_id=w.server)
    assert w.oauth.status(w.alice, w.m.MCP) is None and not w.fake.refresh  # revocation 도 보냈다
    assert await w.oauth.disconnect(w.alice, w.m.MCP) is False
    assert "mcp.disconnect" in [r["action"] for r in w.store.query("SELECT action FROM audit_events")]


@pytest.mark.anyio
async def test_no_vault_no_oauth(fake_mcp: Any) -> None:
    w = setup(fake_mcp)
    bare = OAuth(w.store, None, w.acc, public_url=PUBLIC, transport=w.fake.transport)
    ds, _, cc = desktop()
    with pytest.raises(OAuthError) as e:
        await bare.start(user_id=w.alice, server_id=w.server, url=w.url, port=50123, ds=ds, cc=cc)
    assert e.value.code == "vault_missing"


@pytest.mark.anyio
async def test_open_server_and_probe(fake_mcp: Any) -> None:
    w = setup(fake_mcp)
    probe = await w.mcp.probe(f"{w.m.OPEN}/mcp")
    assert probe.auth == "none" and [t.name for t in probe.tools or []] == ["echo", "big_list", "now"]
    oauth_probe = await w.mcp.probe(w.url)
    assert oauth_probe.auth == "oauth" and oauth_probe.tools is None and oauth_probe.resource_metadata
    big = await w.mcp.call_tool(f"{w.m.OPEN}/mcp", "big_list", {"n": 500})
    assert big["truncated"] and big["omitted"] > 0
    # 옛(initialize) · 새(server/discover) 둘 다 · 알아낸 방식은 다음 연결에 재사용
    assert w.mcp._era[f"{w.m.OPEN}/mcp"][0] == "legacy"


@pytest.mark.anyio
async def test_revocation_uses_client_auth_and_abandoned_tokens_are_swept(fake_mcp: Any) -> None:
    w = setup(fake_mcp, dcr=False)
    w.fake.clients["pre_c"] = {"redirect_uris": [f"{PUBLIC}/api/mcp/oauth/callback"], "auth": "client_secret_basic"}
    w.oauth.set_client(w.m.AS, client_id="pre_c", client_secret="s3cret")  # 사전 등록 confidential client (관리자 서버)
    await connect(w, w.alice)
    assert await w.oauth.disconnect(w.alice, w.m.MCP, server_id=w.server)
    assert w.fake.revoke_auth and (w.fake.revoke_auth[-1] or "").startswith("Basic ")  # 폐기 요청도 client 인증
    # callback 은 왔는데 데스크톱이 complete 를 안 보냄 → handoff(60초)가 지나면 받은 토큰 암호문을 지운다
    ds, _, cc = desktop()
    started = await w.oauth.start(user_id=w.alice, server_id=w.server, url=w.url, port=50123, ds=ds, cc=cc)
    back = w.fake.authorize(started.authorize_url)
    await w.oauth.callback(state=back["state"], code=back["code"], iss=back["iss"])
    assert w.store.query("SELECT COUNT(*) AS n FROM mcp_oauth_flows WHERE tokens_ct IS NOT NULL")[0]["n"] == 1
    w.clock.advance(120)
    with pytest.raises(OAuthError):
        w.oauth.complete(user_id=w.alice, code="bwm_nope", ds=ds)
    assert w.store.query("SELECT COUNT(*) AS n FROM mcp_oauth_flows WHERE tokens_ct IS NOT NULL")[0]["n"] == 0


@pytest.mark.anyio
async def test_user_server_refuses_foreign_issuer_and_preregistered_client(fake_mcp: Any) -> None:
    w = setup(fake_mcp, prm_as=fake_mcp.OTHER_AS)
    own = w.c.add_server(name="Mine", url=w.url, origin="user", owner_user_id=w.alice, auth="oauth")
    ds, _, cc = desktop()
    with pytest.raises(OAuthError) as e:
        await w.oauth.start(user_id=w.alice, server_id=own, url=w.url, port=50123, ds=ds, cc=cc)
    assert e.value.code == "issuer_foreign"
    started = await w.oauth.start(user_id=w.alice, server_id=w.server, url=w.url, port=50123, ds=ds, cc=cc)  # 관리자 서버 = 됨
    assert started.issuer == w.m.OTHER_AS
    assert cat.domain_of(w.m.OTHER_AS) == "login.other.test"
