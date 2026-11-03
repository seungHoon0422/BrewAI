"""나가는 주소 검사 (SSRF) — MCP 서버 · OAuth 서버 · 메타데이터 · 토큰 주소 모두 이 길로만 (ADR-0013).

규칙
  scheme   https 만. http 는 loopback 호스트 + allow_loopback(테스트 전용 · settings.mcp_loopback_ok) 일 때만
  주소     userinfo(user:pass@) 금지 · fragment 버림 · 호스트 소문자 + IDNA · 기본 포트 생략 · 2048자까지
  IP       공인(global) 주소만. 사설 · CGNAT · link-local(169.254 · fe80 = 클라우드 메타데이터) · 멀티캐스트 · 예약 · 0.0.0.0 ·
           IPv4-mapped · 6to4 · Teredo · NAT64 안에 숨은 IPv4 도 꺼내 본다. loopback 은 allow_loopback 일 때만
  접속     이름을 한 번 풀고(getaddrinfo) 나온 IP 가 **모두** 통과해야 → 그 IP 로 직접 접속 (DNS rebinding: 검사 뒤 다시 풀지 않는다)
           TLS SNI · 인증서 검사는 원래 호스트 이름 그대로 (httpcore 가 origin host 로 start_tls)
  리다이렉트 httpx 자동 따라가기 끔. fetch() 는 Location 마다 canonical_url 을 다시 통과해야 따라간다 (IP 는 접속 때 다시)
  프록시   환경변수 프록시 안 씀 (trust_env=False — 프록시가 대신 풀면 검사를 건너뛴다)
"""

from __future__ import annotations

import ipaddress
import re
import socket
from collections.abc import Awaitable, Callable, Iterable
from typing import Any
from urllib.parse import parse_qsl, unquote, urlsplit, urlunsplit

import anyio
import httpcore2
import httpx2
from httpcore2._backends.auto import AutoBackend
from httpcore2._backends.base import SOCKET_OPTION, AsyncNetworkBackend, AsyncNetworkStream

MAX_URL = 2048
MAX_REDIRECTS = 3
DEFAULT_TIMEOUT = httpx2.Timeout(15.0, read=60.0)
_BLOCKED_NAMES = frozenset({"metadata", "metadata.google.internal", "instance-data", "instance-data.ec2.internal"})
_NAT64 = ipaddress.ip_network("64:ff9b::/96")

Resolver = Callable[[str, int], Awaitable[list[str]]]


