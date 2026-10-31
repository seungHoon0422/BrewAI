"""MCP 클라이언트 = 공식 SDK `mcp.Client` + Streamable HTTP 만 (ADR-0013). 요청마다 짧게 연결하고 닫는다 (P1 규모 · 서버가 stateless 여도 됨).

  list_tools   tools/list 를 cursor 로 끝까지(최대 20쪽) → 다듬기(trim_tool) → Tool 목록. 캐시는 ToolCache (사람마다 · 공통 '*')
  call_tool    tools/call → cap_result (12KB 상한 · 목록이면 '나머지 N개')
  probe        토큰 없이 한 번: 401 이면 OAuth 서버 (WWW-Authenticate 의 resource_metadata · scope) · 아니면 도구 목록까지
접속은 전부 ssrf.http_client (검사한 IP 로만 · 리다이렉트는 SDK 가 같은 출처만). 401 · 403 은 감시 transport 가 보고 NeedsAuth 로 바꾼다.
프로토콜: mode auto = server/discover(2026-07-28) → 안 되면 initialize(옛 방식). 서버마다 알아낸 방식은 프로세스 메모리에 둔다 (다음 연결 왕복 -1).

이름 = `<handle>__<tool>` · [A-Za-z0-9_-] · 64자 (OpenAI · Anthropic 도구 이름 규칙). 넘거나 다른 글자가 있으면 앞부분 + sha256 8자 → NameMap 이 되돌린다.
스키마 다듬기 = `$schema` · `title` · `examples` · `$comment` 제거 · 도구 설명 400자 · 속성 설명 120자 · 깊이 12.
도구 설명 · 결과는 데이터다 (서버가 쓴 글 = 프롬프트 주입 경로) → 여기선 자르고 다듬기만, 지시로 해석하지 않는다.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import re
import sqlite3
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import httpx2
import mcp_types as types
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.exceptions import MCPError
from mcp_types.version import MODERN_PROTOCOL_VERSIONS

from . import ssrf

log = logging.getLogger("conductor.mcp")


class _QuietNotListed(logging.Filter):
    """SDK 경고 'Tool X not listed by server' 는 뺀다: 요청마다 새로 연결하므로 call 앞에 list 가 없는 게 정상 (스키마는 우리 캐시가 갖고 있다)."""

    def filter(self, record: logging.LogRecord) -> bool:
        return "not listed by server" not in record.getMessage()


logging.getLogger("client").addFilter(_QuietNotListed())  # mcp.client.session 의 logger 이름이 "client"

NAME_MAX = 64
NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
DESC_MAX = 400
PROP_DESC_MAX = 120
SCHEMA_DEPTH = 12
MAX_RESULT_BYTES = 12 * 1024
MAX_PAGES = 20
MAX_TOOLS = 500  # 서버 하나에서 받는 도구 수 상한 (넘으면 버림 · 로그)
DEFAULT_TTL_MS = 10 * 60 * 1000
_DROP_KEYS = frozenset({"$schema", "title", "examples", "$comment", "$id"})
# 이름 첫 낱말이 이것이면 쓰기 도구로 본다 (annotations 가 없을 때만 · 힌트일 뿐 = 표시용)
WRITE_VERBS = frozenset({
    "create", "add", "new", "insert", "post", "send", "update", "edit", "modify", "patch", "set", "put", "write", "save",
    "delete", "remove", "del", "destroy", "archive", "close", "merge", "move", "rename", "assign", "comment", "reply",
    "upload", "publish", "submit", "approve", "reject", "cancel", "revoke", "invite", "transfer", "run", "execute", "trigger",
})
CLIENT_INFO = types.Implementation(name="brewai-conductor", version="0.1")

AuthReason = Literal["not_connected", "expired", "insufficient_scope"]


class McpError(Exception):
    """unreachable · blocked · timeout · protocol · server_error · bad_tool. 메시지에 토큰 · 주소의 비밀 칸을 넣지 않는다."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail[:200]


