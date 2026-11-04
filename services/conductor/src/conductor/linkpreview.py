"""링크 미리보기 카드 = 답에 나온 주소의 제목 · 설명 · 사이트 · 대표 그림 (og · twitter · <title>). 데스크톱은 우리 API 만 부른다 (CSP) → conductor 가 대신 받는다.

검사 (SSRF · connectors/ssrf.py 와 같은 길)
  주소     http · https 만 · 포트 = 기본(80 · 443)만 · userinfo 금지 · 2048자 · 메타데이터 이름 금지
  IP       이름을 한 번 풀고(getaddrinfo) 나온 IP 가 **모두** 공인 주소여야 → 그 IP 로 직접 접속 (ssrf.pinned_transport · 다시 풀지 않는다)
           사설 · loopback · link-local · 멀티캐스트 · 예약 · CGNAT · IPv4-mapped / 6to4 / Teredo / NAT64 안의 IPv4 도 막는다
  리다이렉트 자동으로 안 따라간다 · Location 마다 주소 검사 + 접속 때 IP 검사 · 3번까지
  읽기     전부 5초 · HTML 512KB · 그림 1MB 까지만 (넘으면 그만 읽는다) · 쿠키 · 인증 헤더 · 프록시 없음 · User-Agent = BrewAI-LinkPreview
  그림     png · jpeg · webp · gif 를 첫 바이트로 확인 (svg · ico · html 거절) · 미리보기를 만들 때 같이 받아 두고 sha 로만 내준다
           (그림 주소 = 우리가 받아 둔 것만 = 그림 경로로는 아무 데도 나가지 않는다)
캐시      주소 → 결과 LRU 512 · 24시간 (실패 = 10분) · 그림 LRU 64MB · 같은 주소 동시 요청 = 한 번만 받는다
한도      사람마다 1분에 30번 받기 (캐시에서 준 것은 안 센다) → 넘으면 RateLimited
테스트    allow_loopback (settings.mcp_loopback_ok = E2E · 테스트만) · hosts = E2E 가짜 사이트 (https://preview.brewai.test → http://127.0.0.1:4014)
"""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import re
import time
from collections import OrderedDict, deque
from collections.abc import Mapping
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx2

from .connectors import ssrf

USER_AGENT = "BrewAI-LinkPreview"
TOTAL_S = 5.0
MAX_HTML = 512 * 1024
MAX_IMAGE = 1024 * 1024
MAX_REDIRECTS = 3
CACHE_SIZE = 512
TTL_OK = 24 * 3600.0
TTL_FAIL = 600.0
IMAGE_BUDGET = 64 * 1024 * 1024
RATE_PER_MIN = 30
TITLE_MAX, DESC_MAX, SITE_MAX = 200, 300, 80
_CTRL = re.compile(r"[\x00-\x1f\x7f]+")
_SPACE = re.compile(r"\s+")
_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


class Blocked(Exception):
    """보내지 않는 주소 (code = scheme · port · userinfo · bad_url · host · private_address · resolve_failed · too_many_redirects)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class RateLimited(Exception):
    pass


@dataclass(frozen=True)
class Preview:
    url: str
    title: str | None
    description: str | None
    site: str | None
    image: str | None  # 그림 sha (/api/links/image/<sha>) · 없으면 None

    def body(self) -> dict[str, Any]:
        return {"url": self.url, "title": self.title, "description": self.description, "site": self.site,
                "image": f"/api/links/image/{self.image}" if self.image else None}


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


def canonical(raw: str, *, allow_loopback: bool = False) -> str:
    """검사 + 정규화 (http · https · 기본 포트만 · loopback 은 allow_loopback 일 때만 · 그때는 포트 자유). 통과 못 하면 Blocked."""
    text = (raw or "").strip()
    if not text or len(text) > ssrf.MAX_URL or any(c.isspace() or ord(c) < 0x20 for c in text):
        raise Blocked("bad_url")
    try:
        parts = urlsplit(text)
        port = parts.port
    except ValueError:
        raise Blocked("bad_url") from None
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        raise Blocked("scheme")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise Blocked("userinfo")
    host = (parts.hostname or "").rstrip(".")
    if not host:
        raise Blocked("bad_url")
    try:
        host = str(ipaddress.ip_address(host)) if _is_ip(host) else host.encode("idna").decode("ascii").lower()
    except UnicodeError:
        raise Blocked("host") from None
    if host in ssrf._BLOCKED_NAMES:
        raise Blocked("host")
    loopback = host == "localhost" or host.endswith(".localhost") or (_is_ip(host) and ipaddress.ip_address(host).is_loopback)
    if loopback and not allow_loopback:
        raise Blocked("private_address")
    if _is_ip(host) and ssrf.ip_blocked(host, allow_loopback=allow_loopback):
        raise Blocked("private_address")
    default = 443 if scheme == "https" else 80
    if port is not None and port != default and not loopback:
        raise Blocked("port")
    netloc = f"[{host}]" if ":" in host else host
    if port is not None and port != default:
        netloc += f":{port}"
    return urlunsplit((scheme, netloc, parts.path or "/", parts.query, ""))


def sniff_image(body: bytes) -> str | None:
    """첫 바이트로 본 그림 형식 (png · jpeg · webp · gif 만 · svg · ico · html = None)."""
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if body.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(body) >= 12 and body[:4] == b"RIFF" and body[8:12] == b"WEBP":
        return "image/webp"
    if body[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return None


def _clean(v: str | None, cap: int) -> str | None:
    if not v:
        return None
    s = _SPACE.sub(" ", _CTRL.sub(" ", v)).strip()
    return (s[: cap - 1] + "…" if len(s) > cap else s) or None


class _Meta(HTMLParser):
    """<head> 의 meta (property · name → content) · 첫 <title> 글. </head> · <body> 에서 멈춘다."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title = ""
        self._in_title = False
        self.done = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.done:
            return
        if tag == "body":
            self.done = True
        elif tag == "title" and not self.title:
            self._in_title = True
        elif tag == "meta":
            a = {k.lower(): (v or "") for k, v in attrs}
            key = (a.get("property") or a.get("name") or "").strip().lower()
            if key and "content" in a and key not in self.meta:
                self.meta[key] = a["content"]

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "head":
            self.done = True

    def handle_data(self, data: str) -> None:
        if self._in_title and not self.done:
            self.title += data


