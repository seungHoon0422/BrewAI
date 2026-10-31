"""MCP 앱 로그인 = OAuth 2.1 authorization code + PKCE, conductor 가 교환 · 보관 (ADR-0013 · 흐름 = ADR-0010 loopback handoff 그대로).

찾기 (discover)
  ① RFC 9728 보호 자원 메타데이터: 401 의 WWW-Authenticate resource_metadata → /.well-known/oauth-protected-resource{경로} → 루트
     resource 는 서버 주소를 덮어야 한다 (같은 출처 · 경로 접두) = 이 값이 RFC 8707 `resource` · mcp_credentials 의 열쇠
  ② authorization_servers[0] → RFC 8414 · OIDC 메타데이터 (경로 있는 issuer 는 세 가지 위치) · issuer 가 글자 그대로 같아야
     PKCE S256 을 광고하지 않는 서버는 거절 (MCP 규칙) · 엔드포인트는 모두 ssrf.canonical_url 통과
  ③ PRM 이 없는 옛 서버 = 서버 출처를 issuer 로 (2025-03-26 방식)
client = 사전 등록(관리자 콘솔 · mcp_oauth_clients source preregistered) > 저장된 DCR > 새 DCR (RFC 7591 · 공개 client · none)
  AS mix-up 막기: 사전 등록 client 는 관리자 서버(origin admin)만 · 사용자 서버는 issuer 가 서버와 같은 사이트일 때만 (issuer_foreign)
  서버 정의의 resource · issuer 는 처음 한 번 (비어 있을 때) 또는 고칠 수 있는 사람만 바꾼다 — 남이 바꾸면 모두의 인증정보 열쇠가 바뀐다
흐름
  start     (데스크톱 → POST connect/start) state · PKCE verifier(암호문) · ds 해시 · loopback port · 데스크톱 cc → 10분 → authorize URL
  callback  (브라우저 → GET /api/mcp/oauth/callback) state 1회 · iss(RFC 9207 · 광고했으면 꼭) · code 교환(resource · verifier)
            → 받은 토큰은 흐름 줄에 암호문으로만 · 60초 handoff bwm_ → 302 http://127.0.0.1:{port}/cb?code=… (실패 = ?error=…)
  complete  (데스크톱 → POST connect/complete {code, ds, code_verifier}) 시작한 사람 · ds · PKCE 가 맞아야 → mcp_credentials 로 옮김
            남이 보낸 시작 주소로 로그인해도 그 사람 계정에 내 토큰이 붙지 않는다 (handoff 는 시작한 PC 의 loopback 으로만 · 연결 CSRF)
access_token  만료 60초 전 refresh (같은 (사람, resource) 는 한 번만 = single-flight) · refresh 회전 · invalid_grant = expired → 다시 로그인
step-up       403 insufficient_scope → 지금 scope ∪ 새 scope 로 다시 start (step_up_scope)
토큰 · verifier · client secret 값은 로그 · 예외 · 감사 기록에 0. 감사 = mcp.connect · mcp.disconnect (accounts.audit).
"""

from __future__ import annotations

import asyncio
import base64
import logging
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal
from urllib.parse import quote_plus, urlencode, urlsplit

import httpx2
from mcp.client.auth.utils import (
    build_oauth_authorization_server_metadata_discovery_urls,
    build_protected_resource_metadata_discovery_urls,
    union_scopes,
)
from mcp.shared.auth_utils import check_resource_allowed, resource_url_from_server_url

from ..auth import tokens
from ..store import now_iso
from . import ssrf
from .client import NeedsAuth
from .vault import Vault, VaultError, aad

log = logging.getLogger("conductor.mcp.oauth")

CALLBACK_PATH = "/api/mcp/oauth/callback"
FLOW_S = 10 * 60
HANDOFF_S = 60
REFRESH_SKEW_S = 60
DISCOVERY_TTL_S = 3600
CLIENT_NAME = "BrewAI"
PROTOCOL_HEADER = {"mcp-protocol-version": "2026-07-28", "accept": "application/json"}

AuthMethod = Literal["none", "client_secret_post", "client_secret_basic"]