class NeedsAuth(McpError):
    """401 (연결 안 됨 · 토큰 만료) · 403 insufficient_scope (scope 올리기). resource_metadata · scope = WWW-Authenticate 에서."""

    def __init__(self, reason: AuthReason, *, resource_metadata: str | None = None, scope: str | None = None) -> None:
        super().__init__("needs_auth", reason)
        self.reason: AuthReason = reason
        self.resource_metadata = resource_metadata
        self.scope = scope


# ── 도구 다듬기 ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Tool:
    name: str  # 서버의 원래 이름 (tools/call 에 그대로)
    description: str
    input_schema: dict[str, Any]
    write: bool  # 쓰기 도구 (도구 카드 '쓰기' 표시 · slice 07 승인의 후보)
    title: str | None = None
    tokens_est: int = 0  # 모델에 실릴 때 대략 토큰 (이름 + 설명 + 스키마)

    def to_json(self) -> dict[str, Any]:
        return {"name": self.name, "title": self.title, "description": self.description, "input_schema": self.input_schema,
                "write": self.write, "tokens_est": self.tokens_est}

    @classmethod
    def from_json(cls, d: Mapping[str, Any]) -> Tool:
        return cls(name=d["name"], description=d.get("description") or "", input_schema=d.get("input_schema") or _EMPTY_SCHEMA,
                   write=bool(d.get("write")), title=d.get("title"), tokens_est=int(d.get("tokens_est") or 0))


_EMPTY_SCHEMA: dict[str, Any] = {"type": "object", "properties": {}}


def clean_text(raw: Any, limit: int) -> str:
    """한 줄 · 제어 문자 없음 · limit 자 (넘으면 …)."""
    text = " ".join(str(raw or "").split())
    text = "".join(c for c in text if c.isprintable())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def trim_schema(node: Any, *, depth: int = 0) -> Any:
    """JSON Schema 에서 모델에 필요 없는 칸을 뺀다. properties 안의 이름(예: 'title' 이라는 속성)은 그대로 둔다."""
    if depth > SCHEMA_DEPTH:
        return {}
    if isinstance(node, list):
        return [trim_schema(v, depth=depth + 1) for v in node]
    if not isinstance(node, dict):
        return node
    out: dict[str, Any] = {}
    for k, v in node.items():
        if k in _DROP_KEYS:
            continue
        if k in ("properties", "$defs", "definitions", "patternProperties") and isinstance(v, dict):
            out[k] = {pk: trim_schema(pv, depth=depth + 1) for pk, pv in v.items()}
        elif k == "description" and isinstance(v, str):
            out[k] = clean_text(v, PROP_DESC_MAX)
        else:
            out[k] = trim_schema(v, depth=depth + 1)
    return out


def estimate_tokens(obj: Any) -> int:
    """대략 토큰 = ASCII 4글자에 1 + 그 밖(한글 등) 글자마다 1. 실측은 E2E (게이트웨이 usage)."""
    text = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    ascii_n = sum(1 for c in text if ord(c) < 128)
    return math.ceil(ascii_n / 4) + (len(text) - ascii_n)


def words(name: str) -> list[str]:
    """search_issues · issues.search · searchIssues · list-issues → ['search', 'issues']."""
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name)
    spaced = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", spaced)
    return [w for w in re.split(r"[^A-Za-z0-9]+", spaced.lower()) if w]


def is_write(name: str, annotations: Mapping[str, Any] | None) -> bool:
    ann = annotations or {}
    if ann.get("readOnlyHint") is True:
        return False
    if ann.get("readOnlyHint") is False or ann.get("destructiveHint") is True:
        return True
    w = words(name)
    return bool(w) and (w[0] in WRITE_VERBS or (len(w) > 1 and w[-1] in WRITE_VERBS and w[0] not in ("get", "list", "search", "find", "read", "fetch")))


def trim_tool(raw: Mapping[str, Any]) -> Tool | None:
    """tools/list 의 도구 하나(JSON 모양 · camelCase) → Tool. 이름이 없거나 이상하면 None (버림)."""
    name = raw.get("name")
    if not isinstance(name, str) or not name or len(name) > 128 or any(not c.isprintable() for c in name):
        return None
    schema = raw.get("inputSchema")
    schema = trim_schema(schema) if isinstance(schema, dict) else dict(_EMPTY_SCHEMA)
    if schema.get("type") != "object":
        schema = {"type": "object", "properties": {}}
    ann = raw.get("annotations") if isinstance(raw.get("annotations"), dict) else {}
    title = raw.get("title") or ann.get("title")
    desc = clean_text(raw.get("description") or "", DESC_MAX)
    tool = Tool(name=name, description=desc, input_schema=schema, write=is_write(name, ann),
                title=clean_text(title, 80) if isinstance(title, str) and title.strip() else None)
    return replace(tool, tokens_est=estimate_tokens({"name": name, "description": desc, "parameters": schema}))


