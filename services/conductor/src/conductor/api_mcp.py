"""MCP 서버 · 앱 연결 HTTP API (ADR-0013 · slice 05). 판정 = auth/policy.py · 정의 · 목록 = connectors/catalog.py · 연결 = connectors/.

사용자 (Bearer · 데스크톱) — 못 보는 서버 = 404 mcp_server_not_found (있는지도 숨김) · 보이지만 이 행동만 안 됨 = 403 · 상태 때문 = 409
  GET    /api/me/mcp/servers                         {mine: [App], importable: [Importable], auto_auth, allow_user_servers, vault_ready}
  POST   /api/me/mcp/servers/preview                 {url, name?, description?} → Preview (저장 안 함 · SSRF · 주소 허용 목록 · 로그인 방식 · 도구 수)
  POST   /api/me/mcp/servers                         {url, name?, description?, aliases?, handle?, share?: {scope_kind: org|space, scope_id}}
                                                     → 201 App (+ preview 칸) · 같은 주소를 이미 추가 = 409 server_exists
  GET    /api/me/mcp/servers/{id}                    App + shares (주인만 · path 포함) + tools (캐시 · write) + prompt_line · prompt_tokens
  PATCH  /api/me/mcp/servers/{id}                    {name?, description?, aliases?} (주인) · {handle?} (내 별칭 · null = 기본) · {hidden?} → App
  DELETE /api/me/mcp/servers/{id}                    204 · 내 것 = 지우기 · 가져옴 = 내 목록에서 빼기 · 전체 공통 = 숨기기
  POST   /api/me/mcp/servers/{id}/shares             {scope_kind: org|space, scope_id} → 201 {shares} (조직 = 그 조직 owner · admin · 스페이스 = 그 멤버)
  DELETE /api/me/mcp/servers/{id}/shares?scope_kind=&scope_id=     204 · 없음 = 404 share_not_found
  POST   /api/me/mcp/servers/{id}/import             {handle?} → 201 App (가져온 사람이 자기 계정으로 로그인 · 공유자 토큰 안 씀)
  POST   /api/me/mcp/servers/{id}/connect/start      {port, ds, cc?, scope?} → {authorize_url, expires_in} (시스템 브라우저로 연다)
  POST   /api/me/mcp/servers/{id}/connect/complete   {code: bwm_…, ds, code_verifier?} → App (연결됨 · 도구 목록을 미리 받는다)
  DELETE /api/me/mcp/servers/{id}/connection         204 (제공자에 refresh 폐기 요청 · 우리 토큰 지움) · 연결 없음 = 404 not_connected
  POST   /api/me/mcp/servers/{id}/test               {ok, auth, connection, tool_count, write_count, tokens_est, code}
  GET    /api/me/settings · PATCH {auto_auth: unset|on|off}   {auto_auth, auto_auth_asked} ('필요할 때 바로 로그인 화면 열기')
  GET    /api/me/mcp/presets                         {presets: [Preset + added]} 추천 서버 (connectors/presets.json · 읽기 전용 · 비밀값 없음)
                                                     added = 내 목록에 같은 주소(정규화)가 있다 · admin_only = 여기선 available false
공개
  GET    /api/mcp/oauth/callback                     ?state&code&iss&error → 302 http://127.0.0.1:{port}/cb?code=bwm_… | ?error=<code>
                                                     흐름 없음 · 만료 · 이미 씀 = 400 안내 페이지. ds 는 붙지 않는다 (conductor 가 complete 에서 확인)
관리자 (쿠키 + CSRF + instance admin)
  GET    /api/admin/mcp/servers                      [AdminServer] (전체 공통 서버)
  POST   /api/admin/mcp/servers                      {url, name?, description?, aliases?, handle?} → 201 AdminServer (install 공유 + auto_include)
  GET    /api/admin/mcp/servers/{id}                 AdminServer (사용자 추가 서버도 · 에이전트가 보는 줄 + 토큰)
  PATCH  /api/admin/mcp/servers/{id}                 {name?, description?, aliases?, handle?, status?: active|disabled} → AdminServer
  DELETE /api/admin/mcp/servers/{id}                 204
  POST   /api/admin/mcp/servers/{id}/test            {ok, auth, tool_count, write_count, tokens_est, code, duration_ms}
  GET    /api/admin/mcp/servers/{id}/tools           {tools: [{name, public, title, description, write, tokens_est, mode, always_reveal, aliases}], fetched_at}
  PATCH  /api/admin/mcp/servers/{id}/tools           {tool, mode?: hidden|auto|approval, always_reveal?, aliases?} → 같은 모양
  PUT    /api/admin/mcp/servers/{id}/oauth-client    {client_id, client_secret?, auth_method?, scope?} → OAuthClient (secret 은 has_secret 만)
  GET    /api/admin/mcp/user-servers                 [AdminServer + owner_name · share_count] (인증정보는 connected_count 개수만)
  PATCH  /api/admin/mcp/user-servers/{id}            {status: active|disabled} → AdminServer
  GET    /api/admin/mcp/policy · PATCH               {allow_user_servers, url_allowlist: ['linear.app', '*.example.com']}
  GET    /api/admin/mcp/presets                      {presets: [Preset + added]} added = 전체 공통 서버에 같은 주소가 있다
App        = {id, handle, name, url, domain, issuer_domain, description, aliases, auth (oauth|none), origin (admin|user), source (install|own|imported),
              status (active|disabled|error), connection (none|connected|expired|needs_login), hidden, share_lost,
              blocked (null|user_servers_disabled|url_not_allowed = 관리자 정책이 지금 막은 사용자 서버), usable,
              tool_count, tool_tokens_est, last_used_at, can_manage}
Importable = {id, name, url, domain, issuer_domain, description, auth, tool_count, owner_name, via: [{scope_kind, scope_id, path: [{kind, id, name}]}]}
사용자 서버 규칙 (사용자 결정 · ADR-0013 '공유되는 건 정의뿐'): 주소 query 에 비밀값처럼 보이는 칸(?api_key= · ?token= …) = 422 url_has_secret
  · OAuth 로그인 서버가 서버와 다른 사이트 = 422 issuer_foreign (남의 issuer 토큰을 이 서버에 보내지 않게 · 관리자 서버는 예외)
  · 주소 허용 목록은 바깥으로 요청을 보내기 전에 본다 (미리 확인 · 추가) · 추가 뒤에 바뀐 정책도 목록 · 대화 · 연결에서 (blocked)
Preview    = {url, domain, name, handle, auth, issuer, issuer_domain, resource, tool_count (OAuth = 로그인 전이라 null), write_count, tokens_est,
              prompt_line, prompt_tokens}
감사 = mcp.server.add · remove · share · unshare · import · disable (여기) · mcp.connect · disconnect (connectors/oauth.py). 토큰 값은 응답 · 로그에 0.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from .api_auth import _no_store, _page
from .auth import policy
from .auth.accounts import Principal
from .auth.http import accounts_of, client_ip, limit, require_admin, require_user
from .auth.policy import Actor, Denied, McpServerFacts, McpShareFacts
from .connectors import ssrf
from .connectors.catalog import App, app_line, clean_name, domain_of, make_handle, valid_handle
from .connectors.client import McpError, NameMap, NeedsAuth, Tool, ToolCache, estimate_tokens
from .connectors.oauth import CALLBACK_PATH, OAuthError
from .connectors.presets import load as load_presets
from .connectors.session import Connectors
from . import scopes
from .scopes import Scopes
from .settings import Settings

log = logging.getLogger("conductor.api_mcp")
DS_RE = re.compile(r"^[A-Za-z0-9_-]{8,128}$")


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


# 사용자가 고르는 공유 범위 = 설치본 전체를 뺀 층 (scopes.share_kinds · 층 이름은 scopes.py 에만)
USER_SHARE_KINDS = tuple(k for k in scopes.share_kinds() if k != scopes.INSTALL)


class ShareIn(_In):
    scope_kind: str = Field(max_length=20)
    scope_id: str = Field(max_length=64)


class PreviewIn(_In):
    url: str = Field(max_length=2048)
    name: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    handle: str | None = Field(default=None, max_length=20)  # 추천 서버의 부르는 이름 (미리 확인의 '에이전트가 보는 줄' 이 추가 뒤와 같게)


class ServerIn(PreviewIn):
    aliases: list[str] = Field(default_factory=list, max_length=20)
    handle: str | None = Field(default=None, max_length=20)
    share: ShareIn | None = None


class AdminServerIn(PreviewIn):
    aliases: list[str] = Field(default_factory=list, max_length=20)
    handle: str | None = Field(default=None, max_length=20)


class ServerPatch(_In):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    aliases: list[str] | None = Field(default=None, max_length=20)
    handle: str | None = Field(default=None, max_length=20)
    hidden: bool | None = None


class AdminPatch(_In):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    aliases: list[str] | None = Field(default=None, max_length=20)
    handle: str | None = Field(default=None, max_length=20)
    status: Literal["active", "disabled"] | None = None


class StatusIn(_In):
    status: Literal["active", "disabled"]


class ImportIn(_In):
    handle: str | None = Field(default=None, max_length=20)


class StartIn(_In):
    port: int = Field(ge=1024, le=65535)
    ds: str = Field(max_length=128)
    cc: str | None = Field(default=None, max_length=128)
    scope: str | None = Field(default=None, max_length=1000)


class CompleteIn(_In):
    code: str = Field(max_length=200)
    ds: str = Field(max_length=128)
    code_verifier: str | None = Field(default=None, max_length=200)


class SettingsPatch(_In):
    auto_auth: Literal["unset", "on", "off"]


class ToolPatch(_In):
    tool: str = Field(min_length=1, max_length=128)
    mode: Literal["hidden", "auto", "approval"] | None = None
    always_reveal: bool | None = None
    aliases: list[str] | None = Field(default=None, max_length=10)


class ClientIn(_In):
    client_id: str = Field(min_length=1, max_length=400)
    client_secret: str | None = Field(default=None, max_length=1000)
    auth_method: Literal["none", "client_secret_post", "client_secret_basic"] | None = None
    scope: str | None = Field(default=None, max_length=1000)


class PolicyPatch(_In):
    allow_user_servers: bool | None = None
    url_allowlist: list[str] | None = Field(default=None, max_length=100)


# ── 모양 ──────────────────────────────────────────────────────────────────────────


def app_out(a: App) -> dict[str, Any]:
    return {
        "id": a.server_id, "handle": a.handle, "name": a.name, "url": a.url, "domain": a.domain, "issuer_domain": a.issuer_domain,
        "description": a.description, "aliases": list(a.aliases), "auth": a.auth, "origin": a.origin, "source": a.source, "status": a.status,
        "connection": a.connection, "hidden": a.hidden, "share_lost": a.share_lost, "blocked": a.blocked, "usable": a.usable,
        "tool_count": a.tool_count, "tool_tokens_est": a.tool_tokens_est, "last_used_at": a.last_used_at, "can_manage": a.source == "own",
    }


def _row_app(row: Any, *, connection: str = "needs_login") -> App:
    """관리자 화면 '에이전트가 보는 줄' — 서버 정의 한 줄을 App 모양으로 (사람마다의 칸은 기본값)."""
    import json as _json

    try:
        aliases = tuple(str(x) for x in _json.loads(row["aliases"] or "[]"))
    except ValueError:
        aliases = ()
    return App(
        server_id=row["id"], handle=row["handle"], name=row["name"], url=row["url"], resource=row["resource"], domain=domain_of(row["url"]),
        description=row["description"], aliases=aliases, auth=row["auth"], origin=row["origin"], source="install", status=row["status"],
        connection="none" if row["auth"] == "none" else connection,  # type: ignore[arg-type]
        tool_count=row["tool_count"], tool_tokens_est=row["tool_tokens_est"], issuer=row["issuer"],
    )


def _line(a: App) -> dict[str, Any]:
    line = app_line(a)
    return {"prompt_line": line, "prompt_tokens": estimate_tokens(line) + 1}


def _tool_out(t: Tool, handle: str, names: NameMap, pol: dict[str, Any] | None = None) -> dict[str, Any]:
    p = pol or {}
    return {
        "name": t.name, "public": names.public(t.name), "title": t.title, "description": t.description, "write": t.write,
        "tokens_est": t.tokens_est, "mode": p.get("mode", "auto"), "always_reveal": bool(p.get("always_reveal")), "aliases": p.get("aliases", []),
    }


def _url_error(code: str) -> Denied:
    if code == "bad_url":
        return Denied(422, "bad_url")
    if code == "scheme":
        return Denied(422, "url_not_https")
    return Denied(422, "url_blocked")


def _mcp_error(e: McpError) -> Denied:
    if e.code == "blocked":
        return Denied(422, "url_blocked")
    return Denied(502, f"mcp_{e.code}")


def _oauth_error(e: OAuthError) -> Denied:
    if e.code == "vault_missing":
        return Denied(503, "vault_missing")
    if e.code == "bad_request":
        return Denied(400, "bad_request")
    return Denied(502, f"oauth_{e.code}")


def register(public: APIRouter, user: APIRouter, admin: APIRouter, *, settings: Settings, connectors: Connectors) -> None:
    svc = connectors
    cat = svc.catalog
    presets = load_presets(settings.mcp_presets_path)

    # ── 공용 ──
    def facts_or_404(server_id: str, user_id: str) -> tuple[Any, McpServerFacts]:
        found = cat.server_facts(server_id, user_id)
        if found is None:
            raise Denied(404, "mcp_server_not_found")
        return found

    def my_app(user_id: str, server_id: str) -> App | None:
        return next((a for a in cat.apps(user_id) if a.server_id == server_id), None)

    def app_or_404(user_id: str, server_id: str) -> App:
        a = my_app(user_id, server_id)
        if a is None:
            raise Denied(404, "mcp_server_not_found")
        return a

    def latest_tools(server_id: str, user_key: str | None = None) -> tuple[list[Tool], str | None]:
        """도구 목록 캐시 (사람 키가 있으면 그것 · 없으면 가장 최근 것 = 관리자 화면 · 도구 정의는 계정과 상관없이 같다고 본다)."""
        if user_key is not None:
            hit = svc.cache.get(server_id, user_key, stale_ok=True)
            return (hit.tools, hit.fetched_at) if hit else ([], None)
        rows = svc.store.query(
            "SELECT user_key FROM mcp_tool_cache WHERE server_id = ? ORDER BY fetched_at DESC LIMIT 1", (server_id,)
        )
        if not rows:
            return [], None
        hit = svc.cache.get(server_id, rows[0]["user_key"], stale_ok=True)
        return (hit.tools, hit.fetched_at) if hit else ([], None)

    def canonical(url: str, origin: Literal["admin", "user"]) -> str:
        try:
            canon = ssrf.canonical_url(url, allow_loopback=svc.allow_loopback)
        except ssrf.Blocked as e:
            raise _url_error(e.code) from None
        if origin == "user" and ssrf.has_secret_query(canon):
            raise Denied(422, "url_has_secret")  # 공유하면 가져간 사람의 호출마다 주인의 비밀이 실린다
        return canon

    async def preview(url: str, *, name: str | None, description: str | None, token: str | None = None,
                      origin: Literal["admin", "user"] = "admin", handle: str | None = None) -> dict[str, Any]:
        """주소 검사(SSRF · https) → tools/list 한 번 (401 = OAuth → 메타데이터 찾기) → 미리 확인 칸. 저장하지 않는다."""
        canon = canonical(url, origin)
        try:
            probe = await svc.mcp.probe(canon, token=token)
        except McpError as e:
            raise _mcp_error(e) from None
        issuer = resource = None
        if probe.auth == "oauth":
            try:
                disc = await svc.oauth.discover(canon, resource_metadata=probe.resource_metadata, scope=probe.scope)
            except OAuthError as e:
                raise _oauth_error(e) from None
            except ssrf.Blocked as e:
                raise _url_error(e.code) from None
            issuer, resource = disc.auth_server.issuer, disc.resource
            if origin == "user" and not ssrf.same_site(canon, issuer):
                raise Denied(422, "issuer_foreign")
        tools = probe.tools
        shown_name = clean_name(name) or clean_name(probe.server_name) or domain_of(canon)
        handle = handle if valid_handle(handle) else make_handle(shown_name, canon)
        draft = App(
            server_id="", handle=handle, name=shown_name, url=canon, resource=resource or canon, domain=domain_of(canon),
            description=description or "", aliases=(), auth=probe.auth, origin="user", source="own", status="active",
            connection="none" if probe.auth == "none" else "needs_login",
        )
        return {
            "url": canon, "domain": domain_of(canon), "name": shown_name, "handle": handle, "auth": probe.auth, "issuer": issuer,
            "issuer_domain": domain_of(issuer) if issuer else None, "resource": resource or canon,
            "tool_count": len(tools) if tools is not None else None,
            "write_count": sum(t.write for t in tools) if tools is not None else None,
            "tokens_est": sum(t.tokens_est for t in tools) if tools is not None else None,
            "_tools": tools, **_line(draft),
        }

    def public_preview(p: dict[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in p.items() if not k.startswith("_")}

    def target_facts(user_id: str, body: ShareIn) -> McpShareFacts:
        if body.scope_kind not in USER_SHARE_KINDS:
            raise Denied(422, "bad_scope")
        m = cat.memberships(user_id)
        if body.scope_kind == scopes.TENANT:
            role = m.org_roles.get(body.scope_id)
            if role is None:
                raise Denied(404, "org_not_found")
            return McpShareFacts(scope_kind=body.scope_kind, scope_id=body.scope_id, org_role=role)  # type: ignore[arg-type]
        return McpShareFacts(scope_kind=body.scope_kind, scope_id=body.scope_id, space=m.spaces.get(body.scope_id))

    def shares_out(server_id: str) -> list[dict[str, Any]]:
        rows = cat.shares(server_id)
        sc = Scopes(svc.store)
        paths: dict[str, dict[str, Any]] = {}
        for kind in USER_SHARE_KINDS:
            paths[kind] = sc.paths(kind, [r["scope_id"] for r in rows if r["scope_kind"] == kind])
        return [
            {"scope_kind": r["scope_kind"], "scope_id": r["scope_id"], "auto_include": bool(r["auto_include"]), "shared_by": r["shared_by"],
             "created_at": r["created_at"], "path": paths.get(r["scope_kind"], {}).get(r["scope_id"], [])}
            for r in rows
        ]

    def audit(request: Request, action: str, actor: str, server_id: str, detail: dict[str, Any] | None = None) -> None:
        accounts_of(request).audit(action, actor=actor, target_type="mcp_server", target_id=server_id, ip=client_ip(request), detail=detail)

    def throttle(request: Request, key: str, *, n: int = 30, window_s: int = 600) -> None:
        wait = accounts_of(request).hit(key, limit=n, window_s=window_s)
        if wait is not None:
            raise Denied(429, "rate_limited")

    def url_allowed(url: str) -> bool:
        return ssrf.host_allowed(url, cat.settings()["url_allowlist"])

    def presets_out(added_urls: set[str], *, admin: bool) -> dict[str, Any]:
        """추천 서버 + added (같은 정규 주소가 이미 있다). 정규화가 안 되는 주소(이 환경에서 막힌 주소)는 added 없음."""
        out = []
        for pr in presets:
            try:
                canon = ssrf.canonical_url(pr.url, allow_loopback=svc.allow_loopback)
            except ssrf.Blocked:
                canon = None
            item = pr.to_json() | {"added": canon is not None and canon in added_urls}
            if pr.admin_only and not admin and pr.available:
                item |= {"available": False, "reason": "관리자 콘솔에서만 추가할 수 있어요"}
            elif not admin and pr.available and not url_allowed(canon or pr.url):  # 관리자 정책의 주소 허용 목록 (추가 때 url_not_allowed 와 같은 판정)
                item |= {"available": False, "reason": "관리자가 허용한 주소가 아니에요"}
            out.append(item)
        return {"presets": out}

    # ── 사용자 ──
    @user.get("/api/me/mcp/servers")
    async def my_servers(p: Principal = Depends(require_user)) -> dict[str, Any]:
        pol = cat.settings()
        return {
            "mine": [app_out(a) for a in cat.apps(p.user_id)],
            "importable": [
                {"id": i.server_id, "name": i.name, "url": i.url, "domain": i.domain, "issuer_domain": i.issuer_domain,
                 "description": i.description, "auth": i.auth, "tool_count": i.tool_count, "owner_name": i.owner_name, "via": list(i.via)}
                for i in cat.importable(p.user_id)
            ],
            "auto_auth": cat.auto_auth(p.user_id), "allow_user_servers": pol["allow_user_servers"], "vault_ready": svc.vault is not None,
        }

    @user.get("/api/me/mcp/presets")
    async def my_presets(p: Principal = Depends(require_user)) -> dict[str, Any]:
        return presets_out({a.url for a in cat.apps(p.user_id)}, admin=False)

    @user.post("/api/me/mcp/servers/preview")
    async def preview_server(request: Request, body: PreviewIn, p: Principal = Depends(require_user)) -> dict[str, Any]:
        pol = cat.settings()
        policy.require_mcp_add(p.actor, origin="user", allow_user_servers=pol["allow_user_servers"],
                               url_allowed=url_allowed(canonical(body.url, "user")))  # 허용 목록 밖 = 바깥으로 요청 0
        throttle(request, f"mcp_probe:{p.user_id}")
        if body.handle is not None and not valid_handle(body.handle):
            raise Denied(422, "bad_handle")
        out = await preview(body.url, name=body.name, description=body.description, origin="user", handle=body.handle)
        return public_preview(out)

    @user.post("/api/me/mcp/servers", status_code=201)
    async def add_server(request: Request, body: ServerIn, p: Principal = Depends(require_user)) -> dict[str, Any]:
        pol = cat.settings()
        policy.require_mcp_add(p.actor, origin="user", allow_user_servers=pol["allow_user_servers"])
        if body.handle is not None and not valid_handle(body.handle):
            raise Denied(422, "bad_handle")
        target = target_facts(p.user_id, body.share) if body.share else None
        if target is not None:  # 공유는 만들기 전에 판정 (새 서버의 주인 = 나)
            policy.require_mcp_share(p.actor, McpServerFacts(id="new", origin="user", owner_user_id=p.user_id), target)
        policy.require_mcp_add(p.actor, origin="user", allow_user_servers=True, url_allowed=url_allowed(canonical(body.url, "user")))
        throttle(request, f"mcp_probe:{p.user_id}")
        out = await preview(body.url, name=body.name, description=body.description, origin="user", handle=body.handle)
        sid = cat.add_server(
            name=out["name"], url=out["url"], origin="user", owner_user_id=p.user_id, handle=body.handle or out["handle"],
            description=body.description or "", aliases=body.aliases, auth=out["auth"], resource=out["resource"], issuer=out["issuer"],
        )
        if out["_tools"] is not None:
            svc.cache.put(sid, ToolCache.SHARED, out["_tools"])
        audit(request, "mcp.server.add", p.user_id, sid, {"origin": "user", "domain": out["domain"], "auth": out["auth"]})
        if body.share is not None:
            cat.share(sid, body.share.scope_kind, body.share.scope_id, shared_by=p.user_id)
            audit(request, "mcp.server.share", p.user_id, sid, {"scope_kind": body.share.scope_kind, "scope_id": body.share.scope_id})
        return app_out(app_or_404(p.user_id, sid)) | {"preview": public_preview(out)}

    @user.get("/api/me/mcp/servers/{server_id}")
    async def my_server(server_id: str, p: Principal = Depends(require_user)) -> dict[str, Any]:
        row, facts = facts_or_404(server_id, p.user_id)
        policy.require_mcp_view(p.actor, facts)
        a = my_app(p.user_id, server_id) or _row_app(row)
        tools, fetched = latest_tools(server_id, svc.user_key(row, p.user_id))
        names = NameMap.of(a.handle, [t.name for t in tools])
        pol = cat.tool_policy(server_id)
        out = app_out(a) | _line(a) | {
            "listed": my_app(p.user_id, server_id) is not None,
            "tools": [_tool_out(t, a.handle, names, pol.get(t.name)) for t in tools if pol.get(t.name, {}).get("mode") != "hidden"],
            "tools_fetched_at": fetched,
        }
        if policy.mcp_can_manage(p.actor, facts):
            out["shares"] = shares_out(server_id)
        return out

    @user.patch("/api/me/mcp/servers/{server_id}")
    async def patch_server(server_id: str, body: ServerPatch, p: Principal = Depends(require_user)) -> dict[str, Any]:
        _, facts = facts_or_404(server_id, p.user_id)
        policy.require_mcp_view(p.actor, facts)
        fields = body.model_fields_set
        definition: dict[str, Any] = {}
        if "name" in fields:
            if not clean_name(body.name or ""):
                raise Denied(422, "bad_name")
            definition["name"] = body.name
        if "description" in fields:
            definition["description"] = body.description or ""
        if "aliases" in fields:
            definition["aliases"] = body.aliases or []
        if definition:  # 정의 = 주인만 (주소는 아무도 못 고친다)
            policy.require_mcp_edit(p.actor, facts)
            cat.update_server(server_id, definition)
        a = app_or_404(p.user_id, server_id) if ({"handle", "hidden"} & fields) else None
        if a is not None and "handle" in fields:
            if body.handle is not None and not valid_handle(body.handle):
                raise Denied(422, "bad_handle")
            cat.set_my_handle(p.user_id, server_id, body.handle, source=a.source)
        if a is not None and "hidden" in fields and body.hidden is not None:
            cat.set_hidden(p.user_id, server_id, body.hidden, source=a.source)
        return app_out(app_or_404(p.user_id, server_id))

    @user.delete("/api/me/mcp/servers/{server_id}", status_code=204)
    async def delete_server(request: Request, server_id: str, p: Principal = Depends(require_user)) -> Response:
        _, facts = facts_or_404(server_id, p.user_id)
        if facts.imported:  # 가져온 앱 [빼기] = 내 줄만 (공유가 끊겨 안 보이게 된 줄도 뺄 수 있다)
            cat.remove_from_list(p.user_id, server_id)
            return Response(status_code=204)
        policy.require_mcp_view(p.actor, facts)
        if policy.mcp_is_owner(p.actor, facts):
            cat.delete_server(server_id)
            audit(request, "mcp.server.remove", p.user_id, server_id)
        elif policy.mcp_auto(p.actor, facts):
            cat.set_hidden(p.user_id, server_id, True, source="install")
        else:
            raise Denied(404, "mcp_server_not_found")
        return Response(status_code=204)

    @user.post("/api/me/mcp/servers/{server_id}/shares", status_code=201)
    async def share_server(request: Request, server_id: str, body: ShareIn, p: Principal = Depends(require_user)) -> dict[str, Any]:
        _, facts = facts_or_404(server_id, p.user_id)
        policy.require_mcp_share(p.actor, facts, target_facts(p.user_id, body))
        cat.share(server_id, body.scope_kind, body.scope_id, shared_by=p.user_id)
        audit(request, "mcp.server.share", p.user_id, server_id, {"scope_kind": body.scope_kind, "scope_id": body.scope_id})
        return {"shares": shares_out(server_id)}

    @user.delete("/api/me/mcp/servers/{server_id}/shares", status_code=204)
    async def unshare_server(
        request: Request, server_id: str, scope_kind: str = Query(..., max_length=20), scope_id: str = Query(..., max_length=64),
        p: Principal = Depends(require_user),
    ) -> Response:
        _, facts = facts_or_404(server_id, p.user_id)
        row = next((r for r in cat.shares(server_id) if r["scope_kind"] == scope_kind and r["scope_id"] == scope_id), None)
        if row is None:
            policy.require_mcp_view(p.actor, facts)
            raise Denied(404, "share_not_found")
        policy.require_mcp_unshare(p.actor, facts, cat.share_facts(row, cat.memberships(p.user_id)))
        cat.unshare(server_id, scope_kind, scope_id)
        audit(request, "mcp.server.unshare", p.user_id, server_id, {"scope_kind": scope_kind, "scope_id": scope_id})
        return Response(status_code=204)

    @user.post("/api/me/mcp/servers/{server_id}/import", status_code=201)
    async def import_server(request: Request, server_id: str, body: ImportIn | None = None, p: Principal = Depends(require_user)) -> dict[str, Any]:
        _, facts = facts_or_404(server_id, p.user_id)
        policy.require_mcp_import(p.actor, facts)
        handle = body.handle if body else None
        if handle is not None and not valid_handle(handle):
            raise Denied(422, "bad_handle")
        cat.import_server(p.user_id, server_id, handle=handle)
        audit(request, "mcp.server.import", p.user_id, server_id)
        return app_out(app_or_404(p.user_id, server_id))

    @user.post("/api/me/mcp/servers/{server_id}/connect/start")
    async def connect_start(request: Request, server_id: str, body: StartIn, p: Principal = Depends(require_user)) -> dict[str, Any]:
        row, facts = facts_or_404(server_id, p.user_id)
        policy.require_mcp_use(p.actor, facts)
        if not DS_RE.match(body.ds):
            raise Denied(400, "bad_request")
        throttle(request, f"mcp_connect:{p.user_id}")
        scope = svc.oauth.step_up_scope(p.user_id, row["resource"], body.scope) if body.scope else None
        # 토큰 없이 한 번 = 401 WWW-Authenticate 의 resource_metadata (PRM 을 그 헤더로만 알리는 서버 · MCP 규칙)
        try:
            hint = (await svc.mcp.probe(row["url"])).resource_metadata
        except McpError:
            hint = None
        hint = hint or cat.auth_hint(server_id)  # 목록은 공개 · 호출만 401 인 서버 = 호출 때 받은 주소 (DB · Connectors.require_login)
        try:
            started = await svc.oauth.start(user_id=p.user_id, server_id=server_id, url=row["url"], port=body.port, ds=body.ds, cc=body.cc,
                                            scope=scope, resource_metadata=hint, manage=policy.mcp_can_manage(p.actor, facts))
        except OAuthError as e:
            log.info("mcp connect start failed: server=%s %s", server_id, e.code)
            raise _oauth_error(e) from None
        except ssrf.Blocked as e:
            raise _url_error(e.code) from None
        return {"authorize_url": started.authorize_url, "expires_in": started.expires_in}

    @user.post("/api/me/mcp/servers/{server_id}/connect/complete")
    async def connect_complete(request: Request, server_id: str, body: CompleteIn, p: Principal = Depends(require_user)) -> dict[str, Any]:
        _, facts = facts_or_404(server_id, p.user_id)
        policy.require_mcp_view(p.actor, facts)
        try:
            done = svc.oauth.complete(user_id=p.user_id, code=body.code, ds=body.ds, code_verifier=body.code_verifier, ip=client_ip(request))
        except OAuthError as e:
            raise Denied(503 if e.code == "vault_missing" else 400, e.code) from None
        await svc.prefetch(p.user_id, done.server_id)  # 대화가 처음 쓸 때 왕복 -1 (실패해도 그만)
        a = my_app(p.user_id, done.server_id) or app_or_404(p.user_id, server_id)
        return app_out(a)

    @user.delete("/api/me/mcp/servers/{server_id}/connection", status_code=204)
    async def disconnect(request: Request, server_id: str, p: Principal = Depends(require_user)) -> Response:
        row, facts = facts_or_404(server_id, p.user_id)
        policy.require_mcp_view(p.actor, facts)
        if not await svc.oauth.disconnect(p.user_id, row["resource"], server_id=server_id, ip=client_ip(request)):
            raise Denied(404, "not_connected")
        return Response(status_code=204)

    @user.post("/api/me/mcp/servers/{server_id}/test")
    async def test_mine(request: Request, server_id: str, p: Principal = Depends(require_user)) -> dict[str, Any]:
        _, facts = facts_or_404(server_id, p.user_id)
        policy.require_mcp_view(p.actor, facts)
        a = app_or_404(p.user_id, server_id)
        throttle(request, f"mcp_probe:{p.user_id}")
        out: dict[str, Any] = {"ok": False, "auth": a.auth, "connection": a.connection, "tool_count": None, "write_count": None,
                               "tokens_est": None, "code": None}
        try:
            token = await svc.token_for(p.user_id, a)
            tools = await svc.fetch_tools(a, p.user_id, token=token, fresh=True)
        except NeedsAuth as e:
            return out | {"code": "needs_login" if e.reason == "not_connected" else e.reason}
        except McpError as e:
            return out | {"code": f"mcp_{e.code}"}
        except OAuthError as e:
            return out | {"code": f"oauth_{e.code}"}
        return out | {"ok": True, "tool_count": len(tools), "write_count": sum(t.write for t in tools),
                      "tokens_est": sum(t.tokens_est for t in tools), "connection": my_app(p.user_id, server_id).connection}  # type: ignore[union-attr]

    @user.get("/api/me/settings")
    async def my_settings(p: Principal = Depends(require_user)) -> dict[str, Any]:
        v = cat.auto_auth(p.user_id)
        return {"auto_auth": v, "auto_auth_asked": v != "unset"}

    @user.patch("/api/me/settings")
    async def patch_settings(body: SettingsPatch, p: Principal = Depends(require_user)) -> dict[str, Any]:
        cat.set_auto_auth(p.user_id, body.auto_auth)
        return {"auto_auth": body.auto_auth, "auto_auth_asked": body.auto_auth != "unset"}

    # ── 공개: 제공자 → 브라우저 → 여기 → 데스크톱 loopback ──
    @public.get(CALLBACK_PATH)
    async def oauth_callback(
        request: Request, state: str = Query("", max_length=200), code: str = Query("", max_length=4096),
        iss: str | None = Query(None, max_length=1000), error: str = Query("", max_length=200),
    ) -> Response:
        limit(request, "mcp_callback", limit=60, window_s=600)
        try:
            cb = await svc.oauth.callback(state=state, code=code, iss=iss, error=error)
        except OAuthError as e:
            log.warning("mcp oauth callback failed: %s", e.code)
            return _no_store(_page("로그인을 마치지 못했어요", "BrewAI 로 돌아가서 다시 시도해 주세요.", 400))
        if cb.redirect is None:
            return _no_store(_page("로그인 요청이 만료됐어요", "BrewAI 로 돌아가서 다시 시도해 주세요.", 400))
        if cb.error:
            log.info("mcp oauth callback error: server=%s %s", cb.server_id, cb.error)
        return _no_store(RedirectResponse(cb.redirect, status_code=302))

    # ── 관리자 ──
    def oauth_client(issuer: str | None) -> dict[str, Any] | None:
        if not issuer:
            return None
        rows = svc.store.query(
            "SELECT client_id, source, auth_method, secret_ct IS NOT NULL AS has_secret, scope, updated_at FROM mcp_oauth_clients"
            " WHERE issuer = ? AND redirect_uri = ?", (issuer, svc.oauth.redirect_uri),
        )
        if not rows:
            return None
        r = rows[0]
        return {"issuer": issuer, "client_id": r["client_id"], "source": r["source"], "auth_method": r["auth_method"],
                "has_secret": bool(r["has_secret"]), "scope": r["scope"], "updated_at": r["updated_at"]}

    def admin_out(row: Any) -> dict[str, Any]:
        a = _row_app(row)
        tools, fetched = latest_tools(row["id"])
        return {
            "id": row["id"], "handle": row["handle"], "name": row["name"], "url": row["url"], "domain": domain_of(row["url"]),
            "description": row["description"], "aliases": list(a.aliases), "auth": row["auth"], "origin": row["origin"],
            "owner_user_id": row["owner_user_id"], "issuer": row["issuer"], "issuer_domain": domain_of(row["issuer"]) if row["issuer"] else None,
            "status": row["status"], "tool_count": row["tool_count"], "tool_tokens_est": row["tool_tokens_est"],
            "write_count": sum(t.write for t in tools) if tools else None, "tools_fetched_at": fetched,
            "connected_count": cat.connected_count(row["resource"]), "last_error": row["last_error"], "last_checked_at": row["last_checked_at"],
            "created_at": row["created_at"], "updated_at": row["updated_at"], "oauth_client": oauth_client(row["issuer"]), **_line(a),
        }

    def server_or_404(server_id: str, origin: str | None = None) -> Any:
        row = cat.server(server_id)
        if row is None or (origin is not None and row["origin"] != origin):
            raise Denied(404, "mcp_server_not_found")
        return row

    @admin.get("/api/admin/mcp/servers")
    async def admin_servers() -> list[dict[str, Any]]:
        rows = svc.store.query("SELECT * FROM mcp_servers WHERE origin = 'admin' ORDER BY created_at, id")
        return [admin_out(r) for r in rows]

    @admin.post("/api/admin/mcp/servers", status_code=201)
    async def admin_add(request: Request, body: AdminServerIn, p: Principal = Depends(require_admin)) -> dict[str, Any]:
        policy.require_mcp_add(p.actor, origin="admin", allow_user_servers=True)
        if body.handle is not None and not valid_handle(body.handle):
            raise Denied(422, "bad_handle")
        out = await preview(body.url, name=body.name, description=body.description, handle=body.handle)
        sid = cat.add_server(
            name=out["name"], url=out["url"], origin="admin", owner_user_id=None, handle=body.handle or out["handle"],
            description=body.description or "", aliases=body.aliases, auth=out["auth"], resource=out["resource"], issuer=out["issuer"],
        )
        if out["_tools"] is not None:
            svc.cache.put(sid, ToolCache.SHARED, out["_tools"])
        audit(request, "mcp.server.add", p.user_id, sid, {"origin": "admin", "domain": out["domain"], "auth": out["auth"]})
        return admin_out(server_or_404(sid)) | {"preview": public_preview(out)}

    @admin.get("/api/admin/mcp/servers/{server_id}")
    async def admin_server(server_id: str) -> dict[str, Any]:
        return admin_out(server_or_404(server_id))

    @admin.patch("/api/admin/mcp/servers/{server_id}")
    async def admin_patch(request: Request, server_id: str, body: AdminPatch, p: Principal = Depends(require_admin)) -> dict[str, Any]:
        row = server_or_404(server_id)
        changes = {k: getattr(body, k) for k in body.model_fields_set}
        if row["origin"] != "admin" and set(changes) - {"status"}:
            raise Denied(409, "user_server")  # 사용자 서버는 끄기만 (정의는 주인 것)
        if "name" in changes and not clean_name(changes["name"] or ""):
            raise Denied(422, "bad_name")
        if "handle" in changes and not valid_handle(changes["handle"]):
            raise Denied(422, "bad_handle")
        if "status" in changes and changes["status"] is None:
            raise Denied(422, "bad_status")
        if "description" in changes:
            changes["description"] = changes["description"] or ""
        if "aliases" in changes:
            changes["aliases"] = changes["aliases"] or []
        cat.update_server(server_id, changes)
        if "status" in changes:
            audit(request, "mcp.server.disable" if changes["status"] == "disabled" else "mcp.server.enable", p.user_id, server_id)
        return admin_out(server_or_404(server_id))

    @admin.delete("/api/admin/mcp/servers/{server_id}", status_code=204)
    async def admin_delete(request: Request, server_id: str, p: Principal = Depends(require_admin)) -> Response:
        server_or_404(server_id)
        cat.delete_server(server_id)
        audit(request, "mcp.server.remove", p.user_id, server_id)
        return Response(status_code=204)

    @admin.post("/api/admin/mcp/servers/{server_id}/test")
    async def admin_test(server_id: str, p: Principal = Depends(require_admin)) -> dict[str, Any]:
        row = server_or_404(server_id)
        token = None
        if row["auth"] == "oauth":  # 관리자 본인이 연결해 뒀으면 그 계정으로 도구 수까지
            try:
                token = await svc.oauth.access_token(p.user_id, row["resource"])
            except (NeedsAuth, OAuthError):
                token = None
        started = time.monotonic()
        out: dict[str, Any] = {"ok": False, "auth": row["auth"], "tool_count": None, "write_count": None, "tokens_est": None, "code": None}
        try:
            probe = await svc.mcp.probe(row["url"], token=token)
        except McpError as e:
            cat.update_server(server_id, {"last_error": f"mcp_{e.code}"})
            return out | {"code": f"mcp_{e.code}", "duration_ms": int((time.monotonic() - started) * 1000)}
        ms = int((time.monotonic() - started) * 1000)
        if probe.tools is not None:
            # 토큰 없이 목록이 열려도, 호출이 401 + resource_metadata 로 로그인을 요구했던 서버(auth_hint 있음 = Google 처럼 목록만 공개)는
            # '인증 없음'으로 되돌리지 않는다. 그 밖의 OAuth 서버는 예전대로 '인증 없음'으로 (서버가 공개로 바뀜)
            keep_oauth = probe.auth == "none" and row["auth"] == "oauth" and cat.auth_hint(server_id) is not None
            svc.cache.put(server_id, ToolCache.SHARED if probe.auth == "none" and not keep_oauth else p.user_id, probe.tools)
            if probe.auth != row["auth"] and not keep_oauth:
                cat.update_server(server_id, {"auth": probe.auth})
            return out | {"ok": True, "auth": row["auth"] if keep_oauth else probe.auth, "tool_count": len(probe.tools), "write_count": sum(t.write for t in probe.tools),
                          "tokens_est": sum(t.tokens_est for t in probe.tools), "duration_ms": ms}
        if row["auth"] != "oauth":
            cat.update_server(server_id, {"auth": "oauth"})
        cat.update_server(server_id, {"last_error": None})
        return out | {"ok": True, "auth": "oauth", "code": "needs_login", "duration_ms": ms}  # 서버는 살아 있다 · 도구 수는 로그인 뒤

    @admin.get("/api/admin/mcp/servers/{server_id}/tools")
    async def admin_tools(server_id: str) -> dict[str, Any]:
        row = server_or_404(server_id)
        tools, fetched = latest_tools(server_id)
        names = NameMap.of(row["handle"], [t.name for t in tools])
        pol = cat.tool_policy(server_id)
        return {"tools": [_tool_out(t, row["handle"], names, pol.get(t.name)) for t in tools], "fetched_at": fetched}

    @admin.patch("/api/admin/mcp/servers/{server_id}/tools")
    async def admin_tool_patch(server_id: str, body: ToolPatch) -> dict[str, Any]:
        server_or_404(server_id)
        cat.set_tool_policy(server_id, body.tool, mode=body.mode, always_reveal=body.always_reveal, aliases=body.aliases)
        return await admin_tools(server_id)

    @admin.put("/api/admin/mcp/servers/{server_id}/oauth-client")
    async def admin_client(server_id: str, body: ClientIn) -> dict[str, Any]:
        row = server_or_404(server_id)
        issuer = row["issuer"]
        if not issuer:
            try:
                hint = (await svc.mcp.probe(row["url"])).resource_metadata  # 401 헤더로만 PRM 을 알리는 서버
            except McpError:
                hint = None
            try:
                disc = await svc.oauth.discover(row["url"], resource_metadata=hint)
            except OAuthError as e:
                raise _oauth_error(e) from None
            except ssrf.Blocked as e:
                raise _url_error(e.code) from None
            issuer = disc.auth_server.issuer
            cat.update_server(server_id, {"issuer": issuer, "resource": disc.resource, "auth": "oauth"})
        try:
            svc.oauth.set_client(issuer, client_id=body.client_id, client_secret=body.client_secret, auth_method=body.auth_method,
                                 scope=body.scope)
        except OAuthError as e:
            raise _oauth_error(e) from None
        return oauth_client(issuer) or {}

    @admin.get("/api/admin/mcp/user-servers")
    async def admin_user_servers() -> list[dict[str, Any]]:
        rows = svc.store.query(
            "SELECT s.*, u.display_name AS owner_name, (SELECT COUNT(*) FROM mcp_server_shares sh WHERE sh.server_id = s.id) AS share_count"
            " FROM mcp_servers s LEFT JOIN users u ON u.id = s.owner_user_id WHERE s.origin = 'user' ORDER BY s.created_at DESC, s.id"
        )
        return [admin_out(r) | {"owner_name": r["owner_name"], "share_count": r["share_count"]} for r in rows]

    @admin.patch("/api/admin/mcp/user-servers/{server_id}")
    async def admin_user_server(request: Request, server_id: str, body: StatusIn, p: Principal = Depends(require_admin)) -> dict[str, Any]:
        row = server_or_404(server_id, "user")
        found = cat.server_facts(server_id, p.user_id)
        assert found is not None
        policy.require_mcp_disable(Actor(p.user_id, p.instance_admin), found[1])
        cat.update_server(server_id, {"status": body.status})
        audit(request, "mcp.server.disable" if body.status == "disabled" else "mcp.server.enable", p.user_id, server_id)
        return admin_out(server_or_404(row["id"]))

    @admin.get("/api/admin/mcp/presets")
    async def admin_presets() -> dict[str, Any]:
        rows = svc.store.query("SELECT url FROM mcp_servers WHERE origin = 'admin'")
        return presets_out({r["url"] for r in rows}, admin=True)

    @admin.get("/api/admin/mcp/policy")
    async def admin_policy() -> dict[str, Any]:
        return cat.settings()

    @admin.patch("/api/admin/mcp/policy")
    async def admin_policy_patch(body: PolicyPatch) -> dict[str, Any]:
        pats = None
        if body.url_allowlist is not None:
            pats = [x.strip().lower() for x in body.url_allowlist if x and x.strip()]
            if any(len(x) > 253 or not re.fullmatch(r"(\*\.)?[a-z0-9.-]+(:\d+)?", x) for x in pats):
                raise Denied(422, "bad_url_allowlist")
        cat.set_settings(allow_user_servers=body.allow_user_servers, url_allowlist=pats)
        return cat.settings()
