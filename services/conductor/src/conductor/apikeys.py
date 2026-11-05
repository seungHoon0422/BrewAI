"""API 키 (ADR-0017 · slice 12) — 사람별 키 `bwk_` · 외부 표면 /v1 만 받는다. 판단은 여기 · HTTP 는 api_keys.py · api_v1.py.

키        bwk_ + 32바이트 무작위 (auth/tokens.py 와 같은 모양) · DB 엔 sha256 만 · 화면엔 hint (앞 4 · 뒤 4) · 전체는 만들 때 한 번만.
주인      사람 한 명 (그 사람 권한 이상은 못 한다 · 계정 정지 = 그 사람 키 전부 멈춤) · 조직 = 만들 때 그 사람의 첫 조직 (사용량 묶음).
범위      models:read (모델 목록) · chat (대화 호출) · usage:read (자기 사용량 · 다음 단계) — 만들 때 고른다.
정책      관리자가 정한다 (meta api_keys.policy): enabled · max_days · default_days · limits (rpm · tokens_per_day · usd_per_month).
한도      키 한도 = 정책 기본값 위에 관리자가 키마다 덮어쓴 값 (사용자는 못 바꾼다 · null = 무제한) · 분당 요청 = 메모리 창 ·
          하루 토큰 · 월 추정 비용 = usage_events (UTC 하루 · 달) · 넘으면 429 key_limit + Retry-After.
감사      만들기 · 폐기 · 한도 바꾸기 · 정책 바꾸기 = audit_events (키 값 · 해시는 안 남긴다 · hint 만).
"""

from __future__ import annotations

import json
import secrets
import threading
import time
import uuid
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from .auth import tokens

