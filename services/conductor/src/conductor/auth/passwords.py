"""비밀번호 = argon2id (argon2-cffi 25.1.0). 매개변수는 명시 — 라이브러리 기본값이 바뀌어도 우리 값은 그대로 (ADR-0010).

OWASP Password Storage: argon2id m=19456 KiB · t=2 · p=1. 길이 = 최소 settings.password_min(기본 15) ~ 128자 · 조합 규칙 없음.
없는 계정 · 비밀번호 없는 계정도 더미 해시를 한 번 검증한다 → 응답 시간으로 계정 유무를 알 수 없다.
"""

from __future__ import annotations

import secrets

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

MAX_LENGTH = 128
HASHER = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1, hash_len=32, salt_len=16, type=Type.ID)
_DUMMY = HASHER.hash(secrets.token_urlsafe(24))


def problem(password: str, min_length: int) -> str | None:
    """새 비밀번호 검사 → 오류 code (없으면 None). 앞뒤 공백도 글자로 센다 (자르지 않는다)."""
    if not isinstance(password, str) or len(password) < min_length:
        return "password_too_short"
    if len(password) > MAX_LENGTH:
        return "password_too_long"
    return None


def hash_password(password: str) -> str:
    return HASHER.hash(password)


def verify(stored: str | None, password: str) -> bool:
    """stored None = 계정 없음 · 비밀번호 없음 → 더미로 같은 시간을 쓰고 거짓."""
    try:
        ok = HASHER.verify(stored or _DUMMY, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    return ok and stored is not None


def needs_rehash(stored: str) -> bool:
    return HASHER.check_needs_rehash(stored)
