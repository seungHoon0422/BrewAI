"""계정 · 로그인 수단 · 세션 · 1회용 토큰 · 시도 제한 · 감사 기록 (ADR-0010). 표는 store.py v2.

세션 = 로그인 한 번 (= refresh family). 역할은 토큰에 넣지 않고 요청마다 DB 에서 읽는다.
  desktop  access bwa_ 15분 · refresh bwr_ 쓸 때마다 회전 · idle 30일 / 최대 90일 · 이미 쓴 refresh 가 다시 오면 세션 통째 폐기
  admin    쿠키 bwc_ · idle 30분(요청마다 연장) / 최대 8시간 · CSRF 토큰은 세션에 (쿠키 없이는 쓸모없다)
시도 제한 = login_attempts 표: 계정 키는 연속 실패 5번부터 2^n 초 잠금(최대 15분 · 하루 창) · 로그인 IP 키는 50번 · 15분 창 · 그 밖 IP 키는 창 안 횟수 상한.
시각은 self.clock (테스트가 시간을 돌린다).
"""

from __future__ import annotations

import json
import re
import sqlite3
import unicodedata
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from ..store import Store
from . import passwords, tokens
from .policy import Actor

DESKTOP_ACCESS_S = 15 * 60
DESKTOP_IDLE_S = 30 * 86400
DESKTOP_ABS_S = 90 * 86400
ADMIN_IDLE_S = 30 * 60
ADMIN_ABS_S = 8 * 3600
HANDOFF_S = 60
RESET_S = 30 * 60
LINK_S = 5 * 60
OAUTH_FLOW_S = 10 * 60
LOCK_FREE_FAILURES = 5  # 이만큼은 바로 다시 시도 가능
LOCK_MAX_S = 15 * 60
DISPLAY_NAME_MAX = 40
_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$")

Client = Literal["desktop", "admin"]
OneTimeKind = Literal["handoff", "reset", "oauth_flow", "link"]


class AuthFailed(Exception):
    """인증 단계 실패 → {detail: code} (+ Retry-After). 메시지에 계정 유무 · 토큰을 넣지 않는다."""

    def __init__(self, status: int, code: str, *, retry_after: int | None = None) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.retry_after = retry_after


@dataclass(frozen=True)
class Principal:
    user_id: str
    email: str
    display_name: str
    instance_admin: bool
    session_id: str
    client: Client

    @property
    def actor(self) -> Actor:
        return Actor(self.user_id, self.instance_admin)


@dataclass(frozen=True)
class Tokens:
    access_token: str
    refresh_token: str
    expires_in: int
    session_id: str
    user_id: str


@dataclass(frozen=True)
class AdminSession:
    cookie: str
    csrf_token: str
    expires_at: str
    user_id: str


def normalize_email(raw: str | None) -> str | None:
    email = (raw or "").strip()
    if len(email) > 254 or not _EMAIL.match(email):
        return None
    return email.lower()


def clean_display_name(raw: str | None) -> str | None:
    """닉네임: 앞뒤 공백 자르고 · 공백 묶고 · 제어 문자 없이 1~40자. 중복 허용."""
    name = " ".join((raw or "").split())
    if not name or len(name) > DISPLAY_NAME_MAX or any(unicodedata.category(c).startswith("C") for c in name):
        return None
    return name


def default_display_name(email: str, name: str | None = None) -> str:
    """기본 닉네임 = Google 이름 · 없으면 이메일 @ 앞."""
    return clean_display_name(name) or clean_display_name(email.split("@", 1)[0][:DISPLAY_NAME_MAX]) or "사용자"