class Blocked(httpx2.ConnectError):
    """scheme · userinfo · bad_url · host · private_address · resolve_failed · too_many_redirects.
    httpx 의 ConnectError 로 둔다 = mcp SDK · httpx 가 '접속 실패'로 다룬다 (요청이 매달리지 않는다)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _host_is_loopback_name(host: str) -> bool:
    return host == "localhost" or host.endswith(".localhost")


def canonical_url(raw: str, *, allow_loopback: bool = False) -> str:
    """검사 + 정규화. 통과 못 하면 Blocked(code). 결과 = 저장 · 비교 · resource 의 기준 모양."""
    text = (raw or "").strip()
    if not text or len(text) > MAX_URL or any(c.isspace() or ord(c) < 0x20 for c in text):
        raise Blocked("bad_url")
    try:
        parts = urlsplit(text)
        port = parts.port
    except ValueError:
        raise Blocked("bad_url") from None
    scheme = parts.scheme.lower()
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise Blocked("userinfo")
    host = (parts.hostname or "").rstrip(".")
    if not host:
        raise Blocked("bad_url")
    try:
        host = host.encode("idna").decode("ascii").lower() if not _is_ip(host) else str(ipaddress.ip_address(host))
    except UnicodeError:
        raise Blocked("host") from None
    if host in _BLOCKED_NAMES:
        raise Blocked("host")
    loopback_host = _host_is_loopback_name(host) or (_is_ip(host) and ipaddress.ip_address(host).is_loopback)
    if scheme == "http":
        if not (allow_loopback and loopback_host):
            raise Blocked("scheme")
    elif scheme != "https":
        raise Blocked("scheme")
    if loopback_host and not allow_loopback:
        raise Blocked("private_address")
    if _is_ip(host) and ip_blocked(host, allow_loopback=allow_loopback):
        raise Blocked("private_address")
    default = 443 if scheme == "https" else 80
    netloc = f"[{host}]" if ":" in host else host
    if port is not None and port != default:
        netloc += f":{port}"
    return urlunsplit((scheme, netloc, parts.path or "", parts.query, ""))


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


def _embedded_v4(ip: ipaddress.IPv6Address) -> ipaddress.IPv4Address | None:
    if ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    if ip.sixtofour is not None:
        return ip.sixtofour
    if ip.teredo is not None:
        return ip.teredo[1]
    if ip in _NAT64:
        return ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
    return None


def ip_blocked(raw: str, *, allow_loopback: bool = False) -> bool:
    """True = 이 IP 로는 접속하지 않는다."""
    try:
        ip = ipaddress.ip_address(raw.split("%", 1)[0])  # fe80::1%en0 → zone 버림
    except ValueError:
        return True
    if isinstance(ip, ipaddress.IPv6Address):
        inner = _embedded_v4(ip)
        if inner is not None:
            return ip_blocked(str(inner), allow_loopback=allow_loopback)
    if ip.is_loopback:
        return not allow_loopback
    if ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_reserved or ip.is_private:
        return True
    return not ip.is_global  # CGNAT 100.64/10 · 문서용 대역 등


async def system_resolver(host: str, port: int) -> list[str]:
    infos = await anyio.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(str(info[4][0]) for info in infos))


async def resolve(host: str, port: int, *, allow_loopback: bool, resolver: Resolver | None = None) -> list[str]:
    """이름 → IP 목록. 하나라도 막힌 주소면 전부 거부 (섞인 응답 = rebinding · split-horizon 의심)."""
    name = host.strip("[]").rstrip(".").lower()
    if name in _BLOCKED_NAMES:
        raise Blocked("host")
    if _host_is_loopback_name(name):
        if not allow_loopback:
            raise Blocked("private_address")
        name = "127.0.0.1"
    if _is_ip(name):
        if ip_blocked(name, allow_loopback=allow_loopback):
            raise Blocked("private_address")
        return [name]
    try:
        ips = await (resolver or system_resolver)(name, port)
    except OSError:
        raise Blocked("resolve_failed") from None
    if not ips:
        raise Blocked("resolve_failed")
    if any(ip_blocked(ip, allow_loopback=allow_loopback) for ip in ips):
        raise Blocked("private_address")
    return ips


class PinnedBackend(AsyncNetworkBackend):
    """httpcore 접속 = 검사한 IP 로만. TLS 는 httpcore 가 원래 호스트 이름(SNI)으로 이어서 한다."""

    def __init__(self, *, allow_loopback: bool, resolver: Resolver | None = None) -> None:
        self.allow_loopback = allow_loopback
        self.resolver = resolver
        self._inner = AutoBackend()

    async def connect_tcp(
        self, host: str, port: int, timeout: float | None = None, local_address: str | None = None,
        socket_options: Iterable[SOCKET_OPTION] | None = None,
    ) -> AsyncNetworkStream:
        ips = await resolve(host, port, allow_loopback=self.allow_loopback, resolver=self.resolver)
        last: Exception | None = None
        for ip in ips:
            try:
                return await self._inner.connect_tcp(ip, port, timeout=timeout, local_address=local_address, socket_options=socket_options)
            except (httpcore2.ConnectError, httpcore2.ConnectTimeout) as e:
                last = e
        raise last or Blocked("resolve_failed")

    async def connect_unix_socket(self, path: str, timeout: float | None = None, socket_options: Iterable[SOCKET_OPTION] | None = None) -> AsyncNetworkStream:
        raise Blocked("host")  # 유닉스 소켓 = 로컬 자원

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


def pinned_transport(*, allow_loopback: bool, resolver: Resolver | None = None) -> httpx2.AsyncHTTPTransport:
    transport = httpx2.AsyncHTTPTransport(trust_env=False, retries=0)
    transport._pool._network_backend = PinnedBackend(allow_loopback=allow_loopback, resolver=resolver)  # type: ignore[attr-defined]
    return transport


def http_client(
    *, allow_loopback: bool, headers: dict[str, str] | None = None, timeout: httpx2.Timeout | float | None = None,
    transport: httpx2.AsyncBaseTransport | None = None, resolver: Resolver | None = None,
) -> httpx2.AsyncClient:
    """검사하는 클라이언트. transport = 테스트가 넣는 MockTransport (그때도 scheme · 주소 모양 검사는 fetch 가 한다)."""
    return httpx2.AsyncClient(
        transport=transport or pinned_transport(allow_loopback=allow_loopback, resolver=resolver),
        headers=headers, timeout=timeout or DEFAULT_TIMEOUT, follow_redirects=False, trust_env=False,
    )


async def fetch(client: httpx2.AsyncClient, method: str, url: str, *, allow_loopback: bool, max_redirects: int = MAX_REDIRECTS, **kw: Any) -> httpx2.Response:
    """요청 하나 (본문까지 읽음). 리다이렉트는 GET · HEAD 만, Location 도 canonical_url 을 통과해야 · 최대 3번."""
    target = canonical_url(url, allow_loopback=allow_loopback)
    for _ in range(max_redirects + 1):
        res = await client.request(method, target, **kw)
        if res.status_code not in (301, 302, 303, 307, 308) or method.upper() not in ("GET", "HEAD"):
            return res
        location = res.headers.get("location")
        if not location:
            return res
        target = canonical_url(str(res.request.url.join(location)), allow_loopback=allow_loopback)
    raise Blocked("too_many_redirects")


def host_allowed(url: str, patterns: Iterable[str]) -> bool:
    """관리자 주소 허용 목록 (meta mcp.url_allowlist): 'linear.app' = 그 호스트 · '*.example.com' = 하위 호스트만. 빈 목록 = 모두 허용."""
    pats = [p.strip().lower().rstrip(".") for p in patterns if p and p.strip()]
    if not pats:
        return True
    host = (urlsplit(url).hostname or "").lower()
    for p in pats:
        if p.startswith("*."):
            if host.endswith(p[1:]) and host != p[2:]:
                return True
        elif host == p:
            return True
    return False


# 등록 도메인 근사 (PSL 없이 · 의존성 0): 끝 두 칸 · 'co.kr' · 'com.au' 처럼 둘째 칸이 짧은 공용 이름이면 끝 세 칸
#   · 남의 앱이 하위 이름으로 같이 사는 공용 호스팅(vercel.app · github.io …)도 끝 세 칸 = a.vercel.app 과 b.vercel.app 은 다른 사이트
_SECOND_LEVEL = frozenset({"ac", "co", "com", "edu", "go", "gov", "ne", "net", "or", "org"})
_SHARED_HOSTING = frozenset({
    "vercel.app", "github.io", "herokuapp.com", "pages.dev", "workers.dev", "netlify.app", "onrender.com", "fly.dev", "web.app",
    "firebaseapp.com", "appspot.com", "azurewebsites.net", "cloudfront.net", "railway.app", "deno.dev", "ngrok.io", "ngrok-free.app",
    "ngrok.app", "glitch.me", "replit.app", "repl.co", "modal.run", "hf.space", "run.app", "supabase.co", "trycloudflare.com",
})


def site_of(url: str) -> str:
    """주소의 '사이트' (IP · localhost = 호스트 그대로). mcp.linear.app · linear.app → linear.app."""
    host = (urlsplit(url).hostname or "").lower().rstrip(".")
    if not host or _is_ip(host) or "." not in host:
        return host
    labels = host.split(".")
    shared = ".".join(labels[-2:]) in _SHARED_HOSTING
    n = 3 if len(labels) >= 3 and (shared or (len(labels[-1]) == 2 and labels[-2] in _SECOND_LEVEL)) else 2
    return ".".join(labels[-n:])


def same_site(a: str, b: str) -> bool:
    """사용자가 넣은 MCP 서버의 로그인 서버(issuer)가 그 서버와 같은 곳인가 (AS mix-up: 남의 issuer 로 받은 토큰을 이 서버에 보내지 않게)."""
    return bool(site_of(a)) and site_of(a) == site_of(b)


# 주소 query 에 든 비밀값 (?api_key= · ?token= …) — 사용자 서버를 공유하면 가져간 사람 호출에 주인의 비밀이 실린다
_SECRET_PARAM = ("key", "token", "secret", "auth", "sig", "pass", "pwd", "credential", "session")


def has_secret_query(url: str) -> bool:
    keys = [k.lower().replace("-", "").replace("_", "") for k, _ in parse_qsl(urlsplit(url).query, keep_blank_values=True)]
    return any(word in k for k in keys for word in _SECRET_PARAM)


# ── 보여 줄 때 가리기 (관리자 서버 주소의 ?tavilyApiKey= · /s/<키>/mcp 같은 값이 사용자 응답 · 화면 · 로그로 새지 않게) ──
# 호출은 늘 저장한 원래 주소로 (가리는 건 밖으로 내보내는 글만). query 는 값만 가린다 = 이름(키)은 남겨 어떤 칸이 있는지는 보인다
#   · '=' 없는 조각(?sk-abc) = 통째로 · 경로 = 비밀처럼 보이는 칸(아래 _secretish)과 ';' 뒤 matrix 값 · userinfo · fragment
MASK = "***"
_URL_IN_TEXT = re.compile(r"(?i)\b(?:https?|wss?)://[^\s\"'<>]+")
_WORDS = re.compile(r"[a-z]+(?:[-_.][a-z]+)*")  # mcp · sse · model-context-protocol = 낱말 (가리지 않는다)


def _secretish(seg: str) -> bool:
    """경로 한 칸이 키 · 토큰처럼 보이나: 글자 3 + 숫자 3 이상 섞인 10자 이상 (ZSECRET123 · uuid) · 낱말이 아닌 24자 이상 · 'sk-' 같은 머리."""
    s = unquote(seg)
    if len(s) < 8 or _WORDS.fullmatch(s.lower()):
        return False
    letters = sum(c.isalpha() for c in s)
    digits = sum(c.isdigit() for c in s)
    if s.lower().startswith(("sk-", "sk_", "pk_", "tvly-", "ghp_", "xox")):
        return True
    return (len(s) >= 10 and letters >= 3 and digits >= 3) or len(s) >= 24


def _redact_path(path: str) -> str:
    out = []
    for seg in path.split("/"):
        name, semi, params = seg.partition(";")
        name = MASK if _secretish(name) else name
        if semi:
            params = ";".join(f"{k}={MASK}" if eq else MASK for k, eq, _ in (p.partition("=") for p in params.split(";")) if k or eq)
        out.append(name + (semi + params if semi else ""))
    return "/".join(out)


def redact_url(url: str | None) -> str:
    """가린 주소. https://mcp.tavily.com/mcp/?tavilyApiKey=*** · https://mcp.zapier.com/api/mcp/s/***/mcp · 가릴 것이 없으면 그대로."""
    if not url:
        return url or ""
    try:
        parts = urlsplit(url)
        netloc = parts.netloc
    except ValueError:
        return MASK
    if "@" in netloc:
        netloc = f"{MASK}@{netloc.rsplit('@', 1)[1]}"
    query = parts.query
    if query:
        pairs = []
        for piece in query.split("&"):
            if not piece:
                continue
            key, eq, _ = piece.partition("=")
            pairs.append(f"{key}={MASK}" if eq else MASK)  # '=' 없는 조각 = 키 자리에 값(토큰)을 넣는 서버가 있다
        query = "&".join(pairs)
    path = _redact_path(parts.path)
    if netloc == parts.netloc and query == parts.query and path == parts.path and not parts.fragment:
        return url
    return urlunsplit((parts.scheme, netloc, path, query, ""))


def redact_text(text: str) -> str:
    """글 안의 주소마다 redact_url (로그 줄 · 오류 글)."""
    return _URL_IN_TEXT.sub(lambda m: redact_url(m.group(0)), text) if "://" in text else text
