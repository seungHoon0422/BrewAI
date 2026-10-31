"""불투명 토큰 = 접두사 + 32바이트 무작위(base64url 43자). DB 엔 sha256 hex 만 (서명 키 없음 · ADR-0010).

  bwa_ access (15분)   bwr_ refresh (회전)   bwc_ 관리자 쿠키   bwh_ Google handoff (60초 · PKCE S256)
  bwp_ 재설정 코드 (30분)   bwl_ Google 연결 표 (5분)   bwm_ MCP 앱 로그인 handoff (60초 · PKCE S256)
  BREW-XXXX-XXXX 초대 코드 (사람이 옮겨 적는다)
"""

from __future__ import annotations

import base64
import hashlib
import re
import secrets

ACCESS = "bwa_"
REFRESH = "bwr_"
ADMIN = "bwc_"
HANDOFF = "bwh_"
RESET = "bwp_"
LINK = "bwl_"
MCP_HANDOFF = "bwm_"  # MCP 앱 로그인 → 데스크톱 loopback (60초 · PKCE S256 · ADR-0013)

_BODY = r"[A-Za-z0-9_-]{43}"
PKCE_RE = re.compile(r"^[A-Za-z0-9._~-]{43,128}$")  # RFC 7636 code_verifier
CHALLENGE_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")  # S256 = base64url(sha256) 43자
# 초대 코드: Crockford base32 (I · L · O · U 없음) 8자 = 40비트 + 시도 제한
_INVITE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_INVITE_FIX = str.maketrans({"O": "0", "I": "1", "L": "1"})


def new_token(prefix: str) -> str:
    return prefix + secrets.token_urlsafe(32)


def shaped(token: str | None, prefix: str) -> bool:
    """모양만 본다 (DB 를 두드리기 전에 거른다)."""
    return isinstance(token, str) and re.fullmatch(re.escape(prefix) + _BODY, token) is not None


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def s256(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode()


def same(a: str, b: str) -> bool:
    return secrets.compare_digest(a.encode(), b.encode())


def new_invite_code() -> str:
    body = "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(8))
    return f"BREW-{body[:4]}-{body[4:]}"


def normalize_invite(raw: str) -> str | None:
    """'brew xxxx xxxx' · 'BREW-XXXXXXXX' · O/0 · I/L/1 헷갈림 → 'BREW-XXXX-XXXX'. 모양이 아니면 None."""
    body = re.sub(r"[\s-]", "", raw or "").upper()
    body = body.removeprefix("BREW").translate(_INVITE_FIX)
    if len(body) != 8 or any(c not in _INVITE_ALPHABET for c in body):
        return None
    return f"BREW-{body[:4]}-{body[4:]}"
