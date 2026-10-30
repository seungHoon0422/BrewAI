"""FastAPI 접착층: 누가 부르는가. 라우터 단위로 붙인다 (app.py · api_*.py) — 경로마다 잊을 수 없게.

  require_user   `/api/*` (관리자 제외) = `Authorization: Bearer bwa_…` 만. 쿠키는 보지 않는다.
  require_admin  `/api/admin/*` = 관리자 쿠키만 + instance admin. Authorization 헤더가 붙으면 401 wrong_surface (표면 섞임).
                 안전하지 않은 메서드 = `X-CSRF-Token` 이 세션 값과 같아야 · `Sec-Fetch-Site` 가 있으면 same-origin | none 만.
오류 = {detail: code} 하나 (401 은 WWW-Authenticate: Bearer · 429 는 Retry-After).
"""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse, Response

from ..scopes import Scopes
from . import tokens
from .accounts import Accounts, AdminSession, AuthFailed, Principal
from .directory import Directory
from .guard import Guard
from .policy import Denied

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
OAUTH_COOKIE = "brewai_oauth"  # Google 시작 ↔ 콜백 바인딩 (같은 브라우저인지)


def admin_cookie_name(secure: bool) -> str:
    return "__Host-brewai_admin" if secure else "brewai_admin"


def accounts_of(request: Request) -> Accounts:
    return request.app.state.accounts


def directory_of(request: Request) -> Directory:
    return request.app.state.directory


def guard_of(request: Request) -> Guard:
    return request.app.state.guard


def scopes_of(request: Request) -> Scopes:
    return request.app.state.scopes


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


async def require_user(request: Request) -> Principal:
    header = request.headers.get("authorization")
    if not header:
        raise AuthFailed(401, "auth_required")
    scheme, _, token = header.partition(" ")
    principal = accounts_of(request).access(token.strip()) if scheme.lower() == "bearer" else None
    if principal is None:
        raise AuthFailed(401, "invalid_token")
    request.state.principal = principal
    return principal


async def require_admin(request: Request) -> Principal:
    if "authorization" in request.headers:
        raise AuthFailed(401, "wrong_surface")
    secure = request.app.state.settings.secure_cookies
    found = accounts_of(request).admin(request.cookies.get(admin_cookie_name(secure)))
    if found is None:
        raise AuthFailed(401, "auth_required")
    principal, csrf = found
    if request.method not in SAFE_METHODS:
        site = request.headers.get("sec-fetch-site")
        sent = request.headers.get("x-csrf-token") or ""
        if (site is not None and site not in ("same-origin", "none")) or not csrf or not tokens.same(sent, csrf):
            raise AuthFailed(403, "csrf_failed")
    if not principal.instance_admin:
        raise Denied(403, "forbidden")
    request.state.principal = principal
    request.state.csrf = csrf  # GET /api/admin/auth/me 가 돌려준다 (새로고침한 관리자 화면)
    return principal


def set_admin_cookie(response: Response, session: AdminSession, *, secure: bool) -> None:
    response.set_cookie(
        admin_cookie_name(secure), session.cookie, max_age=8 * 3600, path="/", httponly=True, samesite="strict", secure=secure
    )


def clear_admin_cookie(response: Response, *, secure: bool) -> None:
    response.delete_cookie(admin_cookie_name(secure), path="/", httponly=True, samesite="strict", secure=secure)


def auth_failed_response(e: AuthFailed) -> JSONResponse:
    headers: dict[str, str] = {}
    if e.status == 401:
        headers["WWW-Authenticate"] = "Bearer"
    if e.retry_after is not None:
        headers["Retry-After"] = str(e.retry_after)
    body: dict[str, object] = {"detail": e.code}
    if e.retry_after is not None:
        body["retry_after"] = e.retry_after
    return JSONResponse(body, status_code=e.status, headers=headers)


def limit(request: Request, bucket: str, *, limit: int, window_s: int) -> None:
    """IP 단위 상한 (공개 경로). 넘으면 429 rate_limited."""
    wait = accounts_of(request).hit(f"{bucket}:ip:{client_ip(request)}", limit=limit, window_s=window_s)
    if wait is not None:
        raise AuthFailed(429, "rate_limited", retry_after=wait)
