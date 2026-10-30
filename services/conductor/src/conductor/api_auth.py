"""로그인 · 세션 · 내 계정 경로 (ADR-0010 · slice 03). 요청 · 응답 JSON = snake_case · 오류 = {detail: code}.

공개 (시도 제한)
  GET    /api/auth/state             {needs_bootstrap, first_login, providers: {password, google}, password_min[, test_admin: true]}
                                     (first_login = 계정은 있는데 아직 아무도 로그인 안 함 → 로그인 화면이 .env 첫 관리자 값을 알려 준다)
                                     (test_admin = 테스트 관리자 admin / admin 이 켜져 있을 때만 붙는다 → 로그인 화면 안내)
  POST   /api/auth/login             {email, password} → Tokens · 401 invalid_credentials · 429 rate_limited (+Retry-After)
                                     (email = 이메일 · 테스트 관리자가 켜져 있으면 'admin' 도. 관리자 로그인도 같다)
  POST   /api/auth/token             {grant_type: refresh_token, refresh_token} | {grant_type: handoff, code, code_verifier} → Tokens
                                     · 401 invalid_grant (만료 · 이미 씀 · 폐기 — 이미 쓴 refresh 는 세션 통째 폐기)
  POST   /api/auth/invite/preview    {code} → {org, inviter_name, org_role, spaces, email_hint, expires_at, google} · 404 invite_invalid
  POST   /api/auth/signup            {code, email, password, display_name?} → Tokens · 404 invite_invalid · 403 invite_email_mismatch
                                     · 409 email_taken · 422 password_too_short | password_too_long | bad_email | bad_display_name
  POST   /api/auth/reset             {code: bwp_…, password} → 204 (모든 세션 폐기) · 404 reset_invalid · 422 password_*
  POST   /api/admin/auth/login       {email, password} → {user, csrf_token, expires_at} + Set-Cookie · 403 not_admin
브라우저 (시스템 브라우저 · 관리자 콘솔이 여는 주소)
  GET    /api/auth/google/start      ?client=desktop&port&cc&ds[&invite][&link] | ?client=admin → 302 Google · 404 google_disabled
  GET    /api/auth/google/callback   → desktop: 302 http://127.0.0.1:{port}/cb?code=bwh_…&ds | ?error=<code>&ds
                                       (연결 흐름도 code= — 연결은 그 code 를 연결을 시작한 본인이 complete 로 낼 때)
                                     → admin: 302 / (쿠키) | /?auth_error=<code>
사용자 (Bearer)
  POST   /api/auth/logout            204 (이 세션만)
  GET    /api/me · PATCH /api/me     {display_name?, last_space_id?} → Me
  POST   /api/me/password            {current_password?, new_password} → 204 (다른 세션 폐기) · 403 wrong_password
  POST   /api/me/google/link         → {link: bwl_…, expires_in} (start 의 &link= 에 넣는다 · 5분 · 1회)
  POST   /api/me/google/link/complete  {code: bwh_…, code_verifier} → Me · 400 invalid_grant · 409 identity_in_use | already_linked
                                     (code 를 받은 PC 의 PKCE + 연결을 시작한 그 사람이어야 — 남이 보낸 시작 주소로는 연결되지 않는다)
  DELETE /api/me/google              204 · 404 not_linked · 409 last_login_method
관리자 (쿠키 + CSRF)
  GET    /api/admin/auth/me          {user, csrf_token, expires_at} · POST /api/admin/auth/logout 204
"""

from __future__ import annotations

import logging
import re
import secrets
from typing import Any, Literal
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from .auth import passwords, tokens
from .auth.accounts import (
    LINK_S,
    OAUTH_FLOW_S,
    TEST_ADMIN_ID,
    Accounts,
    AuthFailed,
    Principal,
    Tokens,
    clean_display_name,
    default_display_name,
    normalize_email,
)
from .auth.directory import Directory
from .auth.google import GoogleOIDC, OIDCError, email_verified
from .auth.http import (
    OAUTH_COOKIE,
    accounts_of,
    clear_admin_cookie,
    client_ip,
    directory_of,
    from_this_pc,
    guard_of,
    limit,
    require_admin,
    require_user,
    set_admin_cookie,
)
from .settings import Settings