PREFIX = "bwk_"
SCOPES = ("models:read", "chat", "usage:read")
LIMIT_KEYS = ("rpm", "tokens_per_day", "usd_per_month")
MAX_ACTIVE_PER_USER = 20
NAME_MAX = 60
POLICY_KEY = "api_keys.policy"
# 기본 정책 (관리자 콘솔에서 바꾼다): 개인 도구 · 스크립트에 넉넉하고, 새는 키 하나가 큰 비용을 못 내게
DEFAULT_POLICY: dict[str, Any] = {
    "enabled": True,
    "default_days": 90,
    "max_days": 365,
    "limits": {"rpm": 60, "tokens_per_day": 1_000_000, "usd_per_month": 20.0},
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  org_id       TEXT,
  name         TEXT NOT NULL,
  hint         TEXT NOT NULL,
  hash         TEXT NOT NULL UNIQUE,
  scopes       TEXT NOT NULL,
  limits       TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT,
  revoked_by   TEXT
);
CREATE INDEX IF NOT EXISTS api_keys_user ON api_keys (user_id, created_at);
"""


class ApiKeyError(Exception):
    """거절 = (HTTP 상태, 코드). retry_after = 한도 (초)."""

    def __init__(self, status: int, code: str, retry_after: int | None = None) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.retry_after = retry_after


@dataclass(frozen=True)
class KeyAuth:
    key_id: str
    user_id: str
    org_id: str | None
    scopes: tuple[str, ...]
    limits: dict[str, float | None]
    name: str
    hint: str


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def hint_of(raw: str) -> str:
    body = raw.removeprefix(PREFIX)
    return f"{PREFIX}{body[:4]}…{body[-4:]}"


def clean_limits(v: Any, *, allow_none: bool) -> dict[str, float | None]:
    """{rpm, tokens_per_day, usd_per_month} → 양수 (rpm · 토큰 = 정수) · None = 무제한 (allow_none 일 때만). 모르는 키 = ValueError."""
    if not isinstance(v, dict) or set(v) - set(LIMIT_KEYS):
        raise ValueError("bad_limits")
    out: dict[str, float | None] = {}
    for k, x in v.items():
        if x is None and allow_none:
            out[k] = None
            continue
        if isinstance(x, bool) or not isinstance(x, int | float) or x <= 0 or x > 1e12:
            raise ValueError("bad_limits")
        out[k] = float(x) if k == "usd_per_month" else int(x)
    return out


class Keys:
    def __init__(self, store: Any, clock: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self.store = store
        self.clock = clock
        self._lock = threading.Lock()
        self._windows: dict[str, deque[float]] = {}  # 분당 요청 (키 id → 최근 60초 시각)

    # ── 정책 ──
    def policy(self) -> dict[str, Any]:
        raw = self.store.get_meta(POLICY_KEY)
        try:
            saved = json.loads(raw) if raw else {}
        except ValueError:
            saved = {}
        p = {**DEFAULT_POLICY, **{k: v for k, v in (saved if isinstance(saved, dict) else {}).items() if k in DEFAULT_POLICY}}
        p["limits"] = {**DEFAULT_POLICY["limits"], **(p.get("limits") if isinstance(p.get("limits"), dict) else {})}
        return p

    def set_policy(self, patch: dict[str, Any]) -> dict[str, Any]:
        p = self.policy()
        if "enabled" in patch:
            if not isinstance(patch["enabled"], bool):
                raise ValueError("bad_enabled")
            p["enabled"] = patch["enabled"]
        for k in ("default_days", "max_days"):
            if k in patch:
                v = patch[k]
                if isinstance(v, bool) or not isinstance(v, int) or not 1 <= v <= 3650:
                    raise ValueError(f"bad_{k}")
                p[k] = v
        if p["default_days"] > p["max_days"]:
            raise ValueError("bad_default_days")
        if "limits" in patch:
            p["limits"] = {**p["limits"], **clean_limits(patch["limits"], allow_none=True)}
        with self.store.tx() as db:
            self.store.set_meta(db, POLICY_KEY, json.dumps(p))
        return p

    # ── 만들기 · 목록 · 폐기 ──
    def create(self, *, user_id: str, name: str, scopes: list[str], days: int | None) -> tuple[dict[str, Any], str]:
        p = self.policy()
        if not p["enabled"]:
            raise ApiKeyError(403, "api_keys_off")
        name = " ".join((name or "").split())
        if not name or len(name) > NAME_MAX:
            raise ApiKeyError(422, "bad_name")
        picked = tuple(s for s in SCOPES if s in set(scopes or []))
        if not picked or set(scopes) - set(SCOPES):
            raise ApiKeyError(422, "bad_scopes")
        days = p["default_days"] if days is None else days
        if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= p["max_days"]:
            raise ApiKeyError(422, "bad_days")
        now = self.clock()
        raw = PREFIX + secrets.token_urlsafe(32)
        row = {
            "id": str(uuid.uuid4()), "user_id": user_id, "name": name, "hint": hint_of(raw), "hash": tokens.digest(raw),
            "scopes": json.dumps(list(picked)), "created_at": _iso(now), "expires_at": _iso(now + timedelta(days=days)),
        }
        with self.store.tx() as db:
            active = db.execute(
                "SELECT COUNT(*) FROM api_keys WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?", (user_id, _iso(now))
            ).fetchone()[0]
            if active >= MAX_ACTIVE_PER_USER:
                raise ApiKeyError(409, "too_many_keys")
            org = db.execute("SELECT org_id FROM org_members WHERE user_id = ? ORDER BY joined_at LIMIT 1", (user_id,)).fetchone()
            row["org_id"] = org[0] if org else None
            db.execute(
                "INSERT INTO api_keys (id, user_id, org_id, name, hint, hash, scopes, created_at, expires_at)"
                " VALUES (:id, :user_id, :org_id, :name, :hint, :hash, :scopes, :created_at, :expires_at)", row,
            )
        return self.get(row["id"]) or {}, raw

    _SELECT = (
        "SELECT k.*, u.display_name AS user_name, u.email AS user_email, u.status AS user_status FROM api_keys k"
        " JOIN users u ON u.id = k.user_id"
    )

    def _out(self, r: Any, p: dict[str, Any], used: dict[str, dict[str, Any]]) -> dict[str, Any]:
        now = _iso(self.clock())
        own = json.loads(r["limits"] or "{}")
        status = "revoked" if r["revoked_at"] else "expired" if r["expires_at"] <= now else "active"
        return {
            "id": r["id"], "name": r["name"], "hint": r["hint"], "scopes": json.loads(r["scopes"]), "status": status,
            "created_at": r["created_at"], "expires_at": r["expires_at"], "last_used_at": r["last_used_at"], "revoked_at": r["revoked_at"],
            "limits": {**p["limits"], **own}, "custom_limits": sorted(own), "user": {"id": r["user_id"], "name": r["user_name"], "email": r["user_email"]},
            "month": used.get(r["id"], {"runs": 0, "tokens": 0, "cost_usd": None}),
        }

    def _month_usage(self, ids: list[str]) -> dict[str, dict[str, Any]]:
        if not ids:
            return {}
        start = self._month_start()
        marks = ", ".join("?" * len(ids))
        rows = self.store.query(
            f"SELECT key_id, COUNT(*) AS runs, SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS tokens, SUM(cost_usd) AS cost"
            f" FROM usage_events WHERE key_id IN ({marks}) AND started_at >= ? GROUP BY key_id", (*ids, start),
        ) if self._has_key_column() else []
        return {r["key_id"]: {"runs": r["runs"], "tokens": int(r["tokens"] or 0), "cost_usd": round(r["cost"], 6) if r["cost"] is not None else None} for r in rows}

    def _has_key_column(self) -> bool:
        return any(r[1] == "key_id" for r in self.store.query("PRAGMA table_info(usage_events)"))

    def list(self, *, user_id: str | None = None, include_revoked: bool = True) -> list[dict[str, Any]]:
        where, params = [], []
        if user_id:
            where.append("k.user_id = ?")
            params.append(user_id)
        if not include_revoked:
            where.append("k.revoked_at IS NULL")
        sql = self._SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC LIMIT 500"
        rows = self.store.query(sql, tuple(params))
        p = self.policy()
        used = self._month_usage([r["id"] for r in rows])
        return [self._out(r, p, used) for r in rows]

    def get(self, key_id: str, *, user_id: str | None = None) -> dict[str, Any] | None:
        rows = self.store.query(self._SELECT + " WHERE k.id = ?" + (" AND k.user_id = ?" if user_id else ""), (key_id, *([user_id] if user_id else [])))
        return self._out(rows[0], self.policy(), self._month_usage([key_id])) if rows else None

    def revoke(self, key_id: str, *, by: str, user_id: str | None = None) -> dict[str, Any]:
        with self.store.tx() as db:
            sql = "UPDATE api_keys SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL" + (" AND user_id = ?" if user_id else "")
            db.execute(sql, (_iso(self.clock()), by, key_id, *([user_id] if user_id else [])))
        got = self.get(key_id, user_id=user_id)
        if got is None:
            raise ApiKeyError(404, "key_not_found")
        return got

    def rename(self, key_id: str, name: str, *, user_id: str) -> dict[str, Any]:
        name = " ".join((name or "").split())
        if not name or len(name) > NAME_MAX:
            raise ApiKeyError(422, "bad_name")
        with self.store.tx() as db:
            db.execute("UPDATE api_keys SET name = ? WHERE id = ? AND user_id = ?", (name, key_id, user_id))
        got = self.get(key_id, user_id=user_id)
        if got is None:
            raise ApiKeyError(404, "key_not_found")
        return got

    def set_limits(self, key_id: str, limits: dict[str, Any] | None) -> dict[str, Any]:
        """관리자: 키마다 덮어쓰기 (None = 정책 기본값으로 되돌림 · 칸 값 null = 무제한)."""
        own = {} if limits is None else clean_limits(limits, allow_none=True)
        with self.store.tx() as db:
            db.execute("UPDATE api_keys SET limits = ? WHERE id = ?", (json.dumps(own), key_id))
        got = self.get(key_id)
        if got is None:
            raise ApiKeyError(404, "key_not_found")
        return got

    # ── 외부 요청 ──
    def verify(self, raw: str | None) -> KeyAuth:
        if not tokens.shaped(raw, PREFIX):
            raise ApiKeyError(401, "invalid_api_key")
        rows = self.store.query(self._SELECT + " WHERE k.hash = ?", (tokens.digest(raw),))  # type: ignore[arg-type]
        if not rows:
            raise ApiKeyError(401, "invalid_api_key")
        r = rows[0]
        if r["revoked_at"]:
            raise ApiKeyError(401, "key_revoked")
        now = self.clock()
        if r["expires_at"] <= _iso(now):
            raise ApiKeyError(401, "key_expired")
        if r["user_status"] != "active":
            raise ApiKeyError(401, "user_disabled")
        p = self.policy()
        if not p["enabled"]:
            raise ApiKeyError(403, "api_keys_off")
        if r["last_used_at"] is None or r["last_used_at"] < _iso(now - timedelta(seconds=60)):
            with self.store.tx() as db:
                db.execute("UPDATE api_keys SET last_used_at = ? WHERE id = ?", (_iso(now), r["id"]))
        return KeyAuth(
            key_id=r["id"], user_id=r["user_id"], org_id=r["org_id"], scopes=tuple(json.loads(r["scopes"])),
            limits={**p["limits"], **json.loads(r["limits"] or "{}")}, name=r["name"], hint=r["hint"],
        )

    def _month_start(self) -> str:
        now = self.clock().astimezone(UTC)
        return _iso(now.replace(day=1, hour=0, minute=0, second=0, microsecond=0))

    def check_limits(self, auth: KeyAuth) -> None:
        """부르기 전에: 분당 요청 (이 요청을 센다) · 오늘 토큰 · 이번 달 비용. 넘으면 ApiKeyError(429, key_limit)."""
        lim = auth.limits
        now = self.clock().astimezone(UTC)
        rpm = lim.get("rpm")
        if rpm:
            mono = time.monotonic()
            with self._lock:
                w = self._windows.setdefault(auth.key_id, deque())
                while w and mono - w[0] >= 60:
                    w.popleft()
                if len(w) >= rpm:
                    raise ApiKeyError(429, "key_limit_rpm", retry_after=max(1, int(60 - (mono - w[0])) + 1))
                w.append(mono)
        day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        if lim.get("tokens_per_day") and self._has_key_column():
            used = self.store.query(
                "SELECT COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) FROM usage_events WHERE key_id = ? AND started_at >= ?",
                (auth.key_id, _iso(day)),
            )[0][0]
            if used >= lim["tokens_per_day"]:  # type: ignore[operator]
                raise ApiKeyError(429, "key_limit_tokens", retry_after=int((day + timedelta(days=1) - now).total_seconds()) + 1)
        if lim.get("usd_per_month") and self._has_key_column():
            spent = self.store.query(
                "SELECT COALESCE(SUM(cost_usd), 0) FROM usage_events WHERE key_id = ? AND started_at >= ?", (auth.key_id, self._month_start()),
            )[0][0]
            if spent >= lim["usd_per_month"]:  # type: ignore[operator]
                nxt = (now.replace(day=28) + timedelta(days=4)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                raise ApiKeyError(429, "key_limit_cost", retry_after=int((nxt - now).total_seconds()) + 1)