class Accounts:
    def __init__(self, store: Store, *, password_min: int) -> None:
        self.store = store
        self.password_min = password_min
        self.clock: Callable[[], datetime] = lambda: datetime.now(UTC)

    # ── 시각 ──
    def now(self) -> str:
        return self.at(0)

    def at(self, seconds: float) -> str:
        return (self.clock() + timedelta(seconds=seconds)).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def seconds_until(self, iso: str) -> int:
        then = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return max(1, int((then - self.clock()).total_seconds() + 0.999))

    # ── 사용자 · 로그인 수단 ──
    def user(self, user_id: str) -> sqlite3.Row | None:
        rows = self.store.query("SELECT * FROM users WHERE id = ?", (user_id,))
        return rows[0] if rows else None

    def user_by_email(self, email_norm: str) -> sqlite3.Row | None:
        rows = self.store.query("SELECT * FROM users WHERE email_norm = ?", (email_norm,))
        return rows[0] if rows else None

    def count_users(self) -> int:
        return self.store.query("SELECT COUNT(*) AS n FROM users")[0]["n"]

    def anyone_logged_in(self) -> bool:
        return bool(self.store.query("SELECT 1 FROM users WHERE last_login_at IS NOT NULL LIMIT 1"))

    def create_user(
        self, db: sqlite3.Connection, *, email: str, display_name: str, instance_role: str = "user", password_hash: str | None = None,
        email_verified: bool = False,
    ) -> str:
        """트랜잭션 안에서 (조직 · 내 스페이스와 같이 만든다 = auth/directory.py).
        email_verified = 이메일 주인이 확인된 계정 (첫 관리자 · Google · 이메일을 정한 초대). 아니면 Google 이 나중에 가져갈 수 있다."""
        user_id = str(uuid.uuid4())
        now = self.now()
        db.execute(
            "INSERT INTO users (id, email, email_norm, display_name, instance_role, created_at, email_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, email.strip(), email.strip().lower(), display_name, instance_role, now, now if email_verified else None),
        )
        if password_hash is not None:
            self.set_password(db, user_id, password_hash)
        return user_id

    def set_password(self, db: sqlite3.Connection, user_id: str, password_hash: str) -> None:
        db.execute(
            "INSERT INTO identities (user_id, provider, issuer, subject, password_hash, created_at) VALUES (?, 'password', 'password', ?, ?, ?)"
            " ON CONFLICT (issuer, subject) DO UPDATE SET password_hash = excluded.password_hash",
            (user_id, user_id, password_hash, self.now()),
        )

    def password_hash(self, user_id: str) -> str | None:
        rows = self.store.query("SELECT password_hash FROM identities WHERE user_id = ? AND provider = 'password'", (user_id,))
        return rows[0]["password_hash"] if rows else None

    def identities(self, user_id: str) -> list[sqlite3.Row]:
        return self.store.query("SELECT * FROM identities WHERE user_id = ? ORDER BY id", (user_id,))

    def google_identity(self, issuer: str, subject: str) -> sqlite3.Row | None:
        rows = self.store.query("SELECT * FROM identities WHERE issuer = ? AND subject = ?", (issuer, subject))
        return rows[0] if rows else None

    def link_google(self, db: sqlite3.Connection, user_id: str, *, issuer: str, subject: str, email: str | None, hd: str | None) -> None:
        at = self.now()
        db.execute(
            "INSERT INTO identities (user_id, provider, issuer, subject, email, hd, created_at, last_used_at) VALUES (?, 'google', ?, ?, ?, ?, ?, ?)",
            (user_id, issuer, subject, email, hd, at, at),
        )

    def claim_by_google(self, db: sqlite3.Connection, user_id: str) -> bool:
        """같은 이메일 Google 로그인 = 이메일 주인 확인. 아무도 확인하지 않은 계정(열린 초대 + 비밀번호)이었으면
        그 비밀번호 · 세션을 끊는다 (먼저 가입해 둔 사람이 계속 들어오지 못하게 · 계정 선점). True = 끊었다."""
        row = db.execute("SELECT email_verified_at FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None or row["email_verified_at"] is not None:
            return False
        db.execute("UPDATE users SET email_verified_at = ? WHERE id = ?", (self.now(), user_id))
        db.execute("DELETE FROM identities WHERE user_id = ? AND provider = 'password'", (user_id,))
        self.revoke_user(user_id, "google_claim", db=db)
        return True

    def touch_identity(self, identity_id: int, *, email: str | None = None, hd: str | None = None) -> None:
        with self.store.tx() as db:
            db.execute(
                "UPDATE identities SET last_used_at = ?, email = COALESCE(?, email), hd = COALESCE(?, hd) WHERE id = ?",
                (self.now(), email, hd, identity_id),
            )

    def unlink_google(self, user_id: str) -> bool:
        with self.store.tx() as db:
            return db.execute("DELETE FROM identities WHERE user_id = ? AND provider = 'google'", (user_id,)).rowcount > 0

    def check_password(self, email: str, password: str) -> sqlite3.Row | None:
        """맞으면 활성 사용자 줄 · 아니면 None (없는 계정 · 비활성 · 비밀번호 없음 · 틀림 = 모두 같은 시간 · 같은 결과)."""
        email_norm = normalize_email(email)
        user = self.user_by_email(email_norm) if email_norm else None
        stored = self.password_hash(user["id"]) if user is not None and user["status"] == "active" else None
        if not passwords.verify(stored, password):
            return None
        assert user is not None and stored is not None
        if passwords.needs_rehash(stored):
            with self.store.tx() as db:
                self.set_password(db, user["id"], passwords.hash_password(password))
        return user

    # ── 세션 ──
    def _insert_session(self, db: sqlite3.Connection, user_id: str, client: Client, *, ip: str | None, user_agent: str | None) -> str:
        session_id = str(uuid.uuid4())
        idle, absolute = (DESKTOP_IDLE_S, DESKTOP_ABS_S) if client == "desktop" else (ADMIN_IDLE_S, ADMIN_ABS_S)
        now = self.now()
        db.execute(
            "INSERT INTO sessions (id, user_id, client, created_at, last_used_at, idle_expires_at, abs_expires_at, ip, user_agent)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (session_id, user_id, client, now, now, self.at(idle), self.at(absolute), ip, (user_agent or "")[:200] or None),
        )
        db.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now, user_id))
        return session_id

    def _issue_pair(self, db: sqlite3.Connection, session_id: str, user_id: str) -> Tokens:
        access, refresh = tokens.new_token(tokens.ACCESS), tokens.new_token(tokens.REFRESH)
        db.execute(
            "UPDATE sessions SET access_hash = ?, access_expires_at = ? WHERE id = ?",
            (tokens.digest(access), self.at(DESKTOP_ACCESS_S), session_id),
        )
        db.execute("INSERT INTO refresh_tokens (hash, session_id, created_at) VALUES (?, ?, ?)", (tokens.digest(refresh), session_id, self.now()))
        return Tokens(access_token=access, refresh_token=refresh, expires_in=DESKTOP_ACCESS_S, session_id=session_id, user_id=user_id)

    def start_desktop(self, user_id: str, *, ip: str | None = None, user_agent: str | None = None) -> Tokens:
        with self.store.tx() as db:
            session_id = self._insert_session(db, user_id, "desktop", ip=ip, user_agent=user_agent)
            return self._issue_pair(db, session_id, user_id)

    def start_admin(self, user_id: str, *, ip: str | None = None, user_agent: str | None = None) -> AdminSession:
        cookie, csrf = tokens.new_token(tokens.ADMIN), tokens.new_token("")
        with self.store.tx() as db:
            session_id = self._insert_session(db, user_id, "admin", ip=ip, user_agent=user_agent)
            db.execute("UPDATE sessions SET access_hash = ?, csrf_token = ? WHERE id = ?", (tokens.digest(cookie), csrf, session_id))
            expires = db.execute("SELECT abs_expires_at FROM sessions WHERE id = ?", (session_id,)).fetchone()[0]
        return AdminSession(cookie=cookie, csrf_token=csrf, expires_at=expires, user_id=user_id)

    def refresh(self, refresh_token: str) -> Tokens:
        """refresh 회전. 이미 쓴 값 = 도난 신호 → 그 세션(family) 통째 폐기 (RFC 9700 §2.2.2)."""
        if not tokens.shaped(refresh_token, tokens.REFRESH):
            raise AuthFailed(401, "invalid_grant")
        now = self.now()
        reused: str | None = None
        with self.store.tx() as db:
            row = db.execute(
                "SELECT r.used_at, s.* FROM refresh_tokens r JOIN sessions s ON s.id = r.session_id WHERE r.hash = ?",
                (tokens.digest(refresh_token),),
            ).fetchone()
            if row is None:
                raise AuthFailed(401, "invalid_grant")
            if row["used_at"] is not None:
                if row["revoked_at"] is None:
                    self._revoke(db, row["id"], "refresh_reuse")
                    reused = row["id"]
            elif row["revoked_at"] is None and row["idle_expires_at"] > now and row["abs_expires_at"] > now and self._active(db, row["user_id"]):
                db.execute("UPDATE refresh_tokens SET used_at = ? WHERE hash = ?", (now, tokens.digest(refresh_token)))
                idle = min(self.at(DESKTOP_IDLE_S), row["abs_expires_at"])
                db.execute("UPDATE sessions SET last_used_at = ?, idle_expires_at = ? WHERE id = ?", (now, idle, row["id"]))
                return self._issue_pair(db, row["id"], row["user_id"])
        if reused:
            self.audit("refresh_reuse", actor=row["user_id"], target_type="session", target_id=reused, result="denied")
        raise AuthFailed(401, "invalid_grant")

    @staticmethod
    def _active(db: sqlite3.Connection, user_id: str) -> bool:
        row = db.execute("SELECT status FROM users WHERE id = ?", (user_id,)).fetchone()
        return row is not None and row["status"] == "active"

    def _principal(self, row: sqlite3.Row) -> Principal:
        return Principal(
            user_id=row["user_id"], email=row["email"], display_name=row["display_name"], instance_admin=row["instance_role"] == "admin",
            session_id=row["id"], client=row["client"],
        )

    _SESSION_USER = (
        "SELECT s.*, u.email, u.display_name, u.instance_role, u.status FROM sessions s JOIN users u ON u.id = s.user_id"
        " WHERE s.access_hash = ? AND s.client = ? AND s.revoked_at IS NULL AND u.status = 'active'"
    )

    def access(self, token: str | None) -> Principal | None:
        """Bearer access → 사람. 만료 · 폐기 · 비활성 · 모양 틀림 = None."""
        if not tokens.shaped(token, tokens.ACCESS):
            return None
        now = self.now()
        rows = self.store.query(self._SESSION_USER, (tokens.digest(token), "desktop"))  # type: ignore[arg-type]
        if not rows or rows[0]["access_expires_at"] <= now or rows[0]["abs_expires_at"] <= now:
            return None
        return self._principal(rows[0])

    def admin(self, cookie: str | None) -> tuple[Principal, str] | None:
        """관리자 쿠키 → (사람, CSRF 토큰). 요청마다 idle 30분 연장 (최대 8시간)."""
        if not tokens.shaped(cookie, tokens.ADMIN):
            return None
        now = self.now()
        with self.store.tx() as db:
            row = db.execute(self._SESSION_USER, (tokens.digest(cookie), "admin")).fetchone()  # type: ignore[arg-type]
            if row is None or row["idle_expires_at"] <= now or row["abs_expires_at"] <= now:
                return None
            db.execute(
                "UPDATE sessions SET last_used_at = ?, idle_expires_at = ? WHERE id = ?",
                (now, min(self.at(ADMIN_IDLE_S), row["abs_expires_at"]), row["id"]),
            )
        return self._principal(row), row["csrf_token"]

    def admin_expires_at(self, session_id: str) -> str:
        return self.store.query("SELECT abs_expires_at FROM sessions WHERE id = ?", (session_id,))[0]["abs_expires_at"]

    def _revoke(self, db: sqlite3.Connection, session_id: str, reason: str) -> None:
        db.execute(
            "UPDATE sessions SET revoked_at = ?, revoke_reason = ?, access_hash = NULL WHERE id = ? AND revoked_at IS NULL",
            (self.now(), reason, session_id),
        )

    def revoke(self, session_id: str, reason: str) -> None:
        with self.store.tx() as db:
            self._revoke(db, session_id, reason)

    def revoke_user(self, user_id: str, reason: str, *, keep: str | None = None, db: sqlite3.Connection | None = None) -> int:
        """그 사람의 세션 전부 (keep = 남길 세션 하나 · 비밀번호 변경 때 지금 기기)."""
        sql = "UPDATE sessions SET revoked_at = ?, revoke_reason = ?, access_hash = NULL WHERE user_id = ? AND revoked_at IS NULL AND id IS NOT ?"
        params = (self.now(), reason, user_id, keep)
        if db is not None:
            return db.execute(sql, params).rowcount
        with self.store.tx() as tx:
            return tx.execute(sql, params).rowcount

    def live_sessions(self, user_id: str) -> int:
        now = self.now()
        return self.store.query(
            "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND idle_expires_at > ? AND abs_expires_at > ?",
            (user_id, now, now),
        )[0]["n"]

    # ── 1회용 토큰 (handoff · reset · oauth_flow · link) ──
    def issue_once(self, kind: OneTimeKind, ttl_s: int, *, prefix: str, user_id: str | None = None, data: dict[str, Any] | None = None) -> str:
        token = tokens.new_token(prefix)
        with self.store.tx() as db:
            db.execute("DELETE FROM one_time_tokens WHERE expires_at < ?", (self.at(-86400),))  # 하루 지난 것 청소
            db.execute(
                "INSERT INTO one_time_tokens (hash, kind, user_id, data, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
                (tokens.digest(token), kind, user_id, json.dumps(data or {}), self.now(), self.at(ttl_s)),
            )
        return token

    def consume_once(self, kind: OneTimeKind, token: str | None) -> tuple[str | None, dict[str, Any]] | None:
        """한 번만 (확인과 사용 표시를 한 트랜잭션에서). (user_id, data) · 없음 · 만료 · 이미 씀 = None."""
        if not token or len(token) > 200:
            return None
        with self.store.tx() as db:
            row = db.execute(
                "SELECT * FROM one_time_tokens WHERE hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?",
                (tokens.digest(token), kind, self.now()),
            ).fetchone()
            if row is None:
                return None
            db.execute("UPDATE one_time_tokens SET used_at = ? WHERE hash = ?", (self.now(), row["hash"]))
        return row["user_id"], json.loads(row["data"])

    # ── 시도 제한 ──
    def retry_after(self, key: str) -> int | None:
        rows = self.store.query("SELECT locked_until FROM login_attempts WHERE key = ?", (key,))
        until = rows[0]["locked_until"] if rows else None
        return self.seconds_until(until) if until and until > self.now() else None

    def failed(self, key: str, *, free: int = LOCK_FREE_FAILURES, window_s: int = 86400) -> None:
        """연속 실패 free 번까지는 그대로 · 그 뒤 2, 4, 8 … 초 잠금 (최대 15분). 첫 실패부터 window_s 가 지나면 처음부터.
        계정 키 = 5번 · 하루 · IP 키 = 50번 · 15분 (회사 NAT 뒤 여러 사람의 오타가 하루 내내 쌓이지 않게)."""
        with self.store.tx() as db:
            row = db.execute("SELECT count, window_start FROM login_attempts WHERE key = ?", (key,)).fetchone()
            count = 1 if row is None or row["window_start"] < self.at(-window_s) else row["count"] + 1
            start = self.now() if count == 1 else row["window_start"]  # type: ignore[index]
            lock = self.at(min(2 ** min(count - free, 20), LOCK_MAX_S)) if count > free else None
            db.execute(
                "INSERT INTO login_attempts (key, count, window_start, locked_until) VALUES (?, ?, ?, ?)"
                " ON CONFLICT (key) DO UPDATE SET count = excluded.count, window_start = excluded.window_start, locked_until = excluded.locked_until",
                (key, count, start, lock),
            )

    def cleared(self, key: str) -> None:
        with self.store.tx() as db:
            db.execute("DELETE FROM login_attempts WHERE key = ?", (key,))

    def hit(self, key: str, *, limit: int, window_s: int) -> int | None:
        """창(window_s) 안 limit 번까지. 넘으면 창이 끝날 때까지 기다릴 초 (실패 · 성공 모두 센다)."""
        with self.store.tx() as db:
            row = db.execute("SELECT count, window_start FROM login_attempts WHERE key = ?", (key,)).fetchone()
            if row is None or row["window_start"] <= self.at(-window_s):
                db.execute(
                    "INSERT INTO login_attempts (key, count, window_start) VALUES (?, 1, ?)"
                    " ON CONFLICT (key) DO UPDATE SET count = 1, window_start = excluded.window_start, locked_until = NULL",
                    (key, self.now()),
                )
                return None
            if row["count"] >= limit:
                ends = (datetime.fromisoformat(row["window_start"].replace("Z", "+00:00")) + timedelta(seconds=window_s))
                return max(1, int((ends - self.clock()).total_seconds() + 0.999))
            db.execute("UPDATE login_attempts SET count = count + 1 WHERE key = ?", (key,))
            return None

    # ── 감사 기록 (append-only) ──
    def audit(
        self, action: str, *, actor: str | None, target_type: str | None = None, target_id: str | None = None,
        result: Literal["ok", "denied", "error"] = "ok", ip: str | None = None, detail: dict[str, Any] | None = None,
        db: sqlite3.Connection | None = None,
    ) -> None:
        sql = "INSERT INTO audit_events (at, actor_user_id, action, target_type, target_id, result, ip, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        params = (self.now(), actor, action, target_type, target_id, result, ip, json.dumps(detail, ensure_ascii=False) if detail else None)
        if db is not None:
            db.execute(sql, params)
            return
        with self.store.tx() as tx:
            tx.execute(sql, params)