def parse_html(html: str, base: str) -> tuple[str | None, str | None, str | None, str | None]:
    """(제목, 설명, 사이트, 그림 주소) — og → twitter → <title> · description 순."""
    p = _Meta()
    try:
        p.feed(html)
        p.close()  # 닫히지 않은 <title> (잘린 본문) 의 남은 글도 내보낸다
    except Exception:  # noqa: BLE001 - 깨진 HTML = 읽은 데까지
        pass
    m = p.meta
    title = _clean(m.get("og:title") or m.get("twitter:title") or p.title, TITLE_MAX)
    desc = _clean(m.get("og:description") or m.get("twitter:description") or m.get("description"), DESC_MAX)
    site = _clean(m.get("og:site_name") or m.get("application-name"), SITE_MAX)
    image = (m.get("og:image:secure_url") or m.get("og:image") or m.get("twitter:image") or m.get("twitter:image:src") or "").strip()
    return title, desc, site, (urljoin(base, image) if image and not image.lower().startswith("data:") else None)


def _charset(content_type: str, head: bytes) -> str:
    m = re.search(r"charset=([\w-]+)", content_type, re.I) or re.search(rb"<meta[^>]+charset=[\"']?([\w-]+)", head[:2048], re.I)
    if m:
        name = m.group(1)
        return name.decode("ascii", "ignore") if isinstance(name, bytes) else name
    return "utf-8"


