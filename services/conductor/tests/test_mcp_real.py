"""실제 서버 확인(2026-11-01 · docs/slices/05-mcp.md '실제 서버 확인')에서 찾은 문제 + 추천 서버 (connectors/presets.py).

전부 가짜 (tests/fake_mcp.py · httpx2.MockTransport) — 네트워크 없음. 고친 것마다 하나:
  issuer 루트 '/' (Box · Semgrep) · DCR 실패 error 코드 (Calendly) · 결과 상한을 직렬화 크기로 (cf-demoday · gitmcp · langchain)
  서버 이름 = serverInfo (DeepWiki) · OAuth 서버 확인 = 바깥 요청 1번 · 목록만 공개 · 호출은 401 (Google) = OAuth 서버로 바꿈
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx2
import pytest
from pydantic_ai.messages import ModelMessage, ModelRequest, ToolReturnPart, UserPromptPart
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel
from pydantic_ai.models.test import TestModel

from conductor.auth import tokens
from conductor.connectors import presets as presets_mod
from conductor.connectors.client import MAX_RESULT_BYTES, McpClient, cap_result
from conductor.connectors.oauth import OAuthError, same_issuer
from conductor.connectors.vault import generate_key

from conductor.auth.accounts import Accounts
from conductor.auth.directory import Directory
from conductor.connectors import catalog as cat
from conductor.connectors.oauth import OAuth
from conductor.connectors.vault import Vault
from conductor.store import Store


def setup(fake_mcp: Any, **fake_kw: Any) -> SimpleNamespace:
    """test_mcp_oauth.setup 과 같은 세계 (Store · Accounts · OAuth · 관리자 서버 하나) — 줄인 것."""
    fake = fake_mcp.Fake(**fake_kw)
    store = Store(":memory:")
    acc = Accounts(store, password_min=15)
    with store.tx() as db:
        org = Directory(acc).create_org(db, "우리 팀", owner_id=None)
        alice = Directory(acc).create_account(db, email="alice@x.test", display_name="앨리스", org_id=org, org_role="member")
    server = cat.Catalog(store).add_server(name="Tracker", url=f"{fake_mcp.MCP}/mcp", origin="admin", owner_user_id=None, auth="oauth")
    oauth = OAuth(store, Vault.ephemeral(), acc, public_url="http://127.0.0.1:8787", transport=fake.transport)
    return SimpleNamespace(fake=fake, store=store, alice=alice, server=server, oauth=oauth, url=f"{fake_mcp.MCP}/mcp")


# ── issuer: 루트 '/' 하나는 같다 · 경로가 있으면 글자 그대로 ───────────────────────────────


def test_same_issuer_only_forgives_a_root_slash() -> None:
    assert same_issuer("https://api.box.com/", "https://api.box.com")
    assert same_issuer("https://login.semgrep.dev", "https://login.semgrep.dev/")
    assert not same_issuer("https://auth.example/tenant/", "https://auth.example/tenant")  # 경로 issuer = 그대로
    assert not same_issuer("https://api.box.com/", "https://api.box.com.evil.test")
    assert not same_issuer("https://api.box.com/", "http://api.box.com")
    assert not same_issuer("https://a.test/?x=1", "https://a.test")


@pytest.mark.anyio
async def test_prm_with_root_slash_issuer_reaches_dcr(fake_mcp: Any) -> None:
    w = setup(fake_mcp, prm_as=f"{fake_mcp.AS}/")  # PRM 'https://auth.fake.test/' · 메타데이터 issuer 'https://auth.fake.test'
    disc = await w.oauth.discover(w.url)
    assert disc.auth_server.issuer == fake_mcp.AS  # 저장 · iss 비교 = 메타데이터의 글자
    started = await w.oauth.start(user_id=w.alice, server_id=w.server, url=w.url, port=50123, ds=secrets.token_urlsafe(16))
    assert started.issuer == fake_mcp.AS and w.fake.registrations == 1


# ── DCR 실패 = RFC 7591 error 코드만 남긴다 (설명 글은 안 남김) ────────────────────────────


@pytest.mark.anyio
async def test_dcr_failure_keeps_the_rfc7591_error_code(fake_mcp: Any, caplog: pytest.LogCaptureFixture) -> None:
    w = setup(fake_mcp)
    inner = w.fake.handler

    def handler(request: httpx2.Request) -> httpx2.Response:
        if request.url.path == "/register":
            return httpx2.Response(400, json={"error": "invalid_redirect_uri", "error_description": "provider wrote this <script>"})
        return inner(request)

    w.oauth._transport = httpx2.MockTransport(handler)
    caplog.set_level(logging.WARNING)
    with pytest.raises(OAuthError) as e:
        await w.oauth.start(user_id=w.alice, server_id=w.server, url=w.url, port=50123, ds=secrets.token_urlsafe(16))
    assert (e.value.code, e.value.detail) == ("registration_failed", "status 400 invalid_redirect_uri")
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert "invalid_redirect_uri" in logged and "provider wrote this" not in logged


# ── 결과 상한 = 직렬화한 크기 (줄바꿈 · 따옴표 이스케이프 포함) ─────────────────────────────


def test_cap_result_measures_the_serialized_size() -> None:
    text = ('<div class="row">\n\t"quoted" \\ 줄</div>\n' * 2000)  # 이스케이프가 많은 HTML (cf-demoday 모양)
    out = cap_result(text)
    assert out["truncated"] is True
    assert len(json.dumps(out, ensure_ascii=False).encode()) <= MAX_RESULT_BYTES
    assert len(json.dumps(out).encode()) > len(json.dumps(out, ensure_ascii=False).encode())  # 기준 = ensure_ascii=False (목록과 같은 _size)
    assert out["omitted_bytes"] == len(text.encode()) - len(out["result"].encode())
    assert text.startswith(out["result"]) and len(out["result"]) > 1000  # 너무 많이 자르지도 않는다
    small = cap_result("짧은 글")
    assert small == {"result": "짧은 글"}


# ── 서버 이름 = serverInfo · OAuth 서버 확인 = 바깥 요청 1번 ─────────────────────────────


@pytest.mark.anyio
async def test_probe_reads_server_name_and_stops_at_the_first_401(fake_mcp: Any) -> None:
    fake = fake_mcp.Fake()
    mcp = McpClient(transport=fake.transport)
    open_probe = await mcp.probe(f"{fake_mcp.OPEN}/mcp")
    assert open_probe.auth == "none" and open_probe.server_name == "fake" and len(open_probe.tools or []) == 3
    fake.log.clear()
    probe = await mcp.probe(f"{fake_mcp.MCP}/mcp")
    assert probe.auth == "oauth" and probe.resource_metadata and probe.scope == "issues:read"
    assert [x for x in fake.log if x.startswith("POST")] == [f"POST {fake_mcp.MCP}/mcp"]  # discover 401 뒤 initialize 는 안 보낸다


def test_preview_without_a_name_uses_the_server_name(make_api: Any, fake_mcp: Any) -> None:
    fake = fake_mcp.Fake()
    api = make_api(lambda _: TestModel(), secret_key=generate_key(), app_kw={"mcp_transport": fake.transport})
    res = api.client.post("/api/me/mcp/servers/preview", json={"url": f"{fake_mcp.OPEN}/mcp"})
    assert res.status_code == 200, res.text
    assert (res.json()["name"], res.json()["handle"]) == ("fake", "fake")  # 예전 = 도메인 (open.fake.test)


# ── 목록만 공개 · 호출은 401 (Google 원격 MCP) = OAuth 서버로 바꾸고 로그인 안내 ───────────────


def _returns(messages: list[ModelMessage]) -> list[ToolReturnPart]:
    out: list[ToolReturnPart] = []
    for m in messages:
        if isinstance(m, ModelRequest):
            if any(isinstance(p, UserPromptPart) for p in m.parts):
                out = []
            out += [p for p in m.parts if isinstance(p, ToolReturnPart)]
    return out


def _model(_: str) -> FunctionModel:
    async def stream(messages: list[ModelMessage], info: AgentInfo) -> Any:
        rs = _returns(messages)
        if not rs:
            yield {0: DeltaToolCall(name="use_app", json_args=json.dumps({"app": "hybrid", "need": "echo text"}), tool_call_id="c1")}
        elif len(rs) == 1:
            yield {0: DeltaToolCall(name="hybrid__echo", json_args=json.dumps({"text": "hi"}), tool_call_id="c2")}
        else:
            yield "끝"

    return FunctionModel(stream_function=stream)


def test_public_listing_but_401_on_call_switches_the_server_to_oauth(make_api: Any, fake_mcp: Any) -> None:
    fake = fake_mcp.Fake()
    api = make_api(_model, secret_key=generate_key(), app_kw={"mcp_transport": fake.transport})
    added = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.HYBRID}/mcp", "name": "Hybrid"}).json()
    assert (added["auth"], added["tool_count"]) == ("none", 3)  # 목록이 열려 있어 처음엔 '인증 없음'으로 보인다
    events = api.chat("echo 해줘")
    auth = [e["value"] for e in events if e["type"] == "CUSTOM" and e["name"] == "brewai.app_auth"]
    assert len(auth) == 1 and auth[0]["reason"] == "not_connected" and auth[0]["server"]["id"] == added["id"]
    row = api.store.query("SELECT auth FROM mcp_servers WHERE id = ?", (added["id"],))[0]
    assert row["auth"] == "oauth"
    assert not api.store.query("SELECT 1 FROM mcp_tool_cache WHERE server_id = ? AND user_key = '*'", (added["id"],))
    mine = {a["handle"]: a for a in api.client.get("/api/me/mcp/servers").json()["mine"]}
    assert mine["hybrid"]["connection"] == "needs_login"
    # 관리자 '연결 테스트' 가 토큰 없이 목록을 받아도 '인증 없음' 으로 되돌리지 않는다
    test = api.client.post(f"/api/admin/mcp/servers/{added['id']}/test").json()
    assert test["ok"] is True and test["auth"] == "oauth"
    assert api.store.query("SELECT auth FROM mcp_servers WHERE id = ?", (added["id"],))[0]["auth"] == "oauth"
    # 로그인 시작 = 호출 때 받은 PRM 주소로 찾는다 (다시 확인하면 목록이 열려 401 헤더를 못 받는다)
    ds, verifier = secrets.token_urlsafe(16), secrets.token_urlsafe(48)
    res = api.client.post(f"/api/me/mcp/servers/{added['id']}/connect/start", json={"port": 50125, "ds": ds, "cc": tokens.s256(verifier)})
    assert res.status_code == 200, res.text
    q = fake_mcp.query_of(res.json()["authorize_url"])
    assert q["resource"] == f"{fake_mcp.HYBRID}/mcp" and q["code_challenge_method"] == "S256"
    assert fake.calls == []  # 서버는 도구를 한 번도 실행하지 않았다
    # PRM 주소는 DB 에 있다 = 재시작(새 Connectors) 뒤에도 connect/start 가 쓴다
    from conductor.connectors.catalog import Catalog
    assert Catalog(api.store).auth_hint(added["id"]) == f"{fake_mcp.HYBRID}/custom/prm"
    api.client.delete(f"/api/admin/mcp/servers/{added['id']}")
    assert Catalog(api.store).auth_hint(added["id"]) is None  # 지우면 같이


def test_401_without_resource_metadata_does_not_switch_the_server(make_api: Any, fake_mcp: Any) -> None:
    """헤더 없는 401 (익명 한도 · 일시 오류) = 로그인 안내만. 서버 정의는 '인증 없음' 그대로 · 연결 테스트로 되돌릴 일도 없다."""
    fake = fake_mcp.Fake()

    def handler(req: httpx2.Request) -> httpx2.Response:
        if req.url.host == "hybrid.fake.test" and req.method == "POST" and json.loads(req.content).get("method") == "tools/call":
            return httpx2.Response(401)
        return fake.handler(req)

    api = make_api(_model, secret_key=generate_key(), app_kw={"mcp_transport": httpx2.MockTransport(handler)})
    added = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.HYBRID}/mcp", "name": "Hybrid"}).json()
    events = api.chat("echo 해줘")
    assert [e["value"]["reason"] for e in events if e["type"] == "CUSTOM" and e["name"] == "brewai.app_auth"] == ["not_connected"]
    assert api.store.query("SELECT auth FROM mcp_servers WHERE id = ?", (added["id"],))[0]["auth"] == "none"


# ── 연결 뒤 SDK 가 따로 여는 GET(SSE) 의 401 · 403 은 요청(POST)을 막지 않는다 ─────────────────────


@pytest.mark.anyio
@pytest.mark.parametrize("get_status", [401, 403])
async def test_get_stream_401_or_403_does_not_fail_the_request(fake_mcp: Any, get_status: int) -> None:
    fake = fake_mcp.Fake()
    seen: list[str] = []

    def handler(req: httpx2.Request) -> httpx2.Response:
        if req.url.host == "open.fake.test" and req.method == "GET":
            seen.append("GET")
            return httpx2.Response(get_status, headers={"www-authenticate": 'Bearer resource_metadata="https://open.fake.test/prm"'})
        if req.url.host == "open.fake.test" and req.method == "DELETE":
            return httpx2.Response(200)
        res = fake.handler(req)
        if req.url.host == "open.fake.test" and req.method == "POST":  # 세션 id = SDK 가 GET 스트림을 연다
            return httpx2.Response(res.status_code, headers=dict(res.headers) | {"mcp-session-id": "s1"}, content=res.content)
        return res

    class SlowList(httpx2.AsyncBaseTransport):  # tools/list 를 늦게 = GET 이 먼저 답한다
        def __init__(self) -> None:
            self.inner = httpx2.MockTransport(handler)

        async def handle_async_request(self, req: httpx2.Request) -> httpx2.Response:
            if req.method == "POST" and b"tools/list" in req.content:
                await asyncio.sleep(0.2)
            return await self.inner.handle_async_request(req)

    tools = await McpClient(transport=SlowList()).list_tools(f"{fake_mcp.OPEN}/mcp")
    assert len(tools) == 3 and seen == ["GET"]


# ── 추천 서버 ──────────────────────────────────────────────────────────────────────


def test_shipped_presets_file_is_valid() -> None:
    items = presets_mod.load()
    assert len(items) >= 50
    raw = json.loads(presets_mod.DEFAULT_PATH.read_text(encoding="utf-8"))["presets"]
    assert len(items) == len(raw)  # 틀린 줄이 있으면 load 가 빈 목록을 준다
    for p in items:
        assert p.url.startswith("https://") and p.docs_url.startswith("https://") and p.verified_on == "2026-11-01"
        assert "·" not in p.name + p.description + (p.reason or "") + (p.note or "")
        if p.auth == "api_key":
            assert not p.available  # 정적 헤더 인증 없음
        if not p.available:
            assert p.reason
    ready = [p for p in items if p.available]
    assert sum(p.auth == "none" for p in ready) >= 15 and sum(p.auth == "oauth" for p in ready) >= 30
    assert not any(p.url.endswith("/sse") for p in items)  # Streamable HTTP 만 (ADR-0013)


def test_presets_parse_rejects_bad_rows() -> None:
    good = {"id": "x", "handle": "xx", "name": "X", "vendor": "X", "url": "https://x.test/mcp", "auth": "none", "category": "docs",
            "description": "설명", "docs_url": "https://x.test", "verified_on": "2026-11-01"}
    assert presets_mod.parse({"presets": [good]})[0].available is True
    for bad in ({"url": "ftp://x"}, {"auth": "basic"}, {"handle": "a__b"}, {"description": "가 · 나"}, {"available": False},
                {"docs_url": "javascript:alert(1)"}):
        with pytest.raises(presets_mod.PresetError):
            presets_mod.parse({"presets": [good | bad]})
    with pytest.raises(presets_mod.PresetError):
        presets_mod.parse({"presets": [good, good]})  # id 겹침


def _presets_file(tmp_path: Path, fake_mcp: Any) -> str:
    rows = [
        {"id": "notes", "handle": "notes", "name": "노트", "vendor": "Fake", "url": f"{fake_mcp.OPEN}/mcp", "auth": "none",
         "category": "docs", "description": "메모를 찾아요", "docs_url": "https://open.fake.test", "verified_on": "2026-11-01"},
        {"id": "tracker", "handle": "tracker", "name": "트래커", "vendor": "Fake", "url": f"{fake_mcp.MCP}/mcp", "auth": "oauth",
         "category": "work", "description": "이슈를 다뤄요", "docs_url": "https://mcp.fake.test", "verified_on": "2026-11-01",
         "admin_only": True},
        {"id": "keyonly", "handle": "keyonly", "name": "키 전용", "vendor": "Fake", "url": "https://key.fake.test/mcp", "auth": "api_key",
         "category": "dev", "description": "API 키만 받아요", "docs_url": "https://key.fake.test", "verified_on": "2026-11-01",
         "available": False, "reason": "API 키 방식은 아직 지원하지 않아요"},
    ]
    path = tmp_path / "presets.json"
    path.write_text(json.dumps({"presets": rows}, ensure_ascii=False), encoding="utf-8")
    return str(path)


def test_presets_endpoints_mark_added_and_admin_only(make_api: Any, fake_mcp: Any, tmp_path: Path) -> None:
    fake = fake_mcp.Fake()
    api = make_api(lambda _: TestModel(), secret_key=generate_key(), app_kw={"mcp_transport": fake.transport},
                   mcp_presets_path=_presets_file(tmp_path, fake_mcp))
    admin = {p["id"]: p for p in api.client.get("/api/admin/mcp/presets").json()["presets"]}
    assert [admin[k]["added"] for k in ("notes", "tracker", "keyonly")] == [False, False, False]
    assert admin["tracker"]["available"] is True and admin["keyonly"]["reason"] == "API 키 방식은 아직 지원하지 않아요"
    assert set(admin["notes"]) >= {"id", "handle", "name", "vendor", "url", "auth", "category", "description", "docs_url", "verified_on",
                                   "available", "reason", "note", "admin_only", "added"}
    res = api.client.post("/api/admin/mcp/servers", json={"url": "HTTPS://MCP.fake.test/mcp", "name": "트래커"})  # 정규 주소로 비교
    assert res.status_code == 201, res.text
    admin = {p["id"]: p for p in api.client.get("/api/admin/mcp/presets").json()["presets"]}
    assert admin["tracker"]["added"] is True and admin["notes"]["added"] is False
    mine = {p["id"]: p for p in api.client.get("/api/me/mcp/presets").json()["presets"]}
    assert mine["tracker"]["added"] is True  # 전체 공통 서버 = 내 목록에도 있다
    assert mine["tracker"]["available"] is False and mine["tracker"]["reason"] == "관리자 콘솔에서만 추가할 수 있어요"
    api.client.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp", "name": "노트"})
    mine = {p["id"]: p for p in api.client.get("/api/me/mcp/presets").json()["presets"]}
    assert mine["notes"]["added"] is True and "secret" not in json.dumps(mine)
    assert api.anon().get("/api/me/mcp/presets").status_code == 401
    assert api.anon().get("/api/admin/mcp/presets").status_code in (401, 403)


def test_missing_presets_file_means_an_empty_list(make_api: Any, fake_mcp: Any, tmp_path: Path) -> None:
    api = make_api(lambda _: TestModel(), secret_key=generate_key(), mcp_presets_path=str(tmp_path / "none.json"))
    assert api.client.get("/api/me/mcp/presets").json() == {"presets": []}


def test_presets_respect_the_url_allowlist_for_users(make_api: Any, fake_mcp: Any, tmp_path: Path) -> None:
    fake = fake_mcp.Fake()
    api = make_api(lambda _: TestModel(), secret_key=generate_key(), app_kw={"mcp_transport": fake.transport},
                   mcp_presets_path=_presets_file(tmp_path, fake_mcp))
    assert api.client.patch("/api/admin/mcp/policy", json={"url_allowlist": ["mcp.fake.test"]}).status_code == 200
    mine = {p["id"]: p for p in api.client.get("/api/me/mcp/presets").json()["presets"]}
    assert mine["notes"]["available"] is False and mine["notes"]["reason"] == "관리자가 허용한 주소가 아니에요"
    admin = {p["id"]: p for p in api.client.get("/api/admin/mcp/presets").json()["presets"]}
    assert admin["notes"]["available"] is True  # 허용 목록 = 사용자 서버에만


def test_adding_from_a_preset_keeps_its_handle(make_api: Any, fake_mcp: Any, tmp_path: Path) -> None:
    """추천 서버를 골라 추가 = 미리 확인 · 추가 둘 다 그 부르는 이름 (관리자: 이미 쓰는 이름이면 _2)."""
    fake = fake_mcp.Fake()
    api = make_api(lambda _: TestModel(), secret_key=generate_key(), app_kw={"mcp_transport": fake.transport},
                   mcp_presets_path=_presets_file(tmp_path, fake_mcp))
    notes = {p["id"]: p for p in api.client.get("/api/me/mcp/presets").json()["presets"]}["notes"]
    body = {"url": notes["url"], "name": notes["name"], "description": notes["description"], "handle": notes["handle"]}
    pre = api.client.post("/api/me/mcp/servers/preview", json=body)
    assert pre.status_code == 200 and pre.json()["handle"] == "notes", pre.text
    res = api.client.post("/api/me/mcp/servers", json=body)
    assert res.status_code == 201, res.text
    sid = res.json()["id"]
    assert api.store.query("SELECT handle FROM mcp_servers WHERE id = ?", (sid,))[0]["handle"] == "notes"
    tracker = {p["id"]: p for p in api.client.get("/api/admin/mcp/presets").json()["presets"]}["tracker"]
    first = api.client.post("/api/admin/mcp/servers", json={"url": tracker["url"], "name": tracker["name"], "handle": tracker["handle"]})
    assert first.status_code == 201 and first.json()["handle"] == "tracker", first.text
    other = api.client.post("/api/admin/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp", "name": "노트", "handle": "tracker"})
    assert other.status_code == 201 and other.json()["handle"] == "tracker_2", other.text  # 관리자 서버끼리 겹치면 _unique