# ── 이름 ─────────────────────────────────────────────────────────────────────────


def tool_name(handle: str, tool: str) -> str:
    """모델이 부르는 이름. 짧고 안전하면 `<handle>__<tool>` 그대로 · 아니면 안전한 앞부분 + '_' + sha256 8자 (64자 안)."""
    plain = f"{handle}__{tool}"
    if NAME_RE.match(plain):
        return plain
    digest = hashlib.sha256(tool.encode("utf-8")).hexdigest()[:8]
    room = NAME_MAX - len(handle) - 2 - 1 - len(digest)
    base = re.sub(r"[^A-Za-z0-9_-]+", "_", tool).strip("_")[: max(room, 0)].rstrip("_")
    return f"{handle}__{base}_{digest}" if base else f"{handle}__{digest}"


@dataclass
class NameMap:
    """한 서버(handle)의 공개 이름 ↔ 원래 이름."""

    handle: str
    to_public: dict[str, str] = field(default_factory=dict)
    to_original: dict[str, str] = field(default_factory=dict)

    @classmethod
    def of(cls, handle: str, tools: Iterable[str]) -> NameMap:
        m = cls(handle)
        for t in tools:
            public = tool_name(handle, t)
            m.to_public[t] = public
            m.to_original[public] = t
        return m

    def public(self, tool: str) -> str:
        return self.to_public.get(tool) or tool_name(self.handle, tool)

    def original(self, public: str) -> str | None:
        return self.to_original.get(public)


def split_public(public: str) -> tuple[str, str] | None:
    """'linear__list_issues' → ('linear', 'list_issues'). handle 에는 '__' 가 없다 (catalog.HANDLE_RE)."""
    handle, sep, rest = public.partition("__")
    return (handle, rest) if sep and handle and rest else None


# ── 결과 상한 ───────────────────────────────────────────────────────────────────


def _size(obj: Any) -> int:
    return len(json.dumps(obj, ensure_ascii=False).encode("utf-8"))  # 기본 구분자(공백 있음) = 어떤 직렬화보다 크거나 같게 잰다


def _cut_text(text: str, limit: int) -> tuple[str, int]:
    data = text.encode("utf-8")
    if len(data) <= limit:
        return text, 0
    cut = data[:limit].decode("utf-8", errors="ignore")
    return cut, len(data) - len(cut.encode("utf-8"))


def _largest_list(obj: Any) -> tuple[list[Any] | None, str | None]:
    if isinstance(obj, list):
        return obj, None
    if isinstance(obj, dict):
        lists = [(k, v) for k, v in obj.items() if isinstance(v, list)]
        if lists:
            k, v = max(lists, key=lambda kv: _size(kv[1]))
            return v, k
    return None, None


def content_of(result: types.CallToolResult) -> tuple[Any, bool]:
    """CallToolResult → (본문, is_error). structuredContent 가 있으면 그것 · 아니면 글 블록을 이어 붙이고 JSON 이면 풀어 둔다."""
    if result.structured_content is not None and not result.is_error:
        return result.structured_content, False
    parts: list[str] = []
    skipped = 0
    for block in result.content:
        if isinstance(block, types.TextContent):
            parts.append(block.text)
        elif isinstance(block, types.EmbeddedResource) and isinstance(block.resource, types.TextResourceContents):
            parts.append(block.resource.text)
        elif isinstance(block, types.ResourceLink):
            parts.append(f"{block.name}: {block.uri}")
        else:
            skipped += 1  # 그림 · 소리 · 바이너리 = 모델에 안 싣는다
    text = "\n".join(parts)
    if skipped:
        text += f"\n(그림이나 파일 {skipped}개는 뺐어요)"
    if len(parts) == 1 and not skipped:
        try:
            return json.loads(text), bool(result.is_error)
        except ValueError:
            pass
    return text, bool(result.is_error)


