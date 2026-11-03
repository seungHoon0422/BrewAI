"""MCP 서버 아이콘 (connectors/icons.py · api_mcp.py …/icon) + 연결된 앱 분류 (presets.Kinds).

아이콘 = 서버 사이트의 favicon 을 conductor 가 받아 DB 캐시 → 로그인한 API 로만 (데스크톱은 우리 API 만 부른다).
검사 = MCP 연결과 같은 길 (https · 공인 IP · 리다이렉트 다시 검사 · 같은 사이트만) · 그림 형식만 (svg 거절) · 64KB · 없음도 캐시.
가짜 서버 = tests/fake_mcp.py 처리기 + 여기서 favicon 경로만 더한 MockTransport (네트워크 없음).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import anyio
import httpx2
from pydantic_ai.models.test import TestModel

from conductor.connectors import icons as icons_mod
from conductor.connectors.presets import Kinds, parse
from conductor.connectors.vault import generate_key

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"\x00" * 40
ICO = b"\x00\x00\x01\x00\x01\x00" + b"\x10" * 30
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


class Sites:
    """fake_mcp 처리기 앞에 사이트 파일 몇 개. routes = 'https://host/path' → (status, content-type, body, 더 붙일 헤더)."""

    def __init__(self, fake: Any) -> None:
        self.fake = fake
        self.routes: dict[str, tuple[int, str, bytes, dict[str, str]]] = {}
        self.hits: list[str] = []

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        key = f"{request.url.scheme}://{request.url.host}{request.url.path}"
        if request.method == "GET" and (key.endswith("/favicon.ico") or key in self.routes or request.url.path in ("/", "")):
            self.hits.append(key)
            assert "authorization" not in request.headers and "cookie" not in request.headers  # 아이콘 요청엔 비밀값 없음
            if key not in self.routes:
                return httpx2.Response(404)
            status, ctype, body, extra = self.routes[key]
            return httpx2.Response(status, headers={"content-type": ctype, **extra} if ctype else extra, content=body)
        return self.fake.handler(request)

    @property
    def transport(self) -> httpx2.MockTransport:
        return httpx2.MockTransport(self.handler)


def world(make_api: Any, fake_mcp: Any, **kw: Any) -> tuple[Any, Sites]:
    sites = Sites(fake_mcp.Fake())
    api = make_api(lambda _: TestModel(), secret_key=generate_key(), app_kw={"mcp_transport": sites.transport}, **kw)
    return api, sites


def add_common(api: Any, url: str, name: str) -> str:
    res = api.client.post("/api/admin/mcp/servers", json={"url": url, "name": name})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_icon_served_from_cache_with_safe_headers(make_api: Any, fake_mcp: Any) -> None:
    api, sites = world(make_api, fake_mcp)
    sites.routes[f"{fake_mcp.OPEN}/favicon.ico"] = (200, "image/x-icon", PNG, {})  # 이름은 ico · 바이트는 png → png 로 내준다
    sid = add_common(api, f"{fake_mcp.OPEN}/mcp", "Notes")
    res = api.client.get(f"/api/admin/mcp/servers/{sid}/icon")
    assert res.status_code == 200 and res.content == PNG
    assert res.headers["content-type"] == "image/png" and res.headers["x-content-type-options"] == "nosniff"
    assert "default-src 'none'" in res.headers["content-security-policy"] and res.headers["cache-control"].startswith("private")
    api.add_user("m@brewai.test")
    member = api.login("m@brewai.test")
    assert member.get(f"/api/me/mcp/servers/{sid}/icon").content == PNG  # 전체 공통 앱 = 사용자도 (Bearer)
    assert sites.hits == [f"{fake_mcp.OPEN}/favicon.ico"]  # 두 번째부터 = DB 캐시 (바깥으로 1번)
    assert api.anon().get(f"/api/me/mcp/servers/{sid}/icon").status_code == 401  # 로그인한 API 로만
    row = api.store.query("SELECT origin, content_type FROM mcp_icons")[0]
    assert (row["origin"], row["content_type"]) == (fake_mcp.OPEN, "image/png")


def test_html_link_same_site_only_and_svg_rejected(make_api: Any, fake_mcp: Any) -> None:
    api, sites = world(make_api, fake_mcp)
    html = (
        '<html><head><link rel="icon" type="image/svg+xml" href="/i.svg">'
        '<link rel="icon" href="https://cdn.other.test/i.png">'  # 다른 사이트 = 따라가지 않는다
        "<link rel='shortcut icon' href='/static/i.png'></head></html>"
    ).encode()
    sites.routes[f"{fake_mcp.MCP}/"] = (200, "text/html; charset=utf-8", html, {})
    sites.routes[f"{fake_mcp.MCP}/static/i.png"] = (200, "image/png", PNG, {})
    sites.routes[f"{fake_mcp.MCP}/i.svg"] = (200, "image/svg+xml", SVG, {})
    sid = add_common(api, f"{fake_mcp.MCP}/mcp", "Tracker")
    res = api.client.get(f"/api/admin/mcp/servers/{sid}/icon")
    assert res.status_code == 200 and res.content == PNG
    assert not any("other.test" in h or h.endswith(".svg") for h in sites.hits)
    assert icons_mod.icon_links(html.decode(), f"{fake_mcp.MCP}/") == ["https://cdn.other.test/i.png", f"{fake_mcp.MCP}/static/i.png"]


def test_bad_images_and_redirects_give_204_and_are_cached(make_api: Any, fake_mcp: Any) -> None:
    api, sites = world(make_api, fake_mcp)
    o = fake_mcp.OPEN
    cases = [
        (200, "image/svg+xml", SVG, {}),  # svg = 거절
        (200, "image/x-icon", SVG, {}),  # 이름만 그림 (바이트가 svg)
        (200, "text/html", PNG, {}),  # 바이트는 그림이지만 형식이 그림이 아님
        (200, "image/png", PNG + b"\x00" * (64 * 1024), {}),  # 64KB 넘음
        (302, "", b"", {"location": "https://10.0.0.5/i.png"}),  # 사설 주소로 리다이렉트
        (302, "", b"", {"location": "https://cdn.other.test/i.png"}),  # 다른 사이트로 리다이렉트
    ]
    sid = add_common(api, f"{o}/mcp", "Notes")
    icons = api.app.state.connectors.icons
    now = datetime(2026, 11, 3, tzinfo=UTC)
    for i, case in enumerate(cases):
        icons.clock = lambda: now + timedelta(days=2 * i)  # 없음 캐시(1일)를 넘겨 다시 받는다
        sites.routes[f"{o}/favicon.ico"] = case
        before = len(sites.hits)
        assert api.client.get(f"/api/admin/mcp/servers/{sid}/icon").status_code == 204, case[1:]
        assert api.client.get(f"/api/admin/mcp/servers/{sid}/icon").status_code == 204
        tried = sites.hits[before:]
        assert tried.count(f"{o}/favicon.ico") == 1 and not any("10.0.0.5" in h or "other.test" in h for h in tried)  # 없음도 캐시
    # ICO 는 받는다 (형식 + 바이트)
    icons.clock = lambda: now + timedelta(days=30)
    sites.routes[f"{o}/favicon.ico"] = (200, "image/vnd.microsoft.icon", ICO, {})
    res = api.client.get(f"/api/admin/mcp/servers/{sid}/icon")
    assert res.status_code == 200 and res.headers["content-type"] == "image/x-icon"


def test_fetch_failure_short_ttl_and_blocked_urls_never_leave(make_api: Any, fake_mcp: Any) -> None:
    api, sites = world(make_api, fake_mcp)
    icons = api.app.state.connectors.icons
    now = datetime(2026, 11, 3, tzinfo=UTC)
    icons.clock = lambda: now

    def boom(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("down", request=request)

    failing = icons_mod.Icons(api.store, transport=httpx2.MockTransport(boom), clock=lambda: now)
    assert anyio.run(failing.icon, "https://down.fake.test/mcp") is None
    row = api.store.query("SELECT expires_at, body FROM mcp_icons WHERE origin = 'https://down.fake.test'")[0]
    assert row["body"] is None and row["expires_at"].startswith("2026-11-03T01:00")  # 받기 실패 = 1시간
    for url in ("http://plain.example.com/mcp", "https://10.0.0.5/mcp", "https://127.0.0.1/mcp", "https://user:pw@x.test/mcp"):
        assert anyio.run(icons.icon, url) is None  # 주소 검사에서 끝 = 바깥으로 0번 · 캐시도 없음
    assert not any(h.startswith(("http://plain", "https://10.", "https://127.")) for h in sites.hits)


def test_icon_routes_follow_view_rules_and_presets(make_api: Any, fake_mcp: Any, tmp_path: Path) -> None:
    rows = [
        {"id": "notes", "handle": "notes", "name": "노트", "vendor": "Fake", "url": f"{fake_mcp.OPEN}/mcp", "auth": "none",
         "category": "docs", "description": "메모를 찾아요", "docs_url": "https://open.fake.test", "verified_on": "2026-11-01"},
        {"id": "keyonly", "handle": "keyonly", "name": "키 전용", "vendor": "Fake", "url": "https://key.fake.test/mcp", "auth": "api_key",
         "category": "dev", "description": "API 키만 받아요", "docs_url": "https://key.fake.test", "verified_on": "2026-11-01",
         "available": False, "reason": "API 키 방식은 아직 지원하지 않아요"},
    ]
    path = tmp_path / "presets.json"
    path.write_text(json.dumps({"presets": rows}, ensure_ascii=False), encoding="utf-8")
    api, sites = world(make_api, fake_mcp, mcp_presets_path=str(path))
    sites.routes[f"{fake_mcp.OPEN}/favicon.ico"] = (200, "image/png", PNG, {})
    api.add_user("a@brewai.test")
    api.add_user("b@brewai.test")
    a, b = api.login("a@brewai.test"), api.login("b@brewai.test")
    own = a.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp?team=a", "name": "A 메모"})
    assert own.status_code == 201, own.text
    sid = own.json()["id"]
    assert a.get(f"/api/me/mcp/servers/{sid}/icon").content == PNG
    assert b.get(f"/api/me/mcp/servers/{sid}/icon").status_code == 404  # 못 보는 서버 = 있는지도 숨김
    assert b.get("/api/me/mcp/servers/nope/icon").status_code == 404
    assert b.get("/api/me/mcp/presets/notes/icon").content == PNG
    before = len(sites.hits)
    assert b.get("/api/me/mcp/presets/keyonly/icon").status_code == 204  # 못 쓰는 추천 서버 = 받지 않는다
    assert api.client.get("/api/admin/mcp/presets/keyonly/icon").status_code == 204
    assert len(sites.hits) == before and b.get("/api/me/mcp/presets/zzz/icon").status_code == 404
    # 주소 허용 목록 밖 사용자 서버 = 바깥으로 0번
    api.client.patch("/api/admin/mcp/policy", json={"url_allowlist": ["linear.app"]})
    with api.store.tx() as db:
        db.execute("DELETE FROM mcp_icons")
    before = len(sites.hits)
    assert a.get(f"/api/me/mcp/servers/{sid}/icon").status_code == 204
    assert len(sites.hits) == before


def test_categories_from_presets_words_and_tools(make_api: Any, fake_mcp: Any, tmp_path: Path) -> None:
    presets = parse({"presets": [
        {"id": "lin", "handle": "lin", "name": "Linear", "vendor": "Linear", "url": "https://mcp.linear.app/mcp", "auth": "oauth",
         "category": "work", "description": "이슈", "docs_url": "https://linear.app", "verified_on": "2026-11-01"},
        {"id": "exa", "handle": "exa", "name": "Exa", "vendor": "Exa", "url": "https://mcp.exa.ai/mcp", "auth": "none",
         "category": "search", "description": "웹 검색", "docs_url": "https://exa.ai", "verified_on": "2026-11-01"},
    ]})
    k = Kinds(presets, lambda u: u)
    assert k.of("https://mcp.linear.app/mcp", ["아무 이름"]) == "work"  # 추천 서버와 같은 주소
    assert k.of("https://mcp.linear.app/sse", ["x"]) == "work"  # 같은 호스트 (분류 하나)
    assert k.of("https://mcp.tavily.com/mcp/?k=***", ["Tavily", "tavily", "mcp.tavily.com"]) == "search"
    assert k.of("https://x.test/mcp", ["E2E 검색", "e2e_search"]) == "search"
    assert k.of("https://x.test/mcp", ["메모", "memo"]) == "docs"
    assert k.of("https://mcp.example.com/mcp", ["Example", "mcp.example.com"]) == "other"  # example ≠ exa (낱말 하나로만)
    assert k.of("https://y.test/mcp", ["Y"], lambda: ["create_issue", "list_issues", "search_issues"]) == "work"  # 도구 이름
    assert k.of("https://z.test/mcp", ["Z"], lambda: ["ping"]) == "other"
    # API: 목록 · 가져올 수 있는 앱 · 상세에 category
    api, _ = world(make_api, fake_mcp)
    add_common(api, f"{fake_mcp.OPEN}/mcp", "웹 검색")
    mine = api.client.get("/api/me/mcp/servers").json()["mine"]
    assert [m["category"] for m in mine] == ["search"]
    assert api.client.get(f"/api/me/mcp/servers/{mine[0]['id']}").json()["category"] == "search"


def test_user_server_icon_follows_the_whole_admin_policy(make_api: Any, fake_mcp: Any, tmp_path: Path) -> None:
    """사용자 서버 끔 · 관리자가 끈 서버 = 목록엔 막힌 줄로 남아도 아이콘은 바깥으로 0번 (빈 허용 목록 = 모두 허용이어도)."""
    rows = [{"id": "notes", "handle": "notes", "name": "노트", "vendor": "Fake", "url": f"{fake_mcp.OPEN}/mcp", "auth": "none",
             "category": "docs", "description": "메모를 찾아요", "docs_url": "https://open.fake.test", "verified_on": "2026-11-01"}]
    path = tmp_path / "presets.json"
    path.write_text(json.dumps({"presets": rows}, ensure_ascii=False), encoding="utf-8")
    api, sites = world(make_api, fake_mcp, mcp_presets_path=str(path))
    sites.routes[f"{fake_mcp.OPEN}/favicon.ico"] = (200, "image/png", PNG, {})
    api.add_user("a@brewai.test")
    a = api.login("a@brewai.test")
    sid = a.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp?team=a", "name": "A 메모"}).json()["id"]
    before = len(sites.hits)
    assert api.client.patch("/api/admin/mcp/policy", json={"allow_user_servers": False}).status_code == 200
    assert a.get(f"/api/me/mcp/servers/{sid}/icon").status_code == 204  # user_servers_disabled
    assert a.get("/api/me/mcp/presets/notes/icon").status_code == 204  # 추가할 수 없는 추천 = 받지 않는다
    assert next(m for m in a.get("/api/me/mcp/servers").json()["mine"] if m["id"] == sid)["blocked"] == "user_servers_disabled"
    api.client.patch("/api/admin/mcp/policy", json={"allow_user_servers": True})
    assert api.client.patch(f"/api/admin/mcp/user-servers/{sid}", json={"status": "disabled"}).status_code == 200
    assert a.get(f"/api/me/mcp/servers/{sid}/icon").status_code == 204  # 관리자가 끈 서버
    assert len(sites.hits) == before  # 바깥으로 0번
    api.client.patch(f"/api/admin/mcp/user-servers/{sid}", json={"status": "active"})
    assert a.get(f"/api/me/mcp/servers/{sid}/icon").content == PNG  # 다시 켜면 받는다


def test_icon_fetch_stays_on_the_two_hosts_and_the_allowlist(make_api: Any, fake_mcp: Any) -> None:
    """아이콘 주소 · 리다이렉트 = 서버 호스트와 그 사이트 호스트만 · 사용자 서버 = 허용 목록 밖은 사이트 첫 화면도 안 간다 · 공용 호스팅 = 자기 호스트만."""
    api, sites = world(make_api, fake_mcp)
    o = fake_mcp.OPEN  # open.fake.test → 사이트 fake.test
    sites.routes[f"{o}/"] = (200, "text/html", b'<link rel="icon" href="https://cdn.fake.test/i.png"><link rel="icon" href="https://fake.test/i.png">', {})
    sites.routes["https://cdn.fake.test/i.png"] = (200, "image/png", PNG, {})
    sites.routes["https://fake.test/i.png"] = (200, "image/png", PNG, {})
    api.client.patch("/api/admin/mcp/policy", json={"url_allowlist": ["open.fake.test"]})  # 정확한 호스트 하나
    api.add_user("a@brewai.test")
    a = api.login("a@brewai.test")
    sid = a.post("/api/me/mcp/servers", json={"url": f"{o}/mcp?team=a", "name": "A 메모"}).json()["id"]
    assert a.get(f"/api/me/mcp/servers/{sid}/icon").status_code == 204
    assert {h.split("/")[2] for h in sites.hits} == {"open.fake.test"}  # fake.test · cdn.fake.test = 목록 밖 · 다른 하위 호스트
    row = api.store.query("SELECT expires_at FROM mcp_icons WHERE origin = ?", (o,))[0]
    assert datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00")) < datetime.now(UTC) + timedelta(hours=2)  # 건너뜀 = 짧게
    # 허용 목록이 없으면 (관리자 서버 · 빈 목록) 사이트 호스트까지는 간다 · 같은 사이트의 다른 하위 호스트(cdn)는 여전히 안 간다
    now = datetime.now(UTC) + timedelta(days=1)
    sites.hits.clear()
    mine = icons_mod.Icons(api.store, transport=sites.transport, clock=lambda: now)
    assert anyio.run(mine.icon, f"{o}/mcp") == icons_mod.Icon("image/png", PNG)
    assert "https://fake.test/i.png" in sites.hits and not any("cdn.fake.test" in h for h in sites.hits)
    # 공용 호스팅: a.vercel.app 의 사이트 = 자기 자신 → vercel.app 첫 화면 · 남의 b.vercel.app 은 안 간다
    sites.hits.clear()
    sites.routes["https://a.vercel.app/"] = (200, "text/html", b'<link rel="icon" href="https://b.vercel.app/any/path?x=1">', {})
    assert anyio.run(mine.icon, "https://a.vercel.app/mcp") is None
    assert {h.split("/")[2] for h in sites.hits} == {"a.vercel.app"}