CALLBACK = "/api/auth/google/callback"
DS_RE = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
IP_WINDOW_S = 15 * 60
log = logging.getLogger("conductor.auth")


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LoginIn(_In):
    email: str = Field(max_length=320)
    password: str = Field(max_length=1024)


class TokenIn(_In):
    grant_type: Literal["refresh_token", "handoff"]
    refresh_token: str | None = Field(default=None, max_length=200)
    code: str | None = Field(default=None, max_length=200)
    code_verifier: str | None = Field(default=None, max_length=200)


class InviteIn(_In):
    code: str = Field(max_length=40)


class SignupIn(_In):
    code: str = Field(max_length=40)
    email: str = Field(max_length=320)
    password: str = Field(max_length=1024)
    display_name: str | None = Field(default=None, max_length=200)


class ResetIn(_In):
    code: str = Field(max_length=200)
    password: str = Field(max_length=1024)


class MePatch(_In):
    display_name: str | None = Field(default=None, max_length=200)
    last_space_id: str | None = Field(default=None, max_length=64)


class LinkCompleteIn(_In):
    code: str = Field(max_length=200)
    code_verifier: str = Field(max_length=200)


class PasswordIn(_In):
    current_password: str | None = Field(default=None, max_length=1024)
    new_password: str = Field(max_length=1024)


