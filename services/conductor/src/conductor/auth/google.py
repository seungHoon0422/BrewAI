"""Google 로그인 = OIDC authorization code + PKCE, 서버가 교환 (ADR-0010). HTTP = 이미 있는 httpx2.

id_token 서명 검증은 하지 않는다: conductor 가 token endpoint 에서 TLS 로 직접 받은 id_token 이라 OIDC Core §3.1.3.7 이 허용.
대신 claim 은 다 본다 — iss · aud(+azp) · exp · iat · nonce · sub. email_verified · hd 는 사람 결정(api_auth.resolve_google)에서.
엔드포인트 = `{issuer}/.well-known/openid-configuration` (1시간 캐시). issuer · 엔드포인트는 https 만
(E2E mock = BREWAI_E2E=1 + public_url loopback 일 때만 http · settings.google_enabled).
Google 토큰(access · id · refresh)은 저장하지 않고 데스크톱에도 보내지 않는다.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from typing import Any
from urllib.parse import urlencode, urlsplit

import httpx2

from ..settings import Settings
from . import tokens

log = logging.getLogger("conductor.auth.google")

SCOPE = "openid email profile"
DISCOVERY_TTL_S = 3600
SKEW_S = 300  # 시계 어긋남 허용 (iat 이 미래 · exp 직후)
_GOOGLE = "https://accounts.google.com"


class OIDCError(Exception):
    """code = 화면이 받는 오류 이름 (google_failed · invalid_id_token). reason = 로그에만."""

    def __init__(self, code: str, reason: str) -> None:
        super().__init__(f"{code}: {reason}")
        self.code = code
        self.reason = reason


def _b64json(part: str) -> dict[str, Any]:
    data = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    if not isinstance(data, dict):
        raise ValueError("not an object")
    return data


def decode_id_token(id_token: str) -> dict[str, Any]:
    """JWS compact 의 payload 만 (서명은 위 머리말대로 안 본다)."""
    parts = id_token.split(".") if isinstance(id_token, str) else []
    if len(parts) != 3:
        raise OIDCError("invalid_id_token", "not a JWS")
    try:
        _b64json(parts[0])
        return _b64json(parts[1])
    except (ValueError, UnicodeDecodeError) as e:
        raise OIDCError("invalid_id_token", "undecodable") from e


def check_claims(claims: dict[str, Any], *, issuer: str, client_id: str, nonce: str, now: float | None = None) -> dict[str, Any]:
    """OIDC Core §3.1.3.7 + §3.1.2.1 nonce. 통과하면 claims 그대로, 아니면 OIDCError(invalid_id_token)."""
    now = time.time() if now is None else now
    accepted = {issuer, "accounts.google.com"} if issuer == _GOOGLE else {issuer}  # Google 은 scheme 없는 iss 도 준다
    if claims.get("iss") not in accepted:
        raise OIDCError("invalid_id_token", "iss")
    aud = claims.get("aud")
    auds = aud if isinstance(aud, list) else [aud]
    if client_id not in auds:
        raise OIDCError("invalid_id_token", "aud")
    if len(auds) > 1 and claims.get("azp") != client_id:
        raise OIDCError("invalid_id_token", "azp")
    exp, iat = claims.get("exp"), claims.get("iat")
    if not isinstance(exp, (int, float)) or isinstance(exp, bool) or exp + SKEW_S < now:
        raise OIDCError("invalid_id_token", "exp")
    if not isinstance(iat, (int, float)) or isinstance(iat, bool) or iat > now + SKEW_S:
        raise OIDCError("invalid_id_token", "iat")
    got = claims.get("nonce")
    if not isinstance(got, str) or not tokens.same(got, nonce):
        raise OIDCError("invalid_id_token", "nonce")
    sub = claims.get("sub")
    if not isinstance(sub, str) or not 0 < len(sub) <= 255:
        raise OIDCError("invalid_id_token", "sub")
    return claims


def email_verified(claims: dict[str, Any]) -> bool:
    v = claims.get("email_verified")
    return v is True or v == "true"


class GoogleOIDC:
    def __init__(self, settings: Settings, *, client: httpx2.AsyncClient | None = None) -> None:
        self.settings = settings
        self.issuer = settings.google_issuer
        self._client = client or httpx2.AsyncClient(timeout=httpx2.Timeout(10.0))
        self._discovery: tuple[float, dict[str, Any]] | None = None

    @property
    def enabled(self) -> bool:
        return self.settings.google_enabled

    def _allowed(self, url: Any) -> bool:
        if not isinstance(url, str):
            return False
        scheme = urlsplit(url).scheme
        return scheme == "https" or (scheme == "http" and urlsplit(self.issuer).scheme == "http" and self.enabled)

    async def discovery(self) -> dict[str, Any]:
        now = time.monotonic()
        if self._discovery and now - self._discovery[0] < DISCOVERY_TTL_S:
            return self._discovery[1]
        try:
            res = await self._client.get(f"{self.issuer}/.well-known/openid-configuration")
            doc = res.json() if res.status_code == 200 else None
        except (httpx2.HTTPError, ValueError) as e:
            raise OIDCError("google_failed", f"discovery: {type(e).__name__}") from e
        if not isinstance(doc, dict) or doc.get("issuer") != self.issuer:
            raise OIDCError("google_failed", "discovery: issuer mismatch")
        if not (self._allowed(doc.get("authorization_endpoint")) and self._allowed(doc.get("token_endpoint"))):
            raise OIDCError("google_failed", "discovery: endpoint scheme")
        self._discovery = (now, doc)
        return doc

    async def authorize_url(self, *, redirect_uri: str, state: str, nonce: str, verifier: str) -> str:
        doc = await self.discovery()
        query = urlencode({
            "response_type": "code", "client_id": self.settings.google_client_id, "redirect_uri": redirect_uri, "scope": SCOPE,
            "state": state, "nonce": nonce, "code_challenge": tokens.s256(verifier), "code_challenge_method": "S256",
            "prompt": "select_account",
        })
        return f"{doc['authorization_endpoint']}?{query}"

    async def exchange(self, *, code: str, redirect_uri: str, verifier: str, nonce: str) -> dict[str, Any]:
        """code → id_token claims (검사 끝난 것). 응답 본문 · 토큰은 로그에 안 남긴다."""
        doc = await self.discovery()
        try:
            res = await self._client.post(
                doc["token_endpoint"],
                data={
                    "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri, "code_verifier": verifier,
                    "client_id": self.settings.google_client_id, "client_secret": self.settings.google_client_secret,
                },
                headers={"accept": "application/json"},
            )
            body = res.json() if res.status_code == 200 else None
        except (httpx2.HTTPError, ValueError) as e:
            raise OIDCError("google_failed", f"token: {type(e).__name__}") from e
        if not isinstance(body, dict) or not isinstance(body.get("id_token"), str):
            raise OIDCError("google_failed", f"token: HTTP {res.status_code}")
        claims = decode_id_token(body["id_token"])
        return check_claims(claims, issuer=self.issuer, client_id=self.settings.google_client_id or "", nonce=nonce)

    async def aclose(self) -> None:
        await self._client.aclose()