class LinkPreviewer:
    def __init__(self, *, allow_loopback: bool = False, hosts: Mapping[str, str] | None = None,
                 transport: httpx2.AsyncBaseTransport | None = None, resolver: ssrf.Resolver | None = None,
                 clock: Any = time.monotonic) -> None:
        self.allow_loopback = allow_loopback
        self.hosts = {k.lower(): v.rstrip("/") for k, v in (hosts or {}).items()} if allow_loopback else {}  # 테스트 전용 (loopback 허용일 때만)
        self.transport = transport
        self.resolver = resolver
        self.clock = clock
        self._cache: OrderedDict[str, tuple[float, Preview | None]] = OrderedDict()
        self._images: OrderedDict[str, tuple[str, bytes]] = OrderedDict()
        self._image_bytes = 0
        self._inflight: dict[str, asyncio.Task[Preview | None]] = {}
        self._hits: dict[str, deque[float]] = {}

    # ── 캐시 · 한도 ──
    def _cached(self, url: str) -> tuple[bool, Preview | None]:
        got = self._cache.get(url)
        if got is None:
            return False, None
        expires, value = got
        if expires < self.clock():
            self._cache.pop(url, None)
            return False, None
        self._cache.move_to_end(url)
        return True, value

    def _remember(self, url: str, value: Preview | None) -> None:
        self._cache[url] = (self.clock() + (TTL_OK if value is not None else TTL_FAIL), value)
        self._cache.move_to_end(url)
        while len(self._cache) > CACHE_SIZE:
            self._cache.popitem(last=False)

    def _store_image(self, data: bytes, mime: str) -> str:
        sha = hashlib.sha256(data).hexdigest()[:32]
        if sha not in self._images:
            self._images[sha] = (mime, data)
            self._image_bytes += len(data)
            while self._image_bytes > IMAGE_BUDGET and self._images:
                _, (_, old) = self._images.popitem(last=False)
                self._image_bytes -= len(old)
        self._images.move_to_end(sha)
        return sha

    def image(self, sha: str) -> tuple[str, bytes] | None:
        got = self._images.get(sha)
        if got is not None:
            self._images.move_to_end(sha)
        return got

    def _allow(self, user: str) -> bool:
        now = self.clock()
        q = self._hits.setdefault(user, deque())
        while q and q[0] <= now - 60.0:
            q.popleft()
        if len(q) >= RATE_PER_MIN:
            return False
        q.append(now)
        return True

    # ── 받기 ──
    def _target(self, url: str) -> str:
        """E2E 가짜 사이트 이름 → loopback 주소 (hosts 가 있을 때만 · 검사는 바뀐 주소로 다시)."""
        parts = urlsplit(url)
        origin = self.hosts.get((parts.hostname or "").lower())
        if not origin:
            return url
        return canonical(origin + (parts.path or "/") + (f"?{parts.query}" if parts.query else ""), allow_loopback=self.allow_loopback)

    async def _get(self, client: httpx2.AsyncClient, url: str, cap: int, accept: str) -> tuple[str, str, bytes]:
        """GET (리다이렉트마다 다시 검사 · cap 바이트까지만 읽음) → (마지막 주소, Content-Type, 바이트)."""
        target = canonical(url, allow_loopback=self.allow_loopback)
        for _ in range(MAX_REDIRECTS + 1):
            wire = self._target(target)
            async with client.stream("GET", wire, headers={"accept": accept}) as res:
                if res.status_code in (301, 302, 303, 307, 308):
                    location = res.headers.get("location")
                    if not location:
                        raise Blocked("bad_url")
                    target = canonical(urljoin(target, location), allow_loopback=self.allow_loopback)
                    continue
                if res.status_code != 200:
                    raise Blocked("status")
                body = bytearray()
                async for chunk in res.aiter_bytes():
                    body += chunk
                    if len(body) > cap:
                        break
                return target, res.headers.get("content-type", ""), bytes(body[: cap + 1])
        raise Blocked("too_many_redirects")

    async def _fetch(self, url: str) -> Preview | None:
        client = ssrf.http_client(allow_loopback=self.allow_loopback, headers={"user-agent": USER_AGENT}, timeout=httpx2.Timeout(TOTAL_S),
                                  transport=self.transport, resolver=self.resolver)
        try:
            async with client, asyncio.timeout(TOTAL_S):
                final, ctype, raw = await self._get(client, url, MAX_HTML, "text/html,application/xhtml+xml;q=0.9")
                if "html" not in ctype.lower():
                    return None
                html = raw[:MAX_HTML].decode(_charset(ctype, raw), errors="replace")
                title, desc, site, image_url = parse_html(html, final)
                sha = None
                if image_url:
                    try:
                        _, _, data = await self._get(client, image_url, MAX_IMAGE, "image/png,image/jpeg,image/webp,image/gif")
                        mime = sniff_image(data)
                        if mime in _IMAGE_TYPES and len(data) <= MAX_IMAGE:
                            sha = self._store_image(data, mime)
                    except (Blocked, ssrf.Blocked, httpx2.HTTPError, LookupError):
                        sha = None
                if not title:
                    return None
                host = urlsplit(url).hostname or ""
                return Preview(url=url, title=title, description=desc, site=site or host.removeprefix("www."), image=sha)
        except (Blocked, ssrf.Blocked, httpx2.HTTPError, TimeoutError, LookupError, UnicodeError):
            return None

    async def preview(self, raw: str, *, user: str) -> Preview | None:
        """주소 하나 → 미리보기 (못 만들면 None). 막힌 주소 = Blocked · 한도 = RateLimited."""
        url = canonical(raw, allow_loopback=self.allow_loopback)
        hit, value = self._cached(url)
        if hit:
            return value
        task = self._inflight.get(url)
        if task is None:
            if not self._allow(user):
                raise RateLimited()
            task = asyncio.ensure_future(self._fetch(url))
            self._inflight[url] = task
            task.add_done_callback(lambda _t, u=url: self._inflight.pop(u, None))
        value = await asyncio.shield(task)
        self._remember(url, value)
        return value


def parse_hosts(raw: str | None) -> dict[str, str]:
    """'a.test=http://127.0.0.1:4014,b.test=…' → {a.test: http://127.0.0.1:4014} (E2E 가짜 사이트 · loopback 허용일 때만 쓴다)."""
    out: dict[str, str] = {}
    for piece in (raw or "").split(","):
        name, eq, origin = piece.strip().partition("=")
        if eq and name.strip() and origin.strip():
            out[name.strip().lower()] = origin.strip()
    return out