def mask_email(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    local, domain = email.split("@", 1)
    return f"{local[:1]}***@{domain}"


def me_out(accounts: Accounts, directory: Directory, user_id: str) -> dict[str, Any]:
    u = accounts.user(user_id)
    assert u is not None
    ids = accounts.identities(user_id)
    google = next((i for i in ids if i["provider"] == "google"), None)
    return {
        "id": u["id"], "email": u["email"], "display_name": u["display_name"], "instance_role": u["instance_role"],
        "created_at": u["created_at"], "has_password": any(i["provider"] == "password" for i in ids),
        "google": {"email": google["email"], "hd": google["hd"], "linked_at": google["created_at"]} if google else None,
        "orgs": [{"id": o["id"], "name": o["name"], "role": o["role"]} for o in directory.user_orgs(user_id)],
        "personal_space_id": directory.personal_space_id(user_id), "last_space_id": u["last_space_id"],
    }


def user_brief(accounts: Accounts, user_id: str) -> dict[str, Any]:
    u = accounts.user(user_id)
    assert u is not None
    return {"id": u["id"], "email": u["email"], "display_name": u["display_name"], "instance_role": u["instance_role"]}


def tokens_out(request: Request, t: Tokens) -> dict[str, Any]:
    return {
        "access_token": t.access_token, "refresh_token": t.refresh_token, "token_type": "Bearer", "expires_in": t.expires_in,
        "session_id": t.session_id, "user": me_out(accounts_of(request), directory_of(request), t.user_id),
    }


def _no_store(response: Response) -> Response:
    response.headers["cache-control"] = "no-store"
    response.headers["referrer-policy"] = "no-referrer"  # 콜백 주소의 code · state 가 다음 페이지로 새지 않게
    return response


def _page(title: str, body: str, status: int) -> HTMLResponse:
    html = (
        '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        f"<title>BrewAI</title><body style=\"font:16px system-ui;margin:15vh auto;max-width:32rem;padding:0 16px\">"
        f"<h1 style=\"font-size:20px\">{title}</h1><p>{body}</p></body></html>"
    )
    return HTMLResponse(html, status_code=status)


def password_login(request: Request, body: LoginIn) -> Any:
    """비밀번호 확인 + 시도 제한 (계정 키 · IP 키). 틀림 · 없는 계정 · 비활성 = 같은 응답 401 invalid_credentials.
    IP 키는 15분 창 (회사 NAT · 관리자 Vite proxy 뒤 여러 사람 — 하루 치 오타가 쌓여 모두를 잠그지 않게)."""
    acc, ip = accounts_of(request), client_ip(request)
    login_id = acc.login_id(body.email)
    account_key = f"login:acct:{login_id or body.email.strip().lower()[:320]}"
    ip_key = f"login:ip:{ip}"
    wait = acc.retry_after(account_key) or acc.retry_after(ip_key)
    if wait:
        raise AuthFailed(429, "rate_limited", retry_after=wait)
    user = acc.check_password(body.email, body.password)
    # 테스트 관리자 admin / admin = 이 PC 에서 온 요청만 (설정 주소가 loopback 이어도 같은 PC 의 reverse proxy · 0.0.0.0 바인드 뒤라면 막는다)
    if user is not None and login_id == TEST_ADMIN_ID and not from_this_pc(request):
        user = None
    if user is None:
        acc.failed(account_key)
        acc.failed(ip_key, free=50, window_s=IP_WINDOW_S)
        acc.audit("login", actor=None, result="denied", ip=ip, detail={"email": login_id})
        raise AuthFailed(401, "invalid_credentials")
    acc.cleared(account_key)
    return user


def google_identity_of(settings: Settings, claims: dict[str, Any]) -> dict[str, Any]:
    email, hd = claims.get("email"), claims.get("hd")
    return {
        "issuer": settings.google_issuer, "subject": claims["sub"], "email": email if isinstance(email, str) else None,
        "hd": hd if isinstance(hd, str) and hd else None,
    }


def link_problem(acc: Accounts, user_id: str, google: dict[str, Any]) -> str | None:
    """설정 › 계정 › Google 연결을 막는 것. None = 연결해도 된다 (이미 이 사람에게 붙은 같은 Google 도 None)."""
    ident = acc.google_identity(google["issuer"], google["subject"])
    if ident is not None:
        return None if ident["user_id"] == user_id else "identity_in_use"
    if any(i["provider"] == "google" for i in acc.identities(user_id)):
        return "already_linked"
    return None


def resolve_google(acc: Accounts, dirx: Directory, settings: Settings, claims: dict[str, Any], flow: dict[str, Any], ip: str) -> tuple[str, str]:
    """Google 계정 → 사람 (slice 03 순서표). ('user' | 'link', user_id) · ('error', code).
    1 (issuer, sub) → 그 사람 · 2 초대 → 가입 · 3 같은 이메일 + Google 이 권위 → 자동 연결 · 4 조직 domain_auto(hd) → 가입 · 5 거절.
    2~4 는 email_verified 참일 때만. 관리자 콘솔(client=admin)은 가입(2 · 4)을 하지 않는다.
    'link' = 연결 흐름 — 여기선 아직 붙이지 않는다 (콜백이 handoff 를 주고 시작한 본인이 complete 로 붙인다)."""
    google = google_identity_of(settings, claims)
    email, hd, name = google["email"], google["hd"], claims.get("name")
    ident = acc.google_identity(google["issuer"], google["subject"])
    link_user = flow.get("link_user_id")
    if link_user:  # 설정 › 계정 › Google 연결 (로그인한 본인이 시작)
        problem = link_problem(acc, link_user, google)
        return ("error", problem) if problem else ("link", link_user)
    if ident is not None:
        user = acc.user(ident["user_id"])
        if user is None or user["status"] != "active":
            return "error", "account_disabled"
        acc.touch_identity(ident["id"], email=email, hd=hd)
        return "user", user["id"]
    if not email_verified(claims) or not email or normalize_email(email) is None:
        return "error", "email_unverified"
    signup = flow.get("client") == "desktop"
    existing = acc.user_by_email(normalize_email(email))  # type: ignore[arg-type]
    if existing is None and signup and flow.get("invite"):
        try:
            return "user", dirx.signup(flow["invite"], email=email, display_name=default_display_name(email, name), google=google)
        except ValueError as e:
            return "error", str(e)
    if existing is not None:
        authoritative = email.lower().endswith("@gmail.com") or hd is not None
        if not authoritative:
            return "error", "link_required"  # '비밀번호로 로그인 후 설정 › 계정에서 연결'
        if existing["status"] != "active":
            return "error", "account_disabled"
        if any(i["provider"] == "google" for i in acc.identities(existing["id"])):
            return "error", "link_required"  # 이미 다른 Google 계정이 연결됨
        with acc.store.tx() as db:
            acc.link_google(db, existing["id"], **google)
            claimed = acc.claim_by_google(db, existing["id"])  # 이메일 미확인 계정 = 비밀번호 · 세션 끊기 (계정 선점)
            acc.audit(
                "google_claim" if claimed else "google_auto_link", actor=existing["id"], target_type="user", target_id=existing["id"], ip=ip,
                detail={"hd": hd}, db=db,
            )
        return "user", existing["id"]
    org = dirx.domain_org(hd) if hd and signup else None
    if org is not None:
        with acc.store.tx() as db:
            user_id = dirx.create_account(
                db, email=email, display_name=default_display_name(email, name), org_id=org["id"], org_role="member", email_verified=True
            )
            acc.link_google(db, user_id, **google)
            acc.audit("signup", actor=user_id, target_type="org", target_id=org["id"], ip=ip, detail={"method": "google_domain"}, db=db)
        return "user", user_id
    return "error", "not_invited"


def register(public: APIRouter, user: APIRouter, admin: APIRouter, *, settings: Settings, google: GoogleOIDC) -> None:
    # ── 공개 ──
    @public.get("/api/auth/state")
    async def auth_state(request: Request) -> dict[str, Any]:
        acc = accounts_of(request)
        return {
            "needs_bootstrap": acc.count_users() == 0, "first_login": not acc.anyone_logged_in(),
            "providers": {"password": True, "google": google.enabled},
            "password_min": settings.password_min,
            **({"test_admin": True} if settings.test_admin_active else {}),
        }

    @public.post("/api/auth/login")
    async def login(request: Request, body: LoginIn) -> dict[str, Any]:
        found = password_login(request, body)
        acc = accounts_of(request)
        t = acc.start_desktop(found["id"], ip=client_ip(request), user_agent=request.headers.get("user-agent"))
        acc.audit("login", actor=found["id"], target_type="session", target_id=t.session_id, ip=client_ip(request), detail={"client": "desktop"})
        return tokens_out(request, t)

    @public.post("/api/auth/token")
    async def token(request: Request, body: TokenIn) -> dict[str, Any]:
        limit(request, "token", limit=120, window_s=60)
        acc = accounts_of(request)
        if body.grant_type == "refresh_token":
            return tokens_out(request, acc.refresh(body.refresh_token or ""))
        found = acc.consume_once("handoff", body.code) if tokens.shaped(body.code, tokens.HANDOFF) else None
        verifier = body.code_verifier or ""
        if found is None or "link" in found[1] or not tokens.PKCE_RE.match(verifier) or not tokens.same(tokens.s256(verifier), found[1].get("cc", "")):
            raise AuthFailed(401, "invalid_grant")  # 연결 흐름의 code 로는 로그인하지 않는다 (→ /api/me/google/link/complete)
        u = acc.user(found[0] or "")
        if u is None or u["status"] != "active":
            raise AuthFailed(401, "invalid_grant")
        t = acc.start_desktop(u["id"], ip=client_ip(request), user_agent=request.headers.get("user-agent"))
        acc.audit("login", actor=u["id"], target_type="session", target_id=t.session_id, ip=client_ip(request), detail={"client": "desktop", "method": "google"})
        return tokens_out(request, t)

    @public.post("/api/auth/invite/preview")
    async def invite_preview(request: Request, body: InviteIn) -> dict[str, Any]:
        limit(request, "invite", limit=20, window_s=600)
        dirx, acc = directory_of(request), accounts_of(request)
        inv = dirx.live_invite(body.code)
        if inv is None:
            raise AuthFailed(404, "invite_invalid")
        org = dirx.org(inv["org_id"])
        inviter = acc.user(inv["created_by"]) if inv["created_by"] else None
        return {
            "org": {"id": inv["org_id"], "name": org["name"] if org else ""}, "inviter_name": inviter["display_name"] if inviter else None,
            "org_role": inv["org_role"], "spaces": dirx.invite_space_names(inv), "email_hint": mask_email(inv["email"]),
            "expires_at": inv["expires_at"], "google": google.enabled,
        }

    @public.post("/api/auth/signup", status_code=201)
    async def signup(request: Request, body: SignupIn) -> dict[str, Any]:
        limit(request, "signup", limit=10, window_s=600)
        if problem := passwords.problem(body.password, settings.password_min):
            raise AuthFailed(422, problem)
        name = None
        if body.display_name is not None and (name := clean_display_name(body.display_name)) is None:
            raise AuthFailed(422, "bad_display_name")
        try:
            user_id = directory_of(request).signup(body.code, email=body.email, display_name=name, password_hash=passwords.hash_password(body.password))
        except ValueError as e:
            raise AuthFailed({"invite_invalid": 404, "invite_email_mismatch": 403, "email_taken": 409}.get(str(e), 422), str(e)) from e
        t = accounts_of(request).start_desktop(user_id, ip=client_ip(request), user_agent=request.headers.get("user-agent"))
        return tokens_out(request, t)

    @public.post("/api/auth/reset", status_code=204)
    async def reset(request: Request, body: ResetIn) -> Response:
        limit(request, "reset", limit=10, window_s=600)
        if problem := passwords.problem(body.password, settings.password_min):
            raise AuthFailed(422, problem)  # 코드를 쓰기 전에 (약한 비밀번호가 코드를 태우지 않게)
        acc = accounts_of(request)
        found = acc.consume_once("reset", body.code) if tokens.shaped(body.code, tokens.RESET) else None
        if found is None or found[0] is None:
            raise AuthFailed(404, "reset_invalid")
        with acc.store.tx() as db:
            acc.set_password(db, found[0], passwords.hash_password(body.password))
            acc.revoke_user(found[0], "password_reset", db=db)
            acc.audit("password_reset", actor=found[0], target_type="user", target_id=found[0], ip=client_ip(request), db=db)
        acc.cleared(f"login:acct:{acc.user(found[0])['email_norm']}")  # type: ignore[index]
        return Response(status_code=204)

    @public.post("/api/admin/auth/login")
    async def admin_login(request: Request, body: LoginIn) -> Response:
        found = password_login(request, body)
        acc = accounts_of(request)
        if found["instance_role"] != "admin":
            acc.audit("admin_login", actor=found["id"], result="denied", ip=client_ip(request))
            raise AuthFailed(403, "not_admin")
        s = acc.start_admin(found["id"], ip=client_ip(request), user_agent=request.headers.get("user-agent"))
        acc.audit("admin_login", actor=found["id"], target_type="user", target_id=found["id"], ip=client_ip(request))
        res = JSONResponse({"user": user_brief(acc, found["id"]), "csrf_token": s.csrf_token, "expires_at": s.expires_at})
        set_admin_cookie(res, s, secure=settings.secure_cookies)
        return _no_store(res)

    # ── Google (브라우저가 여는 주소) ──
    @public.get("/api/auth/google/start")
    async def google_start(
        request: Request,
        client: Literal["desktop", "admin"] = "desktop",
        port: int | None = Query(None, ge=1024, le=65535),
        cc: str | None = Query(None, max_length=64),
        ds: str | None = Query(None, max_length=128),
        invite: str | None = Query(None, max_length=40),
        link: str | None = Query(None, max_length=64),
    ) -> Response:
        if not google.enabled:
            raise AuthFailed(404, "google_disabled")
        limit(request, "google", limit=30, window_s=600)
        acc = accounts_of(request)
        flow: dict[str, Any] = {"client": client}
        if client == "desktop":
            if port is None or not cc or not tokens.CHALLENGE_RE.match(cc) or not ds or not DS_RE.match(ds):
                raise AuthFailed(400, "bad_request")
            flow |= {"port": port, "cc": cc, "ds": ds, "redirect_uri": f"{settings.public_url}{CALLBACK}"}
        else:
            flow["redirect_uri"] = f"{settings.admin_url}{CALLBACK}"
        if invite:
            flow["invite"] = invite
        if link:
            linked = acc.consume_once("link", link) if client == "desktop" and tokens.shaped(link, tokens.LINK) else None
            if linked is None or linked[0] is None:
                raise AuthFailed(400, "link_expired")
            flow["link_user_id"] = linked[0]
        binding, nonce, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(48)
        flow |= {"nonce": nonce, "verifier": verifier, "binding": tokens.digest(binding)}
        state = acc.issue_once("oauth_flow", OAUTH_FLOW_S, prefix="", data=flow)
        try:
            url = await google.authorize_url(redirect_uri=flow["redirect_uri"], state=state, nonce=nonce, verifier=verifier)
        except OIDCError as e:
            log.warning("google sign-in start failed: %s", e.reason)
            raise AuthFailed(502, "google_failed") from e
        res = RedirectResponse(url, status_code=302)
        res.set_cookie(
            OAUTH_COOKIE, binding, max_age=OAUTH_FLOW_S, path="/api/auth/google", httponly=True, samesite="lax",
            secure=flow["redirect_uri"].startswith("https://"),
        )
        return _no_store(res)

    @public.get("/api/auth/google/callback")
    async def google_callback(
        request: Request, state: str = Query("", max_length=200), code: str = Query("", max_length=2048), error: str = Query("", max_length=200),
    ) -> Response:
        acc, ip = accounts_of(request), client_ip(request)
        found = acc.consume_once("oauth_flow", state) if state else None
        if found is None:
            return _no_store(_page("로그인 요청이 만료됐어요", "BrewAI 로 돌아가서 다시 시도해 주세요.", 400))
        flow = found[1]

        def finish(err: str | None, user_id: str | None = None, *, link: dict[str, Any] | None = None) -> Response:
            if err:
                acc.audit("login_google", actor=user_id, result="denied", ip=ip, detail={"code": err, "client": flow["client"]})
            if flow["client"] == "admin":
                res: Response = RedirectResponse(f"/?{urlencode({'auth_error': err})}" if err else "/", status_code=302)
                if not err and user_id:
                    s = acc.start_admin(user_id, ip=ip, user_agent=request.headers.get("user-agent"))
                    acc.audit("admin_login", actor=user_id, target_type="user", target_id=user_id, ip=ip, detail={"method": "google"})
                    set_admin_cookie(res, s, secure=settings.secure_cookies)
            else:
                params: dict[str, Any] = {"ds": flow["ds"]}
                if err:
                    params["error"] = err
                else:  # 연결도 code 로 (data.link) — 붙이는 건 그 PC 의 앱이 로그인한 채 complete 로 (남이 보낸 시작 주소 = 연결 안 됨)
                    data = {"cc": flow["cc"]} | ({"link": link} if link else {})
                    params["code"] = acc.issue_once("handoff", 60, prefix=tokens.HANDOFF, user_id=user_id, data=data)
                # host 고정 127.0.0.1 · port 는 start 에서 숫자로 검사한 값
                res = RedirectResponse(f"http://127.0.0.1:{int(flow['port'])}/cb?{urlencode(params)}", status_code=302)
            res.delete_cookie(OAUTH_COOKIE, path="/api/auth/google")
            return _no_store(res)

        binding = request.cookies.get(OAUTH_COOKIE)
        if not binding or not tokens.same(tokens.digest(binding), flow["binding"]):
            return finish("binding_mismatch")
        if error or not code:
            return finish("cancelled" if error == "access_denied" else "google_failed")
        try:
            claims = await google.exchange(code=code, redirect_uri=flow["redirect_uri"], verifier=flow["verifier"], nonce=flow["nonce"])
        except OIDCError as e:
            log.warning("google sign-in rejected: %s", e.reason)
            return finish(e.code)
        kind, value = resolve_google(acc, directory_of(request), settings, claims, flow, ip)
        if kind == "error":
            return finish(value)
        if flow["client"] == "admin" and acc.user(value)["instance_role"] != "admin":  # type: ignore[index]
            return finish("not_admin", value)
        return finish(None, value, link=google_identity_of(settings, claims) if kind == "link" else None)

    # ── 사용자 (Bearer) ──
    @user.post("/api/auth/logout", status_code=204)
    async def logout(request: Request, p: Principal = Depends(require_user)) -> Response:
        acc = accounts_of(request)
        acc.revoke(p.session_id, "logout")
        acc.audit("logout", actor=p.user_id, target_type="session", target_id=p.session_id, ip=client_ip(request))
        return Response(status_code=204)

    @user.get("/api/me")
    async def get_me(request: Request, p: Principal = Depends(require_user)) -> dict[str, Any]:
        return me_out(accounts_of(request), directory_of(request), p.user_id)

    @user.patch("/api/me")
    async def patch_me(request: Request, body: MePatch, p: Principal = Depends(require_user)) -> dict[str, Any]:
        acc, dirx = accounts_of(request), directory_of(request)
        changes: dict[str, Any] = {}
        if "display_name" in body.model_fields_set:
            if (name := clean_display_name(body.display_name)) is None:
                raise AuthFailed(422, "bad_display_name")
            changes["display_name"] = name
        if "last_space_id" in body.model_fields_set and body.last_space_id is not None:
            changes["last_space_id"] = guard_of(request).space(p.actor, body.last_space_id).id  # 멤버가 아니면 404
        if changes:
            with acc.store.tx() as db:
                db.execute(f"UPDATE users SET {', '.join(f'{k} = ?' for k in changes)} WHERE id = ?", (*changes.values(), p.user_id))
        return me_out(acc, dirx, p.user_id)

    @user.post("/api/me/password", status_code=204)
    async def change_password(request: Request, body: PasswordIn, p: Principal = Depends(require_user)) -> Response:
        acc = accounts_of(request)
        key = f"login:acct:{p.email.lower()}"
        if wait := acc.retry_after(key):
            raise AuthFailed(429, "rate_limited", retry_after=wait)
        stored = acc.password_hash(p.user_id)
        if stored is not None and not passwords.verify(stored, body.current_password or ""):
            acc.failed(key)
            raise AuthFailed(403, "wrong_password")  # 401 이 아니다 (데스크톱이 401 = 세션 만료로 읽는다)
        if problem := passwords.problem(body.new_password, settings.password_min):
            raise AuthFailed(422, problem)
        with acc.store.tx() as db:
            acc.set_password(db, p.user_id, passwords.hash_password(body.new_password))
            acc.revoke_user(p.user_id, "password_change", keep=p.session_id, db=db)
            acc.audit("password_change", actor=p.user_id, target_type="user", target_id=p.user_id, ip=client_ip(request), db=db)
        acc.cleared(key)
        return Response(status_code=204)

    @user.post("/api/me/google/link")
    async def google_link(request: Request, p: Principal = Depends(require_user)) -> dict[str, Any]:
        if not google.enabled:
            raise AuthFailed(404, "google_disabled")
        link = accounts_of(request).issue_once("link", LINK_S, prefix=tokens.LINK, user_id=p.user_id)
        return {"link": link, "expires_in": LINK_S}

    @user.post("/api/me/google/link/complete")
    async def google_link_complete(request: Request, body: LinkCompleteIn, p: Principal = Depends(require_user)) -> dict[str, Any]:
        acc = accounts_of(request)
        found = acc.consume_once("handoff", body.code) if tokens.shaped(body.code, tokens.HANDOFF) else None
        if (
            found is None or found[0] != p.user_id or "link" not in found[1] or not tokens.PKCE_RE.match(body.code_verifier)
            or not tokens.same(tokens.s256(body.code_verifier), found[1].get("cc", ""))
        ):
            raise AuthFailed(400, "invalid_grant")
        google = found[1]["link"]
        if problem := link_problem(acc, p.user_id, google):
            raise AuthFailed(409, problem)
        if acc.google_identity(google["issuer"], google["subject"]) is None:
            with acc.store.tx() as db:
                acc.link_google(db, p.user_id, **google)
                acc.audit("google_link", actor=p.user_id, target_type="user", target_id=p.user_id, ip=client_ip(request), db=db)
        return me_out(acc, directory_of(request), p.user_id)

    @user.delete("/api/me/google", status_code=204)
    async def google_unlink(request: Request, p: Principal = Depends(require_user)) -> Response:
        acc = accounts_of(request)
        kinds = {i["provider"] for i in acc.identities(p.user_id)}
        if "google" not in kinds:
            raise AuthFailed(404, "not_linked")
        if "password" not in kinds:
            raise AuthFailed(409, "last_login_method")
        acc.unlink_google(p.user_id)
        acc.audit("google_unlink", actor=p.user_id, target_type="user", target_id=p.user_id, ip=client_ip(request))
        return Response(status_code=204)

    # ── 관리자 (쿠키 + CSRF) ──
    @admin.get("/api/admin/auth/me")
    async def admin_me(request: Request, p: Principal = Depends(require_admin)) -> dict[str, Any]:
        acc = accounts_of(request)
        return {"user": user_brief(acc, p.user_id), "csrf_token": request.state.csrf, "expires_at": acc.admin_expires_at(p.session_id)}

    @admin.post("/api/admin/auth/logout", status_code=204)
    async def admin_logout(request: Request, p: Principal = Depends(require_admin)) -> Response:
        acc = accounts_of(request)
        acc.revoke(p.session_id, "logout")
        acc.audit("admin_logout", actor=p.user_id, target_type="session", target_id=p.session_id, ip=client_ip(request))
        res = Response(status_code=204)
        clear_admin_cookie(res, secure=settings.secure_cookies)
        return res
