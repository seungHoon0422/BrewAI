"""가짜 MCP 서버 + 가짜 OAuth 서버 (pytest 전용 · httpx2.MockTransport 처리기 하나). 네트워크 없음.

  https://mcp.fake.test/mcp        OAuth 보호 (PRM · 401 + WWW-Authenticate) · 도구 20개(읽기 · 쓰기) · tools/list 8개씩 페이지
                                   modern(server/discover 2026-07-28) 기본 · modern=False 면 옛 initialize 만
  https://auth.fake.test           AS 메타데이터(RFC 8414 · iss 광고) · /register(DCR) · /token(code + PKCE + resource · refresh 회전)
  https://open.fake.test/mcp       인증 없음 · 도구 3개 · 옛 initialize 만
  https://login.other.test         다른 사이트의 AS (같은 처리기 · AS mix-up 시험: prm_as=OTHER_AS 면 PRM 이 이것을 가리킨다)
  https://hybrid.fake.test/mcp     목록은 공개 · tools/call 만 401 (Google 원격 MCP 모양) · PRM = 401 헤더의 /custom/prm 로만
  prm_header_only = PRM 을 /.well-known 에 두지 않고 401 WWW-Authenticate 의 resource_metadata(/custom/prm)로만 알린다
authorize 는 브라우저 대신 fake.authorize(url) 가 바로 code 를 만든다 (사람 = account 이름 · 다른 사람이면 다른 토큰).
e2e/mock/mcp.mjs 와 같은 모양 (그쪽은 진짜 HTTP · 허용 버튼 화면).
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx2

MCP = "https://mcp.fake.test"
AS = "https://auth.fake.test"
OPEN = "https://open.fake.test"
OTHER_AS = "https://login.other.test"
HYBRID = "https://hybrid.fake.test"
PAGE = 8

READ_TOOLS = [
    ("list_issues", "List issues in a team. Filter by state or assignee.", {"team": {"type": "string"}, "state": {"type": "string"}}),
    ("search_issues", "Search issues by text query across all teams.", {"query": {"type": "string", "description": "Text to search", "title": "Query"}}),
    ("get_issue", "Get one issue by id with comments.", {"id": {"type": "string"}}),
    ("list_projects", "List projects.", {}),
    ("get_project", "Get a project by id.", {"id": {"type": "string"}}),
    ("list_teams", "List teams.", {}),
    ("list_users", "List workspace users.", {}),
    ("get_user", "Get a user.", {"id": {"type": "string"}}),
    ("list_cycles", "List cycles of a team.", {"team": {"type": "string"}}),
    ("list_labels", "List issue labels.", {}),
    ("list_comments", "List comments of an issue.", {"issue": {"type": "string"}}),
    ("get_document", "Get a document page.", {"id": {"type": "string"}}),
]
WRITE_TOOLS = [
    ("create_issue", "Create a new issue in a team.", {"team": {"type": "string"}, "title": {"type": "string"}}),
    ("update_issue", "Update an issue (state, assignee, title).", {"id": {"type": "string"}}),
    ("delete_issue", "Delete an issue.", {"id": {"type": "string"}}),
    ("create_comment", "Add a comment to an issue.", {"issue": {"type": "string"}, "body": {"type": "string"}}),
    ("create_project", "Create a project.", {"name": {"type": "string"}}),
    ("archive_project", "Archive a project.", {"id": {"type": "string"}}),
    ("assign_issue", "Assign an issue to a user.", {"id": {"type": "string"}, "user": {"type": "string"}}),
    ("create_document", "Create a document page.", {"title": {"type": "string"}}),
]
OPEN_TOOLS = [
    ("echo", "Echo the text back.", {"text": {"type": "string"}}),
    ("big_list", "Return many rows.", {"n": {"type": "integer"}}),
    ("now", "Current time.", {}),
]


def _tool(name: str, desc: str, props: dict[str, Any], *, write: bool) -> dict[str, Any]:
    return {
        "name": name, "description": desc, "title": name.replace("_", " ").title(),
        "inputSchema": {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "title": f"{name}Args",
                        "properties": props, "examples": [{}]},
        "annotations": {"readOnlyHint": not write, **({"destructiveHint": True} if name.startswith("delete") else {})},
    }


def s256(v: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b"=").decode()


@dataclass
class Fake:
    modern: bool = True
    iss_param: bool = True  # authorize 응답에 iss 를 붙인다 (광고도)
    dcr: bool = True
    pkce: bool = True  # S256 광고
    access_ttl: int = 3600
    prm: bool = True
    prm_header_only: bool = False
    prm_as: str = AS  # PRM authorization_servers[0]
    clients: dict[str, dict[str, Any]] = field(default_factory=dict)
    codes: dict[str, dict[str, Any]] = field(default_factory=dict)
    access: dict[str, dict[str, Any]] = field(default_factory=dict)  # token → {account, scope, resource}
    refresh: dict[str, dict[str, Any]] = field(default_factory=dict)
    calls: list[tuple[str, str]] = field(default_factory=list)  # (account, tool)
    seen_auth: list[str | None] = field(default_factory=list)
    token_requests: int = 0
    refresh_requests: int = 0
    registrations: int = 0
    log: list[str] = field(default_factory=list)
    revoke_auth: list[str | None] = field(default_factory=list)  # /revoke 요청의 Authorization (client 인증 확인)

    @property
    def transport(self) -> httpx2.MockTransport:
        return httpx2.MockTransport(self.handler)

    # ── 브라우저 대신 ──
    def authorize(self, url: str, *, account: str = "alice", deny: bool = False, iss: str | None = "default") -> dict[str, str]:
        q = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
        assert q["response_type"] == "code" and q["code_challenge_method"] == "S256"
        assert q["client_id"] in self.clients, "등록 안 된 client"
        assert q["redirect_uri"] in self.clients[q["client_id"]]["redirect_uris"]
        out = {"state": q["state"]}
        if iss == "default":
            iss = AS if self.iss_param else None
        if iss is not None:
            out["iss"] = iss
        if deny:
            return {**out, "error": "access_denied"}
        code = "c_" + secrets.token_urlsafe(16)
        self.codes[code] = {"client_id": q["client_id"], "redirect_uri": q["redirect_uri"], "cc": q["code_challenge"],
                            "resource": q.get("resource"), "scope": q.get("scope", "issues:read"), "account": account}
        return {**out, "code": code}

    def expire_all(self) -> None:
        self.access.clear()

    def revoke_refresh(self) -> None:
        self.refresh.clear()

    # ── HTTP ──
    def handler(self, request: httpx2.Request) -> httpx2.Response:
        url = request.url
        origin = f"{url.scheme}://{url.host}"
        path = url.path
        self.log.append(f"{request.method} {origin}{path}")
        if origin == MCP:
            prm = {"resource": MCP, "authorization_servers": [self.prm_as], "scopes_supported": ["issues:read"]}
            if path == "/.well-known/oauth-protected-resource/mcp" or path == "/.well-known/oauth-protected-resource":
                if not self.prm or self.prm_header_only:
                    return httpx2.Response(404)
                return httpx2.Response(200, json=prm)
            if path == "/custom/prm" and self.prm_header_only:
                return httpx2.Response(200, json=prm)
            if path == "/.well-known/oauth-authorization-server" and not self.prm:
                return self._as_meta(MCP)
            if path == "/mcp":
                return self._mcp(request, protected=True)
        if origin == OPEN and path == "/mcp":
            return self._mcp(request, protected=False)
        if origin == HYBRID:
            if path == "/custom/prm":
                return httpx2.Response(200, json={"resource": f"{HYBRID}/mcp", "authorization_servers": [self.prm_as]})
            if path == "/mcp":
                if request.method == "POST" and json.loads(request.content).get("method") == "tools/call":
                    return httpx2.Response(401, headers={"www-authenticate": f'Bearer resource_metadata="{HYBRID}/custom/prm"'})
                return self._mcp(request, protected=False)
        if origin in (AS, OTHER_AS):
            if path == "/.well-known/oauth-authorization-server":
                return self._as_meta(origin)
            if path == "/register" and request.method == "POST":
                return self._register(request)
            if path == "/token" and request.method == "POST":
                return self._token(request)
            if path == "/revoke" and request.method == "POST":
                form = parse_qs(request.content.decode())
                self.revoke_auth.append(request.headers.get("authorization"))
                self.refresh.pop(form.get("token", [""])[0], None)
                return httpx2.Response(200)
        return httpx2.Response(404, json={"error": "not_found"})

    def _as_meta(self, issuer: str) -> httpx2.Response:
        base = issuer if issuer in (AS, OTHER_AS) else MCP
        meta = {
            "issuer": issuer, "authorization_endpoint": f"{base}/authorize", "token_endpoint": f"{base}/token",
            "revocation_endpoint": f"{base}/revoke", "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"], "token_endpoint_auth_methods_supported": ["none"],
            "code_challenge_methods_supported": ["S256"] if self.pkce else ["plain"], "scopes_supported": ["issues:read", "issues:write"],
            "authorization_response_iss_parameter_supported": self.iss_param,
        }
        if self.dcr:
            meta["registration_endpoint"] = f"{base}/register"
        return httpx2.Response(200, json=meta)

    def _register(self, request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content)
        self.registrations += 1
        cid = "dcr_" + secrets.token_hex(6)
        self.clients[cid] = {"redirect_uris": body["redirect_uris"], "auth": body.get("token_endpoint_auth_method", "none")}
        return httpx2.Response(201, json={"client_id": cid, "redirect_uris": body["redirect_uris"], "token_endpoint_auth_method": "none"})

    def _issue(self, account: str, scope: str, resource: str | None) -> dict[str, Any]:
        at, rt = "at_" + secrets.token_urlsafe(12), "rt_" + secrets.token_urlsafe(12)
        self.access[at] = {"account": account, "scope": scope, "resource": resource}
        self.refresh[rt] = {"account": account, "scope": scope, "resource": resource}
        return {"access_token": at, "refresh_token": rt, "token_type": "Bearer", "expires_in": self.access_ttl, "scope": scope}

    def _token(self, request: httpx2.Request) -> httpx2.Response:
        form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
        basic = request.headers.get("authorization", "")
        if basic.startswith("Basic ") and "client_id" not in form:  # client_secret_basic (사전 등록 confidential client)
            form["client_id"] = base64.b64decode(basic[6:]).decode().split(":", 1)[0]
        self.token_requests += 1
        if form.get("client_id") not in self.clients:
            return httpx2.Response(401, json={"error": "invalid_client"})
        if form.get("grant_type") == "authorization_code":
            entry = self.codes.pop(form.get("code", ""), None)
            if not entry or entry["redirect_uri"] != form.get("redirect_uri") or entry["client_id"] != form["client_id"]:
                return httpx2.Response(400, json={"error": "invalid_grant"})
            if s256(form.get("code_verifier", "")) != entry["cc"]:
                return httpx2.Response(400, json={"error": "invalid_grant", "error_description": "pkce"})
            if form.get("resource") != entry["resource"] or form.get("resource") != MCP:
                return httpx2.Response(400, json={"error": "invalid_target"})
            return httpx2.Response(200, json=self._issue(entry["account"], entry["scope"], entry["resource"]))
        if form.get("grant_type") == "refresh_token":
            self.refresh_requests += 1
            entry = self.refresh.pop(form.get("refresh_token", ""), None)  # 회전 = 옛 것은 한 번만
            if not entry:
                return httpx2.Response(400, json={"error": "invalid_grant"})
            return httpx2.Response(200, json=self._issue(entry["account"], entry["scope"], entry["resource"]))
        return httpx2.Response(400, json={"error": "unsupported_grant_type"})

    # ── MCP JSON-RPC ──
    def _mcp(self, request: httpx2.Request, *, protected: bool) -> httpx2.Response:
        auth = request.headers.get("authorization")
        self.seen_auth.append(auth)
        who = None
        if protected:
            token = auth[7:] if auth and auth.lower().startswith("bearer ") else None
            who = self.access.get(token or "")
            if who is None:
                where = f"{MCP}/custom/prm" if self.prm_header_only else f"{MCP}/.well-known/oauth-protected-resource/mcp"
                return httpx2.Response(401, headers={"www-authenticate": f'Bearer resource_metadata="{where}", scope="issues:read"'})
        if request.method != "POST":
            return httpx2.Response(405)
        msg = json.loads(request.content)
        if "id" not in msg:  # 알림
            return httpx2.Response(202)
        method, params, rid = msg.get("method"), msg.get("params") or {}, msg["id"]
        modern = self.modern and protected

        def ok(result: dict[str, Any]) -> httpx2.Response:
            if modern:
                result = {"resultType": "complete", **result}
            return httpx2.Response(200, json={"jsonrpc": "2.0", "id": rid, "result": result})

        def err(code: int, message: str) -> httpx2.Response:
            return httpx2.Response(200, json={"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": message}})

        if method == "server/discover":
            if not modern:
                return err(-32601, "Method not found")
            return ok({"supportedVersions": ["2026-07-28"], "capabilities": {"tools": {}}, "ttlMs": 0, "cacheScope": "public",
                       "_meta": {"io.modelcontextprotocol/serverInfo": {"name": "fake-tracker", "version": "1"}}})
        if method == "initialize":
            return ok({"protocolVersion": "2025-11-25", "capabilities": {"tools": {}}, "serverInfo": {"name": "fake", "version": "1"}})
        tools = ([_tool(n, d, p, write=False) for n, d, p in READ_TOOLS] + [_tool(n, d, p, write=True) for n, d, p in WRITE_TOOLS]
                 if protected else [_tool(n, d, p, write=False) for n, d, p in OPEN_TOOLS])
        if method == "tools/list":
            start = int(params.get("cursor") or 0)
            page = tools[start : start + PAGE]
            result: dict[str, Any] = {"tools": page}
            if start + PAGE < len(tools):
                result["nextCursor"] = str(start + PAGE)
            if modern:
                result |= {"ttlMs": 0, "cacheScope": "private"}
            return ok(result)
        if method == "tools/call":
            name = params.get("name")
            args = params.get("arguments") or {}
            if not any(t["name"] == name for t in tools):
                return err(-32602, f"Unknown tool {name}")
            account = who["account"] if who else "anon"
            if protected and name in {n for n, _, _ in WRITE_TOOLS} and "issues:write" not in (who or {}).get("scope", "").split():
                return httpx2.Response(403, headers={"www-authenticate": 'Bearer error="insufficient_scope", scope="issues:write"'})
            self.calls.append((account, name))
            if name == "big_list":
                rows = [{"id": i, "title": f"row {i} " + "x" * 40} for i in range(int(args.get("n", 10)))]
                return ok({"content": [{"type": "text", "text": json.dumps(rows)}], "isError": False})
            if name == "echo":
                return ok({"content": [{"type": "text", "text": str(args.get("text", ""))}], "isError": False})
            return ok({"content": [{"type": "text", "text": json.dumps({"tool": name, "account": account, "args": args})}], "isError": False})
        return err(-32601, "Method not found")


def query_of(location: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(location).query).items()}


def encode(params: dict[str, str]) -> str:
    return urlencode(params)