def cap_result(body: Any, *, is_error: bool = False, limit: int = MAX_RESULT_BYTES) -> dict[str, Any]:
    """도구 결과 → 모델에 줄 dict (12KB 아래). 목록은 뒤에서부터 빼고 '나머지 N개' · 글은 자르고 '나머지 N바이트'."""
    if is_error:
        text = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)
        cut, _ = _cut_text(text, 2000)
        return {"error": "tool_error", "message": cut or "도구가 실패했어요"}
    out: dict[str, Any] = {"result": body}
    budget = limit - 200  # 표시 칸 몫
    if _size(out) <= limit:
        return out
    items, key = _largest_list(body)
    if items is not None:
        kept = list(items)
        lo, hi = 0, len(kept)
        # 이분 탐색 = 들어가는 만큼 최대
        while lo < hi:
            mid = (lo + hi + 1) // 2
            trial = kept[:mid] if key is None else {**body, key: kept[:mid]}
            if _size({"result": trial}) <= budget:
                lo = mid
            else:
                hi = mid - 1
        if lo > 0 or len(kept) == 0:
            trial = kept[:lo] if key is None else {**body, key: kept[:lo]}
            omitted = len(kept) - lo
            return {"result": trial, "truncated": True, "omitted": omitted, "note": f"나머지 {omitted}개는 길어서 뺐어요"}
    text = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)
    cut, rest = _cut_text(text, budget)
    return {"result": cut, "truncated": True, "omitted_bytes": rest, "note": f"나머지 {rest}바이트는 길어서 뺐어요"}


# ── 도구 목록 캐시 (mcp_tool_cache) ─────────────────────────────────────────────────


@dataclass(frozen=True)
class CachedTools:
    tools: list[Tool]
    tokens_est: int
    fetched_at: str
    fresh: bool


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


class ToolCache:
    """(server, user_key) → 다듬은 도구 목록. user_key = 사람 id (OAuth = 계정마다 도구가 다를 수 있다) · 인증 없는 서버 = '*'."""

    SHARED = "*"

    def __init__(self, store: Any, *, clock: Callable[[], datetime] | None = None) -> None:
        self.store = store
        self.clock = clock or (lambda: datetime.now(UTC))

    def get(self, server_id: str, user_key: str, *, stale_ok: bool = False) -> CachedTools | None:
        rows = self.store.query("SELECT * FROM mcp_tool_cache WHERE server_id = ? AND user_key = ?", (server_id, user_key))
        if not rows:
            return None
        r = rows[0]
        fetched = datetime.fromisoformat(r["fetched_at"].replace("Z", "+00:00"))
        fresh = self.clock() < fetched + timedelta(milliseconds=r["ttl_ms"])
        if not fresh and not stale_ok:
            return None
        try:
            tools = [Tool.from_json(t) for t in json.loads(r["tools_json"])]
        except (ValueError, KeyError, TypeError):
            return None
        return CachedTools(tools=tools, tokens_est=r["tokens_est"], fetched_at=r["fetched_at"], fresh=fresh)

    def put(self, server_id: str, user_key: str, tools: list[Tool], *, ttl_ms: int | None = None, db: sqlite3.Connection | None = None) -> CachedTools:
        """저장 + mcp_servers 의 도구 수 · 예상 토큰도 갱신 (관리자 표 · 추가 대화상자 미리 확인)."""
        at = _iso(self.clock())
        total = sum(t.tokens_est for t in tools)
        payload = json.dumps([t.to_json() for t in tools], ensure_ascii=False, separators=(",", ":"))

        def write(conn: sqlite3.Connection) -> None:
            conn.execute(
                "INSERT INTO mcp_tool_cache (server_id, user_key, tools_json, tool_count, tokens_est, fetched_at, ttl_ms) VALUES (?, ?, ?, ?, ?, ?, ?)"
                " ON CONFLICT (server_id, user_key) DO UPDATE SET tools_json = excluded.tools_json, tool_count = excluded.tool_count,"
                " tokens_est = excluded.tokens_est, fetched_at = excluded.fetched_at, ttl_ms = excluded.ttl_ms",
                (server_id, user_key, payload, len(tools), total, at, ttl_ms or DEFAULT_TTL_MS),
            )
            conn.execute(
                "UPDATE mcp_servers SET tool_count = ?, tool_tokens_est = ?, last_checked_at = ?, last_error = NULL WHERE id = ?",
                (len(tools), total, at, server_id),
            )

        if db is not None:
            write(db)
        else:
            with self.store.tx() as conn:
                write(conn)
        return CachedTools(tools=tools, tokens_est=total, fetched_at=at, fresh=True)

    def invalidate(self, server_id: str, user_key: str | None = None) -> None:
        with self.store.tx() as db:
            if user_key is None:
                db.execute("DELETE FROM mcp_tool_cache WHERE server_id = ?", (server_id,))
            else:
                db.execute("DELETE FROM mcp_tool_cache WHERE server_id = ? AND user_key = ?", (server_id, user_key))


