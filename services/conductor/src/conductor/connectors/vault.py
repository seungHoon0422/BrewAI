"""인증정보 금고 = AES-256-GCM (cryptography · 직접 만든 암호 없음 · ADR-0013).

키 = `.env` CONDUCTOR_SECRET_KEY (32바이트 base64url 또는 64 hex · stack.mjs 가 만든다) + CONDUCTOR_SECRET_KEY_ID (기본 k1).
교체 = 새 키 · 새 id 로 바꾸고 옛 것은 CONDUCTOR_SECRET_KEYS_OLD=<id>:<키> 로 남긴다 → 읽을 때 key_id 로 고르고, 다시 쓸 때 새 키로 (needs_reseal).
암호문 = b"\\x01" + nonce 12바이트 + (암호문 + 태그 16바이트). nonce 는 매번 무작위 (96비트 · 키 하나로 2^32 번 아래 = 충분).
AAD = 줄의 주인 · 주소 (예: user | resource | issuer) — 다른 줄에 옮겨 붙인 암호문은 열리지 않는다. 칸마다 길이를 앞에 붙여 이어 붙인다 (경계가 섞이지 않게).
키 · 평문은 repr · 로그 · 예외 메시지에 넣지 않는다.
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
import secrets
from collections.abc import Mapping
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

VERSION = b"\x01"
NONCE = 12
KEY_ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,32}$")


class VaultError(Exception):
    """no_key · bad_key · unknown_key · bad_blob · tampered (AAD 불일치 · 다른 키 · 바뀐 암호문)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def parse_key(raw: str) -> bytes:
    """32바이트 키: 64 hex 또는 base64url(패딩 있어도 됨). 아니면 bad_key."""
    text = (raw or "").strip()
    if re.fullmatch(r"[0-9a-fA-F]{64}", text):
        return bytes.fromhex(text)
    try:
        key = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (binascii.Error, ValueError):
        raise VaultError("bad_key") from None
    if len(key) != 32:
        raise VaultError("bad_key")
    return key


def generate_key() -> str:
    """stack.mjs 와 같은 모양 (테스트 · 수동 생성용)."""
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()


def aad(*parts: str | None) -> bytes:
    """칸마다 '<길이>:<값>' 을 이어 붙인다 → ('a|b', 'c') 와 ('a', 'b|c') 가 다르다."""
    out = []
    for p in parts:
        b = (p or "").encode("utf-8")
        out.append(f"{len(b)}:".encode() + b)
    return b"|".join(out)


class Vault:
    def __init__(self, keys: Mapping[str, bytes], current: str) -> None:
        if current not in keys:
            raise VaultError("unknown_key")
        for kid, key in keys.items():
            if not KEY_ID_RE.match(kid) or len(key) != 32:
                raise VaultError("bad_key")
        self._aead = {kid: AESGCM(key) for kid, key in keys.items()}
        self.key_id = current

    def __repr__(self) -> str:  # 키는 절대 안 보인다
        return f"Vault(key_id={self.key_id!r}, keys={sorted(self._aead)})"

    @classmethod
    def from_settings(cls, settings: Any) -> Vault | None:
        """키가 없으면 None (MCP OAuth 를 못 쓴다 → 연결 화면이 이유를 보여 준다). 모양이 틀리면 VaultError(bad_key)."""
        if not getattr(settings, "secret_key", None):
            return None
        keys = {kid: parse_key(raw) for kid, raw in getattr(settings, "secret_keys_old", ())}
        keys[settings.secret_key_id] = parse_key(settings.secret_key)
        return cls(keys, settings.secret_key_id)

    @classmethod
    def ephemeral(cls, key_id: str = "test") -> Vault:
        """테스트 전용 (프로세스가 끝나면 키가 사라진다)."""
        return cls({key_id: os.urandom(32)}, key_id)

    def seal(self, plaintext: bytes, *, aad: bytes) -> tuple[bytes, str]:
        nonce = os.urandom(NONCE)
        return VERSION + nonce + self._aead[self.key_id].encrypt(nonce, plaintext, aad), self.key_id

    def open(self, blob: bytes | None, *, key_id: str, aad: bytes) -> bytes:
        if not blob or len(blob) < 1 + NONCE + 16 or blob[:1] != VERSION:
            raise VaultError("bad_blob")
        cipher = self._aead.get(key_id)
        if cipher is None:
            raise VaultError("unknown_key")
        try:
            return cipher.decrypt(blob[1 : 1 + NONCE], blob[1 + NONCE :], aad)
        except InvalidTag:
            raise VaultError("tampered") from None

    def seal_json(self, obj: Any, *, aad: bytes) -> tuple[bytes, str]:
        return self.seal(json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8"), aad=aad)

    def open_json(self, blob: bytes | None, *, key_id: str, aad: bytes) -> Any:
        return json.loads(self.open(blob, key_id=key_id, aad=aad).decode("utf-8"))

    def needs_reseal(self, key_id: str) -> bool:
        """옛 키로 잠긴 줄 = 다음에 쓸 때 새 키로 다시 잠근다."""
        return key_id != self.key_id
