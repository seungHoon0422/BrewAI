"""MCP 서버 아이콘 = 그 서버 사이트의 favicon. 데스크톱은 우리 API 만 부른다 (CSP) → conductor 가 대신 받아 DB 에 캐시하고 API 로 내준다.

받는 곳   서버 주소의 origin → 그 사이트(ssrf.site_of · mcp.linear.app → linear.app) 순서로 /favicon.ico · 첫 화면 HTML 의 <link rel=icon>
          · 아이콘 주소 · 리다이렉트도 그 두 호스트만 (같은 사이트의 다른 하위 호스트 · 다른 사이트 CDN 은 따라가지 않는다 · 공용 호스팅
          a.vercel.app 은 사이트가 자기 자신 = 남의 b.vercel.app 으로 안 간다)
          · allowed = 사용자 서버면 관리자 주소 허용 목록 (ssrf.host_allowed) — 보내기 전 주소마다 본다 · 사이트 첫 화면도 목록 밖이면 건너뛴다
검사      MCP 연결과 같은 길: ssrf.canonical_url (https 만 · userinfo 금지) + pinned transport (공인 IP 만 · DNS rebinding 막음)
          · 리다이렉트도 하나하나 다시 검사 (같은 사이트 · 3번까지) · 그림 64KB · HTML 128KB 까지만 읽는다 · 한 번 5초 · 전부 12초
모양      png · ico · webp · gif · jpeg 만: Content-Type 이 그 형식 + 첫 바이트도 그 형식 (내줄 때 형식 = 바이트로 본 것)
          svg 는 거절 (스크립트 · 바깥 주소를 품을 수 있다 · 정리기를 두지 않는다 = 그림 파일만)
캐시      mcp_icons (origin → 바이트 · 형식 · 만료). 찾음 = 7일 · 없음 = 1일 · 받기 실패(접속 · 시간) = 1시간 = 같은 사이트를 다시 두드리지 않는다
          같은 origin 을 동시에 부르면 하나만 받는다. 값 = 그림 바이트뿐 (요청 헤더 · 쿠키 · 토큰 없음 = 비밀값을 싣지 않는다)
          허용 목록 때문에 건너뛴 곳이 있어 못 찾았으면 '없음' 대신 1시간 (목록이 바뀌면 다시 본다)
화면      없으면 API 가 204 → 화면은 머리글자 (UI 가 바깥 주소를 직접 부르지 않는다)
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from html import unescape
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx2

from . import ssrf

log = logging.getLogger("conductor.mcp.icons")

Allowed = Callable[[str], bool]  # 보내도 되는 주소인가 (None = 모두 · 사용자 서버 = 관리자 주소 허용 목록)

MAX_BYTES = 64 * 1024
MAX_HTML = 128 * 1024
TIMEOUT = httpx2.Timeout(5.0)
TOTAL_S = 12.0
TTL_FOUND = timedelta(days=7)
TTL_NONE = timedelta(days=1)
TTL_FAILED = timedelta(hours=1)
MAX_LINKS = 3  # HTML 하나에서 시도할 <link rel=icon> 수
# 받는 Content-Type (svg 없음) · 내줄 때는 바이트로 본 형식
_IMAGE_TYPES = frozenset({
    "image/png", "image/x-icon", "image/vnd.microsoft.icon", "image/ico", "image/icon", "image/webp", "image/gif", "image/jpeg", "image/jpg",
    "image/pjpeg",
})
_ACCEPT_IMAGE = "image/png,image/x-icon,image/webp,image/gif,image/jpeg;q=0.8"
_LINK = re.compile(r"<link\b[^>]*>", re.I)
_ATTR = re.compile(r"""([a-zA-Z_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""")
_REDIRECTS = (301, 302, 303, 307, 308)


@dataclass(frozen=True)
class Icon:
    content_type: str
    body: bytes


def sniff(body: bytes) -> str | None:
    """첫 바이트로 본 그림 형식 (모르면 None · svg · html 은 여기서 걸러진다)."""
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(body) >= 6 and body[:4] == b"\x00\x00\x01\x00" and body[4:6] != b"\x00\x00":  # ICO (그림 1장 이상 · CUR 아님)
        return "image/x-icon"
    if len(body) >= 12 and body[:4] == b"RIFF" and body[8:12] == b"WEBP":
        return "image/webp"
    if body[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if body.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return None


def icon_links(html: str, base: str) -> list[str]:
    """HTML 의 <link rel="icon" …> 주소 (icon 먼저 · apple-touch-icon 다음 · svg · data: 빼고). 상대 주소는 base 기준."""
    found: list[tuple[int, str]] = []
    for tag in _LINK.findall(html):
        attrs = {m.group(1).lower(): unescape(m.group(2) or m.group(3) or m.group(4) or "") for m in _ATTR.finditer(tag)}
        rels = attrs.get("rel", "").lower().split()
        if "icon" not in rels and "apple-touch-icon" not in rels:
            continue
        href = attrs.get("href", "").strip()
        if not href or href.lower().startswith(("data:", "javascript:")):
            continue
        if "svg" in attrs.get("type", "").lower() or urlsplit(href).path.lower().endswith(".svg"):
            continue
        found.append((0 if "icon" in rels else 1, urljoin(base, href)))
    return [u for _, u in sorted(found, key=lambda x: x[0])][:MAX_LINKS]


def origin_of(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def _iso(t: datetime) -> str:
    return t.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Icons:
    """origin → Icon | None (캐시 먼저). 실패는 조용히 None (화면은 머리글자)."""

    def __init__(
        self, store: Any, *, allow_loopback: bool = False, transport: httpx2.AsyncBaseTransport | None = None, resolver: Any = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.store = store
        self.allow_loopback = allow_loopback
        self._transport = transport
        self._resolver = resolver
        self.clock = clock or (lambda: datetime.now(UTC))
        self._locks: dict[str, asyncio.Lock] = {}

    async def icon(self, url: str, *, allowed: Allowed | None = None) -> Icon | None:
        """MCP 서버(또는 추천 서버) 주소 → 그 사이트 아이콘. 막힌 주소 · 허용 목록 밖 = 바깥으로 0번."""
        try:
            origin = origin_of(ssrf.canonical_url(url, allow_loopback=self.allow_loopback))
        except ssrf.Blocked:
            return None
        if allowed is not None and not allowed(origin):
            return None
        hit = self._cached(origin)
        if hit is not None:
            return hit[0]
        lock = self._locks.setdefault(origin, asyncio.Lock())
        async with lock:
            hit = self._cached(origin)
            if hit is not None:
                return hit[0]
            try:
                async with asyncio.timeout(TOTAL_S):
                    found, failed = await self._find(origin, allowed)
            except TimeoutError:
                found, failed = None, True
            self._save(origin, found, TTL_FOUND if found else TTL_FAILED if failed else TTL_NONE)
            if found is None:
                log.info("mcp icon not found: %s%s", ssrf.redact_url(origin), " (fetch failed)" if failed else "")
            return found

    # ── 캐시 ──
    def _cached(self, origin: str) -> tuple[Icon | None] | None:
        """(아이콘 | None) = 캐시에 있음 (None = '없음' 도 캐시) · None = 캐시 없음 · 만료."""
        rows = self.store.query("SELECT content_type, body, expires_at FROM mcp_icons WHERE origin = ?", (origin,))
        if not rows:
            return None
        r = rows[0]
        if self.clock() >= datetime.fromisoformat(r["expires_at"].replace("Z", "+00:00")):
            return None
        return (Icon(r["content_type"], bytes(r["body"])) if r["body"] is not None and r["content_type"] else None,)

    def _save(self, origin: str, icon: Icon | None, ttl: timedelta) -> None:
        now = self.clock()
        with self.store.tx() as db:
            db.execute(
                "INSERT INTO mcp_icons (origin, content_type, body, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?)"
                " ON CONFLICT (origin) DO UPDATE SET content_type = excluded.content_type, body = excluded.body,"
                " fetched_at = excluded.fetched_at, expires_at = excluded.expires_at",
                (origin, icon.content_type if icon else None, icon.body if icon else None, _iso(now), _iso(now + ttl)),
            )

    # ── 받기 ──
    async def _find(self, origin: str, allowed: Allowed | None = None) -> tuple[Icon | None, bool]:
        """(아이콘, 다시 볼 만한가 = 모두 접속 실패 · 허용 목록 때문에 건너뜀). 순서 = origin /favicon.ico → origin HTML → 사이트 /favicon.ico → 사이트 HTML."""
        site = ssrf.site_of(origin)
        host = urlsplit(origin).hostname or ""
        hosts = frozenset({host, site} - {""})  # 아이콘 주소 · 리다이렉트가 갈 수 있는 호스트 (정확히 이 둘)
        roots = [origin] + ([f"https://{site}"] if site and site != host else [])
        skipped = allowed is not None and any(not allowed(r) for r in roots)
        if allowed is not None:
            roots = [r for r in roots if allowed(r)]
        ok_to = lambda u: (urlsplit(u).hostname or "") in hosts and (allowed is None or allowed(u))  # noqa: E731
        answered = False
        async with ssrf.http_client(allow_loopback=self.allow_loopback, transport=self._transport, resolver=self._resolver,
                                    timeout=TIMEOUT, headers={"user-agent": "BrewAI-icon/1"}) as client:
            for root in roots:
                got, ok = await self._image(client, f"{root}/favicon.ico", ok_to)
                answered |= ok
                if got:
                    return got, False
                page, ok = await self._get(client, f"{root}/", ok_to, cap=MAX_HTML, accept="text/html")
                answered |= ok
                if page is None or not page[0].startswith(("text/html", "application/xhtml")):
                    continue
                for link in icon_links(page[1].decode("utf-8", "replace"), page[2]):
                    skipped |= not ok_to(link)
                    got, ok = await self._image(client, link, ok_to)
                    answered |= ok
                    if got:
                        return got, False
        return None, skipped or not answered

    async def _image(self, client: httpx2.AsyncClient, url: str, ok_to: Allowed) -> tuple[Icon | None, bool]:
        res, ok = await self._get(client, url, ok_to, cap=MAX_BYTES, accept=_ACCEPT_IMAGE)
        if res is None:
            return None, ok
        ctype, body, _ = res
        kind = sniff(body)
        if ctype not in _IMAGE_TYPES or kind is None:  # 이름만 그림 (html · svg · 빈 파일) = 거절
            return None, True
        return Icon(kind, body), True

    async def _get(self, client: httpx2.AsyncClient, url: str, ok_to: Allowed, *, cap: int, accept: str) -> tuple[tuple[str, bytes, str] | None, bool]:
        """GET 하나 (보내기 전 · 리다이렉트마다 ok_to = 두 호스트 + 허용 목록 · 다시 검사). ((형식, 바이트, 최종 주소) | None, 서버가 답했나)."""
        try:
            target = ssrf.canonical_url(url, allow_loopback=self.allow_loopback)
            for _ in range(ssrf.MAX_REDIRECTS + 1):
                if not ok_to(target):
                    return None, True
                res = await client.send(client.build_request("GET", target, headers={"accept": accept}), stream=True)
                try:
                    if res.status_code in _REDIRECTS and res.headers.get("location"):
                        target = ssrf.canonical_url(str(res.request.url.join(res.headers["location"])), allow_loopback=self.allow_loopback)
                        continue
                    if res.status_code != 200:
                        return None, True
                    length = res.headers.get("content-length", "")
                    if length.isdigit() and int(length) > cap:
                        return None, True
                    buf = bytearray()
                    async for chunk in res.aiter_bytes():
                        buf += chunk
                        if len(buf) > cap:
                            return None, True
                    ctype = res.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                    return (ctype, bytes(buf), target), True
                finally:
                    await res.aclose()
            return None, True
        except ssrf.Blocked as e:
            return None, e.code not in ("resolve_failed",)  # 막힌 주소 = 답을 받은 것으로 (다시 두드려도 같다)
        except (httpx2.HTTPError, OSError, ValueError):
            return None, False