# ── 연결 ────────────────────────────────────────────────────────────────────────


class _Watch(httpx2.AsyncBaseTransport):
    """마지막 401 · 403 응답의 WWW-Authenticate 를 기억한다 (SDK 는 그냥 '서버 오류'로 바꿔 버린다)."""

    def __init__(self, inner: httpx2.AsyncBaseTransport) -> None:
        self.inner = inner
        self.status: int | None = None
        self.www_authenticate: str | None = None

    async def handle_async_request(self, request: httpx2.Request) -> httpx2.Response:
        res = await self.inner.handle_async_request(request)
        if res.status_code in (401, 403):
            self.status = res.status_code
            self.www_authenticate = res.headers.get("www-authenticate")
        return res

    async def aclose(self) -> None:
        await self.inner.aclose()


def www_auth_field(header: str | None, name: str) -> str | None:
    if not header:
        return None
    m = re.search(rf'{name}=(?:"([^"]*)"|([^\s,]+))', header)
    return (m.group(1) if m.group(1) is not None else m.group(2)) if m else None


@dataclass(frozen=True)
class Probe:
    auth: Literal["oauth", "none"]
    tools: list[Tool] | None  # oauth = 로그인 전이라 모름 (None)
    resource_metadata: str | None = None
    scope: str | None = None
    server_name: str | None = None


def _flatten(exc: BaseException) -> list[BaseException]:
    if isinstance(exc, BaseExceptionGroup):
        out: list[BaseException] = []
        for e in exc.exceptions:
            out.extend(_flatten(e))
        return out
    return [exc]


