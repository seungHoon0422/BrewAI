"""링크 미리보기 (linkpreview.py · api_links.py): og · twitter · <title> 읽기 · 그림은 받아 둔 것만 · SSRF (사설 IP · 리다이렉트 · DNS rebinding ·
scheme · 포트) · 큰 본문 · svg 거절 · 캐시 · 동시 요청 한 번 · 사람마다 한도 · 로그인. 진짜 인터넷에 나가지 않는다 (MockTransport · 가짜 resolver)."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx2
import pytest

from conductor import linkpreview as lp

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
SVG = b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
PAGE = (
    "<html><head><meta charset='utf-8'><title>예비 제목</title>"
    "<meta property='og:title' content='OpenTelemetry 요약 &amp; 정리'>"
    "<meta property='og:description' content='  계측은\n한 번만   '>"
    "<meta property='og:site_name' content='Canva'>"
    "<meta property='og:image' content='/thumb.png'></head><body><meta property='og:title' content='본문 것은 무시'></body></html>"
)


def site(routes: dict[str, Any], seen: list[str] | None = None) -> httpx2.MockTransport:
    """경로 → (상태, 헤더, 본문) 가짜 사이트. seen = 받은 주소."""
    def handler(req: httpx2.Request) -> httpx2.Response:
        if seen is not None:
            seen.append(str(req.url))
        assert "cookie" not in req.headers and "authorization" not in req.headers
        assert req.headers["user-agent"] == "BrewAI-LinkPreview"
        got = routes.get(req.url.path)
        if got is None:
            return httpx2.Response(404)
        status, headers, body = got
        return httpx2.Response(status, headers=headers, content=body)
    return httpx2.MockTransport(handler)


def run(coro: Any) -> Any:
    return asyncio.run(coro)


def test_reads_og_and_keeps_the_image() -> None:
    seen: list[str] = []
    p = lp.LinkPreviewer(transport=site({"/doc": (200, {"content-type": "text/html; charset=utf-8"}, PAGE.encode()),
                                         "/thumb.png": (200, {"content-type": "image/png"}, PNG)}, seen))
    got = run(p.preview("https://www.canva.com/doc#frag", user="u"))
    assert got is not None
    assert (got.title, got.description, got.site) == ("OpenTelemetry 요약 & 정리", "계측은 한 번만", "Canva")
    assert got.url == "https://www.canva.com/doc" and got.image and p.image(got.image) == ("image/png", PNG)
    assert got.body()["image"] == f"/api/links/image/{got.image}"
    assert seen == ["https://www.canva.com/doc", "https://www.canva.com/thumb.png"]


def test_title_fallback_and_site_from_host() -> None:
    p = lp.LinkPreviewer(transport=site({"/": (200, {"content-type": "text/html"}, b"<title> Hello\n World </title>")}))
    got = run(p.preview("https://www.example.com", user="u"))
    assert got is not None and (got.title, got.description, got.site, got.image) == ("Hello World", None, "example.com", None)


@pytest.mark.parametrize(("url", "code"), [
    ("ftp://example.com/a", "scheme"), ("file:///etc/passwd", "scheme"), ("javascript:alert(1)", "scheme"),
    ("https://user:pw@example.com/", "userinfo"), ("https://example.com:8443/", "port"), ("http://example.com:22/", "port"),
    ("http://127.0.0.1/", "private_address"), ("http://localhost/", "private_address"), ("http://10.0.0.5/", "private_address"),
    ("http://192.168.1.1/", "private_address"), ("http://169.254.169.254/latest/meta-data", "private_address"),
    ("http://100.64.0.1/", "private_address"), ("http://[::1]/", "private_address"), ("http://[::ffff:10.0.0.1]/", "private_address"),
    ("http://[fe80::1]/", "private_address"), ("http://224.0.0.1/", "private_address"), ("http://metadata.google.internal/", "host"),
    ("", "bad_url"), ("https://exa mple.com/", "bad_url"),
])
def test_blocked_urls(url: str, code: str) -> None:
    with pytest.raises(lp.Blocked) as e:
        lp.canonical(url)
    assert e.value.code == code


def test_default_ports_and_http_are_fine() -> None:
    assert lp.canonical("http://Example.com:80/a?b=1") == "http://example.com/a?b=1"
    assert lp.canonical("https://example.com:443") == "https://example.com/"


def test_redirect_to_a_private_address_is_not_followed() -> None:
    seen: list[str] = []
    p = lp.LinkPreviewer(transport=site({"/go": (302, {"location": "http://169.254.169.254/latest/meta-data"}, b"")}, seen))
    assert run(p.preview("https://example.com/go", user="u")) is None
    assert seen == ["https://example.com/go"]  # 두 번째 요청이 나가지 않았다


def test_redirects_are_capped() -> None:
    routes = {f"/r{i}": (302, {"location": f"/r{i + 1}"}, b"") for i in range(6)}
    seen: list[str] = []
    p = lp.LinkPreviewer(transport=site(routes, seen))
    assert run(p.preview("https://example.com/r0", user="u")) is None
    assert len(seen) == lp.MAX_REDIRECTS + 1


def test_dns_rebinding_mixed_answers_never_connect() -> None:
    """진짜 연결 길 (pinned transport): 이름이 공인 + 사설 IP 를 섞어 주면 접속 전에 막는다 (인터넷에 나가지 않는다)."""
    asked: list[str] = []

    async def resolver(host: str, port: int) -> list[str]:
        asked.append(host)
        return ["93.184.216.34", "10.0.0.7"]

    p = lp.LinkPreviewer(resolver=resolver)
    assert run(p.preview("https://rebind.example/", user="u")) is None
    assert asked == ["rebind.example"]

    async def private(host: str, port: int) -> list[str]:
        return ["127.0.0.1"]

    assert run(lp.LinkPreviewer(resolver=private).preview("https://evil.example/", user="u")) is None


def test_big_html_is_cut_and_non_html_skipped() -> None:
    big = b"<html><head><title>" + b"A" * (lp.MAX_HTML * 2) + b"</title></head></html>"
    p = lp.LinkPreviewer(transport=site({"/big": (200, {"content-type": "text/html"}, big),
                                         "/pdf": (200, {"content-type": "application/pdf"}, b"%PDF-1.4")}))
    got = run(p.preview("https://example.com/big", user="u"))
    assert got is not None and len(got.title or "") <= lp.TITLE_MAX
    assert run(p.preview("https://example.com/pdf", user="u")) is None


@pytest.mark.parametrize(("ctype", "body"), [
    ("image/svg+xml", SVG), ("image/png", SVG), ("image/png", b"<html>not an image</html>"),
    ("image/png", PNG + b"\x00" * lp.MAX_IMAGE), ("image/x-icon", b"\x00\x00\x01\x00\x01\x00" + b"\x00" * 32),
])
def test_bad_images_are_dropped_but_card_stays(ctype: str, body: bytes) -> None:
    p = lp.LinkPreviewer(transport=site({"/doc": (200, {"content-type": "text/html"}, PAGE.encode()), "/thumb.png": (200, {"content-type": ctype}, body)}))
    got = run(p.preview("https://example.com/doc", user="u"))
    assert got is not None and got.title and got.image is None


def test_image_on_a_private_address_is_not_fetched() -> None:
    page = b"<head><meta property='og:title' content='t'><meta property='og:image' content='http://10.0.0.1/a.png'></head>"
    seen: list[str] = []
    p = lp.LinkPreviewer(transport=site({"/doc": (200, {"content-type": "text/html"}, page)}, seen))
    got = run(p.preview("https://example.com/doc", user="u"))
    assert got is not None and got.image is None and seen == ["https://example.com/doc"]


def test_cache_success_and_failure_and_single_flight() -> None:
    seen: list[str] = []
    clock = [1000.0]
    p = lp.LinkPreviewer(transport=site({"/doc": (200, {"content-type": "text/html"}, PAGE.encode())}, seen), clock=lambda: clock[0])

    async def both() -> list[Any]:
        return await asyncio.gather(p.preview("https://example.com/doc", user="u"), p.preview("https://example.com/doc", user="u"))

    a, b = run(both())
    assert a == b and a is not None
    assert seen.count("https://example.com/doc") == 1  # 동시에 둘 = 한 번만 받음
    run(p.preview("https://example.com/doc", user="u"))
    assert seen.count("https://example.com/doc") == 1  # 캐시
    assert run(p.preview("https://example.com/missing", user="u")) is None
    run(p.preview("https://example.com/missing", user="u"))
    assert seen.count("https://example.com/missing") == 1  # 실패도 잠깐 캐시
    clock[0] += lp.TTL_FAIL + 1
    run(p.preview("https://example.com/missing", user="u"))
    assert seen.count("https://example.com/missing") == 2
    clock[0] += lp.TTL_OK
    run(p.preview("https://example.com/doc", user="u"))
    assert seen.count("https://example.com/doc") == 2


def test_rate_limit_per_user_counts_only_fetches() -> None:
    clock = [0.0]
    p = lp.LinkPreviewer(transport=site({}), clock=lambda: clock[0])
    for i in range(lp.RATE_PER_MIN):
        run(p.preview(f"https://example.com/{i}", user="a"))
    with pytest.raises(lp.RateLimited):
        run(p.preview("https://example.com/next", user="a"))
    run(p.preview("https://example.com/0", user="a"))  # 캐시 = 안 센다
    run(p.preview("https://example.com/next", user="b"))  # 다른 사람
    clock[0] += 61
    run(p.preview("https://example.com/next", user="a"))


def test_test_hosts_only_with_loopback() -> None:
    seen: list[str] = []
    t = site({"/og": (200, {"content-type": "text/html"}, PAGE.encode())}, seen)
    on = lp.LinkPreviewer(allow_loopback=True, hosts=lp.parse_hosts("preview.brewai.test=http://127.0.0.1:4014"), transport=t)
    assert run(on.preview("https://preview.brewai.test/og", user="u")) is not None
    assert seen[0] == "http://127.0.0.1:4014/og"
    off = lp.LinkPreviewer(hosts=lp.parse_hosts("preview.brewai.test=http://127.0.0.1:4014"), transport=t)
    assert off.hosts == {}


# ── API ──

def test_api_preview_image_auth_and_errors(make_api, h) -> None:
    links = lp.LinkPreviewer(transport=site({"/doc": (200, {"content-type": "text/html"}, PAGE.encode()),
                                             "/thumb.png": (200, {"content-type": "image/png"}, PNG)}))
    api = make_api(lambda _: None, app_kw={"links": links})
    res = api.client.get("/api/links/preview", params={"url": "https://www.canva.com/doc"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["title"] == "OpenTelemetry 요약 & 정리" and body["site"] == "Canva" and body["image"].startswith("/api/links/image/")
    img = api.client.get(body["image"])
    assert img.status_code == 200 and img.content == PNG and img.headers["content-type"] == "image/png"
    assert img.headers["x-content-type-options"] == "nosniff"
    assert api.client.get("/api/links/image/" + "0" * 32).status_code == 404
    assert api.client.get("/api/links/image/../../etc").status_code == 404
    assert api.client.get("/api/links/preview", params={"url": "http://10.0.0.1/"}).json() == {"detail": "blocked"}
    assert api.client.get("/api/links/preview", params={"url": "https://www.canva.com/nope"}).status_code == 404
    assert api.anon().get("/api/links/preview", params={"url": "https://www.canva.com/doc"}).status_code == 401
    assert api.anon().get(body["image"]).status_code == 401


def test_api_rate_limit(make_api) -> None:
    api = make_api(lambda _: None, app_kw={"links": lp.LinkPreviewer(transport=site({}))})
    codes = [api.client.get("/api/links/preview", params={"url": f"https://example.com/{i}"}).status_code for i in range(lp.RATE_PER_MIN + 1)]
    assert codes[:-1] == [404] * lp.RATE_PER_MIN and codes[-1] == 429