class OAuthError(Exception):
    """discovery_failed · resource_mismatch · issuer_mismatch · no_pkce · bad_endpoint · no_client · registration_failed ·
    vault_missing · state_invalid · cancelled · provider_error · iss_mismatch · iss_missing · token_failed · invalid_grant ·
    handoff_invalid · wrong_user · ds_mismatch · verifier_mismatch · refresh_unreachable · issuer_foreign · client_admin_only · server_changed."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail[:200]


@dataclass(frozen=True)
class AuthServer:
    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    registration_endpoint: str | None = None
    revocation_endpoint: str | None = None
    scopes_supported: tuple[str, ...] = ()
    iss_required: bool = False  # authorization_response_iss_parameter_supported (RFC 9207)
    auth_methods: tuple[str, ...] = ("client_secret_basic",)


@dataclass(frozen=True)
class Discovery:
    resource: str  # RFC 8707 resource = mcp_credentials 열쇠
    auth_server: AuthServer
    scope: str | None = None  # WWW-Authenticate scope > PRM scopes_supported
    resource_metadata_url: str | None = None


@dataclass(frozen=True)
class Registration:
    issuer: str
    redirect_uri: str
    client_id: str
    client_secret: str | None = field(default=None, repr=False)
    auth_method: AuthMethod = "none"
    source: Literal["preregistered", "dcr"] = "dcr"
    scope: str | None = None


@dataclass(frozen=True)
class Started:
    authorize_url: str
    expires_in: int
    resource: str
    issuer: str


@dataclass(frozen=True)
class Callback:
    """callback 결과 → 302 대상. port None = 흐름을 못 찾음 (브라우저에 '만료' 화면)."""

    port: int | None
    code: str | None = None  # bwm_ handoff
    error: str | None = None
    server_id: str | None = None

    @property
    def redirect(self) -> str | None:
        if self.port is None:
            return None
        q = {"code": self.code} if self.code else {"error": self.error or "provider_error"}
        return f"http://127.0.0.1:{int(self.port)}/cb?{urlencode(q)}"  # host 고정 · port 는 start 에서 숫자로 검사


@dataclass(frozen=True)
class Connected:
    server_id: str
    resource: str
    issuer: str
    scope: str | None


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _parse_iso(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _str_list(v: Any) -> tuple[str, ...]:
    return tuple(x for x in v if isinstance(x, str)) if isinstance(v, list) else ()


class OAuth:
    def __init__(
        self, store: Any, vault: Vault | None, accounts: Any, *, public_url: str, allow_loopback: bool = False,
        transport: httpx2.AsyncBaseTransport | None = None, resolver: ssrf.Resolver | None = None,
    ) -> None:
        self.store = store
        self.vault = vault
        self.accounts = accounts  # issue_once · consume_once (one_time_tokens mcp_handoff) · audit · clock
        self.redirect_uri = public_url.rstrip("/") + CALLBACK_PATH
        self.allow_loopback = allow_loopback
        self._transport = transport
        self._resolver = resolver
        self._discovery: dict[str, tuple[float, Discovery]] = {}
        self._as_cache: dict[str, tuple[float, AuthServer]] = {}
        self._locks: dict[tuple[str, str], asyncio.Lock] = {}

    # ── 공통 ──
    def now(self) -> datetime:
        return self.accounts.clock()

    def _http(self) -> httpx2.AsyncClient:
        return ssrf.http_client(allow_loopback=self.allow_loopback, transport=self._transport, resolver=self._resolver,
                                headers={"user-agent": "BrewAI-conductor/0.1"})

    def _need_vault(self) -> Vault:
        if self.vault is None:
            raise OAuthError("vault_missing")
        return self.vault

    def _endpoint(self, raw: Any) -> str:
        if not isinstance(raw, str):
            raise OAuthError("bad_endpoint")
        try:
            return ssrf.canonical_url(raw, allow_loopback=self.allow_loopback)
        except ssrf.Blocked as e:
            raise OAuthError("bad_endpoint", e.code) from None

    async def _get_json(self, http: httpx2.AsyncClient, url: str) -> tuple[int, Any]:
        try:
            res = await ssrf.fetch(http, "GET", url, allow_loopback=self.allow_loopback, headers=PROTOCOL_HEADER)
        except ssrf.Blocked as e:
            raise OAuthError("bad_endpoint", e.code) from None
        except httpx2.HTTPError:
            return 0, None
        if res.status_code != 200:
            return res.status_code, None
        try:
            return 200, res.json()
        except ValueError:
            return 200, None

    # ── 찾기 ──
    async def discover(self, server_url: str, *, resource_metadata: str | None = None, scope: str | None = None, fresh: bool = False) -> Discovery:
        url = ssrf.canonical_url(server_url, allow_loopback=self.allow_loopback)
        key = f"{url}|{resource_metadata or ''}"
        hit = self._discovery.get(key)
        mono = asyncio.get_running_loop().time()
        if hit and not fresh and mono - hit[0] < DISCOVERY_TTL_S:
            d = hit[1]
            return Discovery(d.resource, d.auth_server, scope or d.scope, d.resource_metadata_url) if scope else d
        server_resource = resource_url_from_server_url(url)
        async with self._http() as http:
            prm: dict[str, Any] | None = None
            prm_url: str | None = None
            for candidate in build_protected_resource_metadata_discovery_urls(resource_metadata, url):
                status, body = await self._get_json(http, candidate)
                if status == 200 and isinstance(body, dict) and isinstance(body.get("resource"), str):
                    prm, prm_url = body, candidate
                    break
            if prm is not None:
                resource = prm["resource"]
                if not check_resource_allowed(requested_resource=server_resource, configured_resource=resource):
                    raise OAuthError("resource_mismatch")
                servers = _str_list(prm.get("authorization_servers"))
                if not servers:
                    raise OAuthError("discovery_failed", "no authorization_servers")
                as_url = servers[0]
                chosen = scope or (" ".join(_str_list(prm.get("scopes_supported"))) or None)  # AS 전체 scope 는 달라고 하지 않는다 (최소 권한)
            else:
                resource = server_resource
                p = urlsplit(url)
                as_url = f"{p.scheme}://{p.netloc}"
                chosen = scope
            auth_server = await self._auth_server(http, as_url, url if prm is None else None)
        d = Discovery(resource=resource, auth_server=auth_server, scope=chosen, resource_metadata_url=prm_url)
        self._discovery[key] = (mono, d)
        return d

    async def _auth_server(self, http: httpx2.AsyncClient, as_url: str, legacy_server: str | None = None) -> AuthServer:
        issuer_expected = as_url
        mono = asyncio.get_running_loop().time()
        hit = self._as_cache.get(issuer_expected)
        if hit and mono - hit[0] < DISCOVERY_TTL_S:
            return hit[1]
        self._endpoint(as_url)  # issuer 주소 자체도 검사
        meta: dict[str, Any] | None = None
        candidates = build_oauth_authorization_server_metadata_discovery_urls(as_url, legacy_server or as_url)
        for candidate in candidates:
            status, body = await self._get_json(http, candidate)
            if status == 200 and isinstance(body, dict):
                meta = body
                break
            if status >= 500:
                break
        if meta is None:
            raise OAuthError("discovery_failed", "no authorization server metadata")
        issuer = meta.get("issuer")
        if not isinstance(issuer, str) or issuer != issuer_expected:  # RFC 8414 §3.3 글자 그대로
            raise OAuthError("issuer_mismatch")
        if "S256" not in _str_list(meta.get("code_challenge_methods_supported")):
            raise OAuthError("no_pkce")
        auth = AuthServer(
            issuer=issuer,
            authorization_endpoint=self._endpoint(meta.get("authorization_endpoint")),
            token_endpoint=self._endpoint(meta.get("token_endpoint")),
            registration_endpoint=self._endpoint(meta["registration_endpoint"]) if meta.get("registration_endpoint") else None,
            revocation_endpoint=self._endpoint(meta["revocation_endpoint"]) if meta.get("revocation_endpoint") else None,
            scopes_supported=_str_list(meta.get("scopes_supported")),
            iss_required=meta.get("authorization_response_iss_parameter_supported") is True,
            auth_methods=_str_list(meta.get("token_endpoint_auth_methods_supported")) or ("client_secret_basic",),
        )
        self._as_cache[issuer_expected] = (mono, auth)
        return auth

    # ── client 등록 ──
    def set_client(self, issuer: str, *, client_id: str, client_secret: str | None = None, auth_method: AuthMethod | None = None,
                   scope: str | None = None, source: Literal["preregistered", "dcr"] = "preregistered") -> Registration:
        """관리자 '사전 등록 client' (PUT /api/admin/mcp/servers/:id/oauth-client) · DCR 결과 저장. secret = 암호문."""
        method: AuthMethod = auth_method or ("client_secret_basic" if client_secret else "none")
        ct, kid = (None, None)
        if client_secret:
            ct, kid = self._need_vault().seal(client_secret.encode(), aad=aad(issuer, self.redirect_uri, client_id))
        at = now_iso()
        with self.store.tx() as db:
            db.execute(
                "INSERT INTO mcp_oauth_clients (issuer, redirect_uri, client_id, secret_ct, key_id, auth_method, source, scope, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (issuer, redirect_uri) DO UPDATE SET client_id = excluded.client_id,"
                " secret_ct = excluded.secret_ct, key_id = excluded.key_id, auth_method = excluded.auth_method, source = excluded.source,"
                " scope = excluded.scope, updated_at = excluded.updated_at",
                (issuer, self.redirect_uri, client_id, ct, kid, method, source, scope, at, at),
            )
        return Registration(issuer, self.redirect_uri, client_id, client_secret, method, source, scope)

    def stored_client(self, issuer: str) -> Registration | None:
        rows = self.store.query("SELECT * FROM mcp_oauth_clients WHERE issuer = ? AND redirect_uri = ?", (issuer, self.redirect_uri))
        if not rows:
            return None
        r = rows[0]
        secret = None
        if r["secret_ct"] is not None:
            try:
                secret = self._need_vault().open(r["secret_ct"], key_id=r["key_id"], aad=aad(issuer, self.redirect_uri, r["client_id"])).decode()
            except VaultError:
                log.warning("mcp oauth client secret unreadable (issuer host %s)", urlsplit(issuer).hostname)
                return None
        return Registration(issuer, self.redirect_uri, r["client_id"], secret, r["auth_method"], r["source"], r["scope"])

    async def client_for(self, auth: AuthServer, *, origin: str = "admin") -> Registration:
        """origin = 서버를 넣은 쪽. 사전 등록 client(secret 포함)는 관리자 서버 로그인에만 — 사용자 서버가 PRM 에 같은 issuer 를 적어도
        우리 client 로 받은 토큰이 그 서버로 가지 않게 (AS mix-up). 그 issuer 에 DCR 로 새로 만들지도 않는다 (사전 등록 줄을 덮는다)."""
        existing = self.stored_client(auth.issuer)
        if existing is not None:
            if existing.source == "preregistered" and origin != "admin":
                raise OAuthError("client_admin_only")
            return existing
        if not auth.registration_endpoint:
            raise OAuthError("no_client")  # 관리자 콘솔에서 사전 등록 client 를 넣어야 한다 (예: GitHub)
        body = {
            "client_name": CLIENT_NAME, "redirect_uris": [self.redirect_uri], "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"], "token_endpoint_auth_method": "none",
        }
        async with self._http() as http:
            try:
                res = await http.post(auth.registration_endpoint, json=body, headers={"accept": "application/json"})
            except httpx2.HTTPError as e:
                raise OAuthError("registration_failed", type(e).__name__) from None
        if res.status_code not in (200, 201):
            raise OAuthError("registration_failed", f"status {res.status_code}")
        try:
            data = res.json()
        except ValueError:
            raise OAuthError("registration_failed", "bad json") from None
        client_id = data.get("client_id") if isinstance(data, dict) else None
        if not isinstance(client_id, str) or not client_id:
            raise OAuthError("registration_failed", "no client_id")
        method = data.get("token_endpoint_auth_method") or ("client_secret_basic" if data.get("client_secret") else "none")
        if method not in ("none", "client_secret_post", "client_secret_basic"):
            method = "client_secret_basic" if data.get("client_secret") else "none"
        return self.set_client(auth.issuer, client_id=client_id, client_secret=data.get("client_secret") or None,
                               auth_method=method, source="dcr")

    # ── 시작 ──
    async def start(
        self, *, user_id: str, server_id: str, url: str, port: int, ds: str, cc: str | None = None,
        scope: str | None = None, resource_metadata: str | None = None, manage: bool = False,
    ) -> Started:
        """port = 데스크톱 loopback (1024~65535) · ds = 데스크톱 상태(8~128자, 해시만 저장) · cc = 데스크톱 PKCE S256 (있으면 complete 에 verifier 필수).
        resource_metadata = 401 WWW-Authenticate 의 PRM 주소 (그 헤더로만 PRM 을 알리는 서버) · manage = 서버 정의를 고칠 수 있는 사람."""
        vault = self._need_vault()
        if not (1024 <= int(port) <= 65535) or not ds or not (8 <= len(ds) <= 128) or (cc is not None and not tokens.CHALLENGE_RE.match(cc)):
            raise OAuthError("bad_request")
        rows = self.store.query("SELECT origin, resource, issuer FROM mcp_servers WHERE id = ?", (server_id,))
        server = rows[0] if rows else None
        origin = server["origin"] if server is not None else "user"
        disc = await self.discover(url, resource_metadata=resource_metadata)
        if origin == "user" and not ssrf.same_site(url, disc.auth_server.issuer):
            raise OAuthError("issuer_foreign")
        known = server is not None and server["issuer"] is not None
        changed = known and (server["resource"], server["issuer"]) != (disc.resource, disc.auth_server.issuer)  # type: ignore[index]
        if changed and not manage:
            raise OAuthError("server_changed")  # 남의 서버 정의(모두의 인증정보 열쇠)를 이 사람의 로그인으로 바꾸지 않는다
        reg = await self.client_for(disc.auth_server, origin=origin)
        verifier = secrets.token_urlsafe(48)
        state = secrets.token_urlsafe(32)
        state_hash = tokens.digest(state)
        final_scope = scope or disc.scope or reg.scope
        ct, kid = vault.seal(verifier.encode(), aad=aad("flow", state_hash, user_id))
        at = self.now()
        with self.store.tx() as db:
            db.execute("DELETE FROM mcp_oauth_flows WHERE expires_at < ?", (_iso(at - timedelta(days=1)),))
            db.execute(
                "INSERT INTO mcp_oauth_flows (state_hash, user_id, server_id, resource, issuer, client_id, redirect_uri, token_endpoint,"
                " iss_required, scope, verifier_ct, key_id, ds_hash, port, cc, created_at, expires_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (state_hash, user_id, server_id, disc.resource, disc.auth_server.issuer, reg.client_id, self.redirect_uri,
                 disc.auth_server.token_endpoint, int(disc.auth_server.iss_required), final_scope, ct, kid, tokens.digest(ds), int(port), cc,
                 _iso(at), _iso(at + timedelta(seconds=FLOW_S))),
            )
            if not known or changed:  # 처음 찾은 resource · issuer 를 서버 정의에 (인증정보 열쇠 = resource) · 바뀜 = 고칠 수 있는 사람만
                db.execute("UPDATE mcp_servers SET resource = ?, issuer = ?, auth = 'oauth', updated_at = ? WHERE id = ?",
                           (disc.resource, disc.auth_server.issuer, now_iso(), server_id))
        params = {
            "response_type": "code", "client_id": reg.client_id, "redirect_uri": self.redirect_uri, "state": state,
            "code_challenge": tokens.s256(verifier), "code_challenge_method": "S256", "resource": disc.resource,
        }
        if final_scope:
            params["scope"] = final_scope
        sep = "&" if urlsplit(disc.auth_server.authorization_endpoint).query else "?"
        return Started(authorize_url=f"{disc.auth_server.authorization_endpoint}{sep}{urlencode(params)}", expires_in=FLOW_S,
                       resource=disc.resource, issuer=disc.auth_server.issuer)

    # ── 콜백 ──
    async def callback(self, *, state: str, code: str = "", iss: str | None = None, error: str = "") -> Callback:
        if not state or len(state) > 200:
            return Callback(port=None, error="state_invalid")
        state_hash = tokens.digest(state)
        at = _iso(self.now())
        with self.store.tx() as db:
            flow = db.execute(
                "SELECT * FROM mcp_oauth_flows WHERE state_hash = ? AND used_at IS NULL AND expires_at > ?", (state_hash, at)
            ).fetchone()
            if flow is None:
                return Callback(port=None, error="state_invalid")
            db.execute("UPDATE mcp_oauth_flows SET used_at = ? WHERE state_hash = ?", (at, state_hash))
            self._sweep(db)
        back = lambda err: Callback(port=flow["port"], error=err, server_id=flow["server_id"])  # noqa: E731
        # RFC 9207: iss 가 오면 같아야 · 광고한 서버는 꼭 와야 (오류 응답에도 같은 규칙)
        if iss is not None and iss != flow["issuer"]:
            return back("iss_mismatch")
        if iss is None and flow["iss_required"]:
            return back("iss_missing")
        if error or not code:
            return back("cancelled" if error == "access_denied" else "provider_error")
        vault = self._need_vault()
        try:
            verifier = vault.open(flow["verifier_ct"], key_id=flow["key_id"], aad=aad("flow", state_hash, flow["user_id"])).decode()
        except VaultError:
            return back("state_invalid")
        reg = self.stored_client(flow["issuer"])
        if reg is None or reg.client_id != flow["client_id"]:
            return back("no_client")
        try:
            tok = await self._token_request(flow["token_endpoint"], reg, {
                "grant_type": "authorization_code", "code": code, "redirect_uri": flow["redirect_uri"], "code_verifier": verifier,
                "resource": flow["resource"],
            })
        except OAuthError as e:
            log.warning("mcp oauth code exchange failed: %s", e.code)
            return back(e.code)
        payload = self._payload(tok, scope=flow["scope"])
        ct, kid = vault.seal_json(payload, aad=aad("flow_tokens", state_hash, flow["user_id"], flow["resource"], flow["issuer"]))
        with self.store.tx() as db:
            db.execute("UPDATE mcp_oauth_flows SET tokens_ct = ?, key_id = ? WHERE state_hash = ?", (ct, kid, state_hash))
        handoff = self.accounts.issue_once("mcp_handoff", HANDOFF_S, prefix=tokens.MCP_HANDOFF, user_id=flow["user_id"],
                                           data={"flow": state_hash})
        return Callback(port=flow["port"], code=handoff, server_id=flow["server_id"])

    def _sweep(self, db: Any) -> None:
        """handoff(60초)가 지난 흐름의 받은 토큰 암호문을 지운다 (그만둔 · 실패한 로그인 = complete 가 안 와도 오래 남지 않게)."""
        db.execute("UPDATE mcp_oauth_flows SET tokens_ct = NULL WHERE tokens_ct IS NOT NULL AND used_at < ?",
                   (_iso(self.now() - timedelta(seconds=HANDOFF_S + 5)),))

    def _payload(self, tok: dict[str, Any], *, scope: str | None, old_refresh: str | None = None) -> dict[str, Any]:
        expires_in = tok.get("expires_in")
        try:
            secs = int(expires_in) if expires_in is not None else None
        except (TypeError, ValueError):
            secs = None
        return {
            "access_token": tok["access_token"],
            "refresh_token": tok.get("refresh_token") or old_refresh,
            "scope": tok.get("scope") or scope,
            "expires_at": _iso(self.now() + timedelta(seconds=secs)) if secs and secs > 0 else None,
        }

    @staticmethod
    def _client_auth(reg: Registration, form: dict[str, str]) -> tuple[dict[str, str], dict[str, str]]:
        """token · revocation 요청의 client 인증 (RFC 6749 §2.3.1 · RFC 7009 §2.1) → (form, headers)."""
        data = {k: v for k, v in form.items() if v}
        headers = {"accept": "application/json"}
        if reg.auth_method == "client_secret_basic" and reg.client_secret:
            raw = f"{_form_quote(reg.client_id)}:{_form_quote(reg.client_secret)}".encode()
            headers["authorization"] = "Basic " + base64.b64encode(raw).decode()
        else:
            data["client_id"] = reg.client_id
            if reg.auth_method == "client_secret_post" and reg.client_secret:
                data["client_secret"] = reg.client_secret
        return data, headers

    async def _token_request(self, endpoint: str, reg: Registration, form: dict[str, str]) -> dict[str, Any]:
        data, headers = self._client_auth(reg, form)
        async with self._http() as http:
            try:
                res = await http.post(self._endpoint(endpoint), data=data, headers=headers)
            except httpx2.HTTPError as e:
                raise OAuthError("token_unreachable", type(e).__name__) from None
        try:
            body = res.json()
        except ValueError:
            body = None
        if res.status_code != 200:
            err = body.get("error") if isinstance(body, dict) else None
            raise OAuthError("invalid_grant" if err in ("invalid_grant", "invalid_client", "unauthorized_client") else "token_failed",
                             f"status {res.status_code}")
        if not isinstance(body, dict) or not isinstance(body.get("access_token"), str) or not body["access_token"]:
            raise OAuthError("token_failed", "no access_token")
        if str(body.get("token_type") or "bearer").lower() != "bearer":
            raise OAuthError("token_failed", "token_type")
        return body

    # ── 마무리 (데스크톱) ──
    def complete(self, *, user_id: str, code: str, ds: str, code_verifier: str | None = None, ip: str | None = None) -> Connected:
        vault = self._need_vault()
        with self.store.tx() as db:
            self._sweep(db)
        found = self.accounts.consume_once("mcp_handoff", code) if tokens.shaped(code, tokens.MCP_HANDOFF) else None
        if found is None:
            raise OAuthError("handoff_invalid")
        owner, data = found
        rows = self.store.query("SELECT * FROM mcp_oauth_flows WHERE state_hash = ?", (data.get("flow", ""),))
        flow = rows[0] if rows else None
        if flow is None or flow["tokens_ct"] is None:
            raise OAuthError("handoff_invalid")
        if owner != user_id or flow["user_id"] != user_id:
            self.accounts.audit("mcp.connect", actor=user_id, target_type="mcp_server", target_id=flow["server_id"], result="denied",
                                ip=ip, detail={"code": "wrong_user"})
            raise OAuthError("wrong_user")
        if not flow["ds_hash"] or not tokens.same(tokens.digest(ds or ""), flow["ds_hash"]):
            raise OAuthError("ds_mismatch")
        if flow["cc"]:
            if not code_verifier or not tokens.PKCE_RE.match(code_verifier) or not tokens.same(tokens.s256(code_verifier), flow["cc"]):
                raise OAuthError("verifier_mismatch")
        try:
            payload = vault.open_json(flow["tokens_ct"], key_id=flow["key_id"],
                                      aad=aad("flow_tokens", flow["state_hash"], user_id, flow["resource"], flow["issuer"]))
        except VaultError:
            raise OAuthError("handoff_invalid") from None
        self._save(user_id, flow["resource"], flow["issuer"], flow["client_id"], payload)
        with self.store.tx() as db:
            db.execute("UPDATE mcp_oauth_flows SET tokens_ct = NULL WHERE state_hash = ?", (flow["state_hash"],))
            db.execute("DELETE FROM mcp_tool_cache WHERE server_id = ? AND user_key = ?", (flow["server_id"], user_id))
        self.accounts.audit("mcp.connect", actor=user_id, target_type="mcp_server", target_id=flow["server_id"], ip=ip,
                            detail={"issuer_host": urlsplit(flow["issuer"]).hostname})
        return Connected(server_id=flow["server_id"], resource=flow["resource"], issuer=flow["issuer"], scope=payload.get("scope"))

    def _save(self, user_id: str, resource: str, issuer: str, client_id: str, payload: dict[str, Any], *, db: Any = None) -> None:
        vault = self._need_vault()
        secret = {k: payload.get(k) for k in ("access_token", "refresh_token")}
        ct, kid = vault.seal_json(secret, aad=aad(user_id, resource, issuer))
        at = now_iso()
        sql = (
            "INSERT INTO mcp_credentials (user_id, resource, issuer, client_id, token_ct, key_id, scope, expires_at, status, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?) ON CONFLICT (user_id, resource) DO UPDATE SET issuer = excluded.issuer,"
            " client_id = excluded.client_id, token_ct = excluded.token_ct, key_id = excluded.key_id, scope = excluded.scope,"
            " expires_at = excluded.expires_at, status = 'active', updated_at = excluded.updated_at"
        )
        params = (user_id, resource, issuer, client_id, ct, kid, payload.get("scope"), payload.get("expires_at"), at, at)
        if db is not None:
            db.execute(sql, params)
        else:
            with self.store.tx() as tx:
                tx.execute(sql, params)

    # ── 쓰기 (대화 · 도구 목록) ──
    def credential(self, user_id: str, resource: str) -> Any:
        rows = self.store.query("SELECT * FROM mcp_credentials WHERE user_id = ? AND resource = ?", (user_id, resource))
        return rows[0] if rows else None

    def status(self, user_id: str, resource: str) -> Literal["connected", "expired"] | None:
        row = self.credential(user_id, resource)
        if row is None:
            return None
        return "connected" if row["status"] == "active" else "expired"

    async def access_token(self, user_id: str, resource: str, *, rejected: str | None = None) -> str:
        """지금 쓸 access token. 없음 = NeedsAuth(not_connected) · 끊김 = NeedsAuth(expired). 만료 60초 전이면 refresh 를 한 번만.
        rejected = MCP 서버가 401 을 준 그 토큰 → 아직 그 토큰이면 바로 refresh (다른 요청이 이미 바꿨으면 새 것을 그대로)."""
        row = self.credential(user_id, resource)
        if row is None:
            raise NeedsAuth("not_connected")
        if row["status"] != "active":
            raise NeedsAuth("expired")
        if not self._due(row) and rejected is None:
            return self._open(row)["access_token"]
        lock = self._locks.setdefault((user_id, resource), asyncio.Lock())
        async with lock:
            row = self.credential(user_id, resource)  # 기다리는 동안 다른 요청이 이미 바꿨을 수 있다
            if row is None:
                raise NeedsAuth("not_connected")
            if row["status"] != "active":
                raise NeedsAuth("expired")
            current = self._open(row)
            stale = rejected is not None and tokens.same(current["access_token"], rejected)
            if not self._due(row) and not stale:
                return current["access_token"]
            return await self._refresh(user_id, resource, row, rejected=stale)

    def _due(self, row: Any) -> bool:
        exp = row["expires_at"]
        return bool(exp) and self.now() + timedelta(seconds=REFRESH_SKEW_S) >= _parse_iso(exp)

    def _open(self, row: Any) -> dict[str, Any]:
        try:
            data = self._need_vault().open_json(row["token_ct"], key_id=row["key_id"], aad=aad(row["user_id"], row["resource"], row["issuer"]))
        except VaultError as e:
            log.warning("mcp credential unreadable (%s) → 다시 로그인", e.code)
            self.mark_expired(row["user_id"], row["resource"])
            raise NeedsAuth("expired") from None
        if self._need_vault().needs_reseal(row["key_id"]):  # 옛 키 → 새 키로 다시 잠근다
            self._save(row["user_id"], row["resource"], row["issuer"], row["client_id"],
                       {**data, "scope": row["scope"], "expires_at": row["expires_at"]})
        return data

    async def _refresh(self, user_id: str, resource: str, row: Any, *, rejected: bool = False) -> str:
        data = self._open(row)
        still_valid = not rejected and (not row["expires_at"] or _parse_iso(row["expires_at"]) > self.now())
        if not data.get("refresh_token"):
            if still_valid:
                return data["access_token"]
            self.mark_expired(user_id, resource)
            raise NeedsAuth("expired")
        reg = self.stored_client(row["issuer"])
        try:
            async with self._http() as http:
                auth = await self._auth_server(http, row["issuer"])
            if reg is None or reg.client_id != row["client_id"]:
                raise OAuthError("invalid_grant", "client changed")
            tok = await self._token_request(auth.token_endpoint, reg, {
                "grant_type": "refresh_token", "refresh_token": data["refresh_token"], "resource": resource,
            })
        except OAuthError as e:
            if e.code == "invalid_grant":
                self.mark_expired(user_id, resource)
                raise NeedsAuth("expired") from None
            if still_valid:
                return data["access_token"]  # 잠깐 못 닿음 = 아직 유효한 토큰으로
            raise OAuthError("refresh_unreachable", e.code) from None
        payload = self._payload(tok, scope=row["scope"], old_refresh=data.get("refresh_token"))
        self._save(user_id, resource, row["issuer"], row["client_id"], payload)
        return payload["access_token"]

    def mark_expired(self, user_id: str, resource: str) -> None:
        """서버가 이 토큰에 401 을 줬다 (폐기 · 만료) → 다시 로그인 필요."""
        with self.store.tx() as db:
            db.execute("UPDATE mcp_credentials SET status = 'expired', updated_at = ? WHERE user_id = ? AND resource = ?", (now_iso(), user_id, resource))

    def touch(self, user_id: str, resource: str) -> None:
        with self.store.tx() as db:
            db.execute("UPDATE mcp_credentials SET last_used_at = ? WHERE user_id = ? AND resource = ?", (now_iso(), user_id, resource))

    def step_up_scope(self, user_id: str, resource: str, challenged: str | None) -> str | None:
        """403 insufficient_scope → 다시 로그인할 scope = 지금 받은 것 ∪ 서버가 요구한 것 (SEP-2350)."""
        row = self.credential(user_id, resource)
        return union_scopes(row["scope"] if row else None, challenged)

    async def disconnect(self, user_id: str, resource: str, *, server_id: str | None = None, ip: str | None = None) -> bool:
        """[연결 끊기] = 우리 쪽 토큰을 지운다 (+ 서버가 revocation 을 광고하면 refresh token 폐기 요청 · 실패해도 지운다)."""
        row = self.credential(user_id, resource)
        if row is None:
            return False
        try:
            data = self._open(row)
            reg = self.stored_client(row["issuer"])
            async with self._http() as http:
                auth = await self._auth_server(http, row["issuer"])
                if auth.revocation_endpoint and reg is not None and data.get("refresh_token"):
                    form, headers = self._client_auth(reg, {"token": data["refresh_token"], "token_type_hint": "refresh_token"})
                    await http.post(auth.revocation_endpoint, data=form, headers=headers)
        except (OAuthError, NeedsAuth, httpx2.HTTPError, ssrf.Blocked):
            pass
        with self.store.tx() as db:
            db.execute("DELETE FROM mcp_credentials WHERE user_id = ? AND resource = ?", (user_id, resource))
            db.execute("DELETE FROM mcp_tool_cache WHERE user_key = ? AND server_id IN (SELECT id FROM mcp_servers WHERE resource = ?)",
                       (user_id, resource))
        self.accounts.audit("mcp.disconnect", actor=user_id, target_type="mcp_server", target_id=server_id, ip=ip,
                            detail={"issuer_host": urlsplit(row["issuer"]).hostname})
        return True


def _form_quote(v: str) -> str:
    return quote_plus(v)  # RFC 6749 §2.3.1: client_id · secret 은 form-urlencoded 한 뒤 Basic