class McpClient:
    """연결 하나 = 요청 하나 (list · call). transport = 테스트용(MockTransport) · 기본 = ssrf.pinned_transport."""

    def __init__(
        self, *, allow_loopback: bool = False, transport: httpx2.AsyncBaseTransport | None = None,
        resolver: ssrf.Resolver | None = None, timeout_s: float = 30.0,
    ) -> None:
        self.allow_loopback = allow_loopback
        self._transport = transport
        self._resolver = resolver
        self.timeout_s = timeout_s
        self._era: dict[str, tuple[str, types.DiscoverResult | None]] = {}  # url → (mode, discover) 다음 연결에 재사용

    def _http(self, token: str | None) -> tuple[httpx2.AsyncClient, _Watch]:
        inner = self._transport or ssrf.pinned_transport(allow_loopback=self.allow_loopback, resolver=self._resolver)
        watch = _Watch(inner)
        headers = {"user-agent": "BrewAI-conductor/0.1"}
        if token:
            headers["authorization"] = f"Bearer {token}"
        return httpx2.AsyncClient(transport=watch, headers=headers, timeout=httpx2.Timeout(self.timeout_s, read=self.timeout_s),
                                  follow_redirects=False, trust_env=False), watch

    async def _run(self, url: str, token: str | None, op: Callable[[Client], Any]) -> Any:
        try:
            target = ssrf.canonical_url(url, allow_loopback=self.allow_loopback)
        except ssrf.Blocked as e:
            raise McpError("blocked", e.code) from None
        for attempt in range(2):
            mode, prior = self._era.get(target, ("auto", None))
            http, watch = self._http(token)
            connected = False
            try:
                async with http:
                    client = Client(streamable_http_client(target, http_client=http), mode=mode, prior_discover=prior,
                                    cache=None, client_info=CLIENT_INFO, read_timeout_seconds=self.timeout_s)
                    async with client:
                        connected = True  # 여기부터 실패는 다시 보내지 않는다 (쓰기 도구가 두 번 실행되면 안 된다)
                        result = await op(client)
                        s = client.session
                        if s.discover_result is not None and client.protocol_version in MODERN_PROTOCOL_VERSIONS:
                            self._era[target] = (client.protocol_version, s.discover_result)
                        else:
                            self._era[target] = ("legacy", None)
                        return result
            except BaseException as exc:  # noqa: BLE001 — 아래에서 하나로 바꾼다 (취소는 그대로)
                errs = _flatten(exc)
                if any(isinstance(e, KeyboardInterrupt | SystemExit | asyncio.CancelledError) for e in errs):
                    raise
                if watch.status in (401, 403):
                    err = www_auth_field(watch.www_authenticate, "error")
                    if watch.status == 403 and err != "insufficient_scope":
                        raise McpError("forbidden") from None
                    reason: AuthReason = "insufficient_scope" if watch.status == 403 else ("expired" if token else "not_connected")
                    raise NeedsAuth(reason, resource_metadata=www_auth_field(watch.www_authenticate, "resource_metadata"),
                                    scope=www_auth_field(watch.www_authenticate, "scope")) from None
                if attempt == 0 and not connected and target in self._era:  # 연결 단계 실패 = 서버가 방식을 바꿨을 수 있다 → 한 번 auto 로
                    self._era.pop(target, None)
                    continue
                for e in errs:
                    if isinstance(e, McpError):
                        raise e from None
                    if isinstance(e, ssrf.Blocked):
                        raise McpError("blocked", e.code) from None
                for e in errs:
                    if isinstance(e, TimeoutError | httpx2.TimeoutException):
                        raise McpError("timeout") from None
                    if isinstance(e, httpx2.HTTPError | OSError):
                        raise McpError("unreachable", type(e).__name__) from None
                    if isinstance(e, MCPError):
                        raise McpError("server_error", str(e.error.message if hasattr(e, "error") else e)) from None
                log.warning("mcp request failed: %s", ", ".join(type(e).__name__ for e in errs))
                raise McpError("protocol", type(errs[0]).__name__) from None
        raise McpError("protocol")  # pragma: no cover

    async def list_tools(self, url: str, *, token: str | None = None, max_pages: int = MAX_PAGES) -> list[Tool]:
        async def op(c: Client) -> list[Tool]:
            out: list[Tool] = []
            seen: set[str] = set()
            cursor: str | None = None
            for _ in range(max_pages):
                page = await c.list_tools(cursor=cursor, cache_mode="bypass")
                for t in page.tools:
                    tool = trim_tool(t.model_dump(by_alias=True, mode="json", exclude_none=True))
                    if tool and tool.name not in seen and len(out) < MAX_TOOLS:
                        seen.add(tool.name)
                        out.append(tool)
                if not page.next_cursor or page.next_cursor == cursor:
                    break
                cursor = page.next_cursor
            return out

        return await self._run(url, token, op)

    async def call_tool(self, url: str, tool: str, arguments: dict[str, Any] | None, *, token: str | None = None,
                        limit: int = MAX_RESULT_BYTES) -> dict[str, Any]:
        async def op(c: Client) -> dict[str, Any]:
            result = await c.call_tool(tool, arguments or {})
            body, is_error = content_of(result)
            return cap_result(body, is_error=is_error, limit=limit)

        return await self._run(url, token, op)

    async def probe(self, url: str, *, token: str | None = None) -> Probe:
        """추가 대화상자 '미리 확인' · 관리자 '연결 테스트'. 401 = OAuth (도구 수는 로그인 뒤)."""
        try:
            tools = await self.list_tools(url, token=token)
        except NeedsAuth as e:
            return Probe(auth="oauth", tools=None, resource_metadata=e.resource_metadata, scope=e.scope)
        return Probe(auth="none" if token is None else "oauth", tools=tools)
