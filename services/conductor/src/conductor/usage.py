"""사용량 = 실행 한 번마다 한 줄 (usage_events). 관리자 개요 · 사용량 메뉴 · 사용자/조직/스페이스 서랍이 읽는다.

왜 runs 칸이 아니라 따로 표인가 (store v3):
  ① 대화를 지우면 runs 가 같이 지워진다 (ON DELETE CASCADE) → 사용량 · 비용 기록은 남아야 한다.
  ② 관리자 집계는 이 표만 읽는다 → 질문 · 답 · 제목(runs.prompt · messages)이 집계 SQL 에 아예 없다 (대화 내용 0).
  ③ 하루 묶음(usage_daily)은 만들지 않는다: 지금 규모(실행 수천~수만)는 started_at 색인 + GROUP BY 로 충분하고,
     묶음 표는 늦게 닫히는 실행 · 가격 갱신과 어긋날 수 있다. 느려지면 그때 이 표에서 만든다.
한 줄 = 누가(user · org · space) · 무엇으로(model · provider · 그때 이름) · 토큰(입력 · 출력 · 생각) · 모델 요청 수 · 도구 호출 수
  · 추정 비용(토큰 × 그때 model_exposure 게이트웨이 가격 · 가격을 모르면 NULL) · 걸린 시간 · 상태(ok | error | cancelled) · 시작 시각.
실패 · 취소한 실행은 토큰을 모른다 (게이트웨이가 끝까지 안 줬다) → NULL. 도구 호출 수는 단계(tool:* · skill:*)로 센다.
시간대: 하루 경계 = 요청의 tz(분, 브라우저 기준 · 기본 0 = UTC). 저장은 언제나 UTC ISO.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

Group = Literal["day", "org", "user", "space", "model"]
GROUPS: tuple[Group, ...] = ("day", "org", "user", "space", "model")
PERSONAL = "personal"  # 스페이스 묶음: 내 스페이스(개인)는 사람마다 나누지 않고 한 줄 (내용은 본인만 · ADR-0011)
MAX_DAYS = 366
_STATUS = {"done": "ok", "error": "error", "cancelled": "cancelled"}

COLUMNS = (
    "run_id", "started_at", "finished_at", "status", "error_code", "user_id", "org_id", "space_id", "model", "model_label",
    "provider", "input_tokens", "output_tokens", "reasoning_tokens", "requests", "tool_calls", "cost_usd", "duration_ms",
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS usage_events (
  run_id           TEXT PRIMARY KEY,
  started_at       TEXT NOT NULL,
  finished_at      TEXT,
  status           TEXT NOT NULL CHECK (status IN ('ok', 'error', 'cancelled')),
  error_code       TEXT,
  user_id          TEXT,
  org_id           TEXT,
  space_id         TEXT,
  model            TEXT NOT NULL,
  model_label      TEXT NOT NULL,
  provider         TEXT NOT NULL,
  input_tokens     INTEGER,
  output_tokens    INTEGER,
  reasoning_tokens INTEGER,
  requests         INTEGER,
  tool_calls       INTEGER NOT NULL DEFAULT 0,
  cost_usd         REAL,
  duration_ms      INTEGER
);
CREATE INDEX IF NOT EXISTS usage_at ON usage_events (started_at);
CREATE INDEX IF NOT EXISTS usage_org ON usage_events (org_id, started_at);
CREATE INDEX IF NOT EXISTS usage_space ON usage_events (space_id, started_at);
CREATE INDEX IF NOT EXISTS usage_user ON usage_events (user_id, started_at);
CREATE INDEX IF NOT EXISTS usage_model ON usage_events (model, started_at);
"""


# ── 기록 (store.finish_run · 옛 DB 채우기 · 꺼진 뒤 닫은 실행) ──


def _int(v: Any) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else None


def _price(info: Mapping[str, Any], key: str) -> float | None:
    v = info.get(key)
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0 else None


def estimate_cost(info: Mapping[str, Any], input_tokens: int | None, output_tokens: int | None) -> float | None:
    """토큰 × 게이트웨이 가격 (USD). 토큰이나 가격 하나라도 모르면 None (0 으로 속이지 않는다).
    생각 토큰은 출력 토큰 안에 들어 있다 (OpenAI 형식 completion_tokens) → 따로 더하지 않는다.
    위 한도(상한) 추정: 캐시에서 읽은 입력 토큰도 정가(input_cost_per_token)로 센다 — 캐시 토큰 수를 아직 기록하지 않는다."""
    pin, pout = _price(info, "input_cost_per_token"), _price(info, "output_cost_per_token")
    if input_tokens is None or output_tokens is None or pin is None or pout is None:
        return None
    return round(input_tokens * pin + output_tokens * pout, 10)


def tool_calls_of(steps: Iterable[Any]) -> int:
    return sum(1 for s in steps if isinstance(s, dict) and str(s.get("name", "")).startswith(("tool:", "skill:")))


def usage_event(run: Mapping[str, Any], gateway_info: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """runs 한 줄 → usage_events 한 줄 (아직 실행 중이면 None). 질문 · 답 · 단계 이름은 옮기지 않는다 (숫자만)."""
    status = _STATUS.get(run["status"])
    if status is None:
        return None
    try:
        usage = json.loads(run["usage"]) if run["usage"] else None
    except ValueError:
        usage = None
    usage = usage if isinstance(usage, dict) else {}
    try:
        steps = json.loads(run["steps"] or "[]")
    except ValueError:
        steps = []
    steps = steps if isinstance(steps, list) else []
    tin, tout = _int(usage.get("input_tokens")), _int(usage.get("output_tokens"))
    calls = _int(usage.get("tool_calls"))
    return {
        "run_id": run["id"], "started_at": run["started_at"], "finished_at": run["finished_at"], "status": status,
        "error_code": run["error_code"], "user_id": run["user_id"], "org_id": run["org_id"], "space_id": run["space_id"],
        "model": run["model"], "model_label": run["model_label"], "provider": run["provider"],
        "input_tokens": tin, "output_tokens": tout, "reasoning_tokens": _int(usage.get("reasoning_tokens")),
        "requests": _int(usage.get("requests")), "tool_calls": calls if calls is not None else tool_calls_of(steps),
        "cost_usd": estimate_cost(gateway_info or {}, tin, tout), "duration_ms": _int(run["duration_ms"]),
    }


def record(db: sqlite3.Connection, run_id: str) -> bool:
    """닫힌 실행 하나를 사용량에 (이미 있으면 그대로 = 한 번만). 가격 = 지금 model_exposure 스냅샷."""
    run = db.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    if run is None:
        return False
    price = db.execute("SELECT gateway_info FROM model_exposure WHERE gateway_id = ?", (run["model"],)).fetchone()
    try:
        info = json.loads(price["gateway_info"] or "{}") if price else {}
    except ValueError:
        info = {}
    ev = usage_event(run, info if isinstance(info, dict) else {})
    if ev is None:
        return False
    cur = db.execute(
        f"INSERT OR IGNORE INTO usage_events ({', '.join(COLUMNS)}) VALUES ({', '.join('?' * len(COLUMNS))})",
        tuple(ev[c] for c in COLUMNS),
    )
    return cur.rowcount > 0


def backfill(db: sqlite3.Connection) -> int:
    """v2 → v3: 이미 닫힌 옛 실행을 한 번 채운다."""
    ids = [r[0] for r in db.execute(
        "SELECT r.id FROM runs r WHERE r.status != 'running' AND NOT EXISTS (SELECT 1 FROM usage_events u WHERE u.run_id = r.id) ORDER BY r.seq"
    )]
    return sum(record(db, i) for i in ids)


# ── 기간 ──


@dataclass(frozen=True)
class Window:
    start: date  # 그 시간대의 날짜 (포함)
    end: date  # 포함
    tz: int  # 분 (UTC 에서 더할 값 · 한국 = 540)

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def _utc(self, d: date) -> str:
        at = datetime(d.year, d.month, d.day, tzinfo=UTC) - timedelta(minutes=self.tz)
        return at.isoformat(timespec="milliseconds").replace("+00:00", "Z")

    @property
    def bounds(self) -> tuple[str, str]:
        """[시작, 끝) UTC ISO (started_at 과 같은 모양 → 글자 비교 = 시각 비교)."""
        return self._utc(self.start), self._utc(self.end + timedelta(days=1))

    @property
    def previous(self) -> Window:
        return Window(self.start - timedelta(days=self.days), self.start - timedelta(days=1), self.tz)

    def dates(self) -> list[str]:
        return [(self.start + timedelta(days=i)).isoformat() for i in range(self.days)]

    @property
    def modifier(self) -> str:
        return f"{self.tz:+d} minutes"


class BadRange(ValueError):
    pass


def window(start: str | None, end: str | None, *, tz: int = 0, days: int = 7, now: datetime | None = None) -> Window:
    """from · to (YYYY-MM-DD, 포함) · 없으면 오늘까지 days 일. 틀리면 BadRange."""
    today = ((now or datetime.now(UTC)) + timedelta(minutes=tz)).date()
    try:
        e = date.fromisoformat(end) if end else today
        s = date.fromisoformat(start) if start else e - timedelta(days=days - 1)
    except ValueError as err:
        raise BadRange("bad_date") from err
    if s > e or (e - s).days + 1 > MAX_DAYS:
        raise BadRange("bad_range")
    return Window(s, e, tz)


# ── 집계 ──


@dataclass(frozen=True)
class Filters:
    org: str | None = None
    space: str | None = None  # 'personal' = 내 스페이스 전부
    user: str | None = None
    model: str | None = None

    def sql(self) -> tuple[str, list[Any]]:
        where, params = [], []
        if self.org:
            where.append("u.org_id = ?")
            params.append(self.org)
        if self.space == PERSONAL:
            where.append("s.kind = 'personal'")
        elif self.space:
            where.append("u.space_id = ?")
            params.append(self.space)
        if self.user:
            where.append("u.user_id = ?")
            params.append(self.user)
        if self.model:
            where.append("u.model = ?")
            params.append(self.model)
        return "".join(f" AND {w}" for w in where), params


_SUMS = (
    "COUNT(*) AS runs, SUM(u.status = 'ok') AS ok, SUM(u.status = 'error') AS errors, SUM(u.status = 'cancelled') AS cancelled,"
    " SUM(u.input_tokens) AS input_tokens, SUM(u.output_tokens) AS output_tokens, SUM(u.reasoning_tokens) AS reasoning_tokens,"
    " SUM(u.requests) AS requests, SUM(u.tool_calls) AS tool_calls, SUM(u.cost_usd) AS cost_usd, COUNT(u.cost_usd) AS cost_runs,"
    " COUNT(DISTINCT u.user_id) AS active_users, CAST(AVG(u.duration_ms) AS INTEGER) AS avg_duration_ms"
)
_KEY: dict[Group, str] = {
    "day": "date(u.started_at, ?)",
    "org": "u.org_id",
    "space": f"CASE WHEN s.kind = 'personal' THEN '{PERSONAL}' ELSE u.space_id END",
    "user": "u.user_id",
    "model": "u.model",
}


def _totals(row: Mapping[str, Any] | None) -> dict[str, Any]:
    r = dict(row) if row is not None else {}
    n = lambda k: int(r.get(k) or 0)  # noqa: E731
    tin, tout = n("input_tokens"), n("output_tokens")
    runs, errors = n("runs"), n("errors")
    return {
        "runs": runs, "ok": n("ok"), "errors": errors, "cancelled": n("cancelled"),
        "error_rate": round(errors / runs, 4) if runs else 0.0,
        "input_tokens": tin, "output_tokens": tout, "tokens": tin + tout, "reasoning_tokens": n("reasoning_tokens"),
        "requests": n("requests"), "tool_calls": n("tool_calls"),
        "cost_usd": round(float(r["cost_usd"]), 6) if r.get("cost_usd") is not None else None,
        "cost_runs": n("cost_runs"),  # 비용을 안 실행 수 (나머지 = 가격 모름 · 실패 · 취소)
        "active_users": n("active_users"), "avg_duration_ms": r.get("avg_duration_ms"),
    }


def _select(db: sqlite3.Connection, w: Window, f: Filters, group: Group | None) -> list[sqlite3.Row]:
    lo, hi = w.bounds
    cond, params = f.sql()
    key = f"{_KEY[group]} AS k, " if group else ""
    head = [w.modifier] if group == "day" else []
    tail = " GROUP BY k" if group else ""
    return db.execute(
        f"SELECT {key}{_SUMS} FROM usage_events u LEFT JOIN spaces s ON s.id = u.space_id"
        f" WHERE u.started_at >= ? AND u.started_at < ?{cond}{tail}",
        (*head, lo, hi, *params),
    ).fetchall()


def _labels(db: sqlite3.Connection, group: Group, keys: list[str], w: Window, model_labels: Mapping[str, str]) -> dict[str, dict[str, Any]]:
    marks = ", ".join("?" * len(keys))
    if not keys:
        return {}
    if group == "org":
        return {r["id"]: {"label": r["name"], "sub": r["slug"]} for r in db.execute(f"SELECT id, name, slug FROM orgs WHERE id IN ({marks})", keys)}
    if group == "space":
        out = {PERSONAL: {"label": None, "kind": "personal"}}  # 이름은 화면이 정한다 (내 스페이스 전부)
        rows = db.execute(f"SELECT s.id, s.name, s.kind, o.name AS org_name, s.org_id FROM spaces s JOIN orgs o ON o.id = s.org_id WHERE s.id IN ({marks})", keys)
        out |= {r["id"]: {"label": r["name"], "sub": r["org_name"], "kind": r["kind"], "org_id": r["org_id"]} for r in rows}
        return out
    if group == "user":
        rows = db.execute(f"SELECT id, display_name, email, status FROM users WHERE id IN ({marks})", keys)
        return {r["id"]: {"label": r["display_name"], "sub": r["email"], "status": r["status"]} for r in rows}
    if group == "model":
        lo, hi = w.bounds
        # 모델마다 한 줄 = 가장 최근 실행의 이름 (SQLite: MAX() 와 같이 고른 칸은 그 최댓값 줄에서 온다)
        rows = db.execute(
            f"SELECT model, model_label, provider, MAX(started_at) FROM usage_events WHERE model IN ({marks}) AND started_at >= ? AND started_at < ?"
            " GROUP BY model", (*keys, lo, hi),
        )
        seen = {r["model"]: {"label": r["model_label"], "provider": r["provider"]} for r in rows}
        for k in seen:
            if model_labels.get(k):
                seen[k]["label"] = model_labels[k]
        return seen
    return {}


def summary(
    db: sqlite3.Connection, w: Window, f: Filters, group: Group = "day", *, limit: int = 50, model_labels: Mapping[str, str] | None = None,
    series: bool = True,
) -> dict[str, Any]:
    """기간 하나 = 합계 + 지난 같은 길이 기간 합계(증감) + 하루별 흐름(빈 날 = 0) + 묶음별 줄 (group != day).
    series=False = 묶음 줄만 쓰는 곳(개요의 조직 · 모델 카드): 지난 기간 · 하루별 흐름을 건너뛴다 (previous None · series [])."""
    totals = _totals((_select(db, w, f, None) or [None])[0])
    previous = _totals((_select(db, w.previous, f, None) or [None])[0]) if series else None
    by_day = {r["k"]: _totals(r) for r in _select(db, w, f, "day")} if series else {}
    empty = _totals(None)
    days = [{"date": d, **by_day.get(d, empty)} for d in w.dates()] if series else []
    out: dict[str, Any] = {
        "from": w.start.isoformat(), "to": w.end.isoformat(), "tz": w.tz, "days": w.days, "group": group,
        "filters": {k: v for k, v in vars(f).items() if v}, "totals": totals, "previous": previous, "series": days, "groups": [], "others": None,
    }
    if group == "day":
        return out
    rows = sorted(((r["k"], _totals(r)) for r in _select(db, w, f, group)), key=lambda kv: (-kv[1]["runs"], -kv[1]["tokens"], str(kv[0])))
    shown, rest = rows[:limit], rows[limit:]
    labels = _labels(db, group, [k for k, _ in shown if k], w, model_labels or {})
    total_runs = totals["runs"] or 1
    out["groups"] = [
        {"key": k, "label": None, "sub": None, **labels.get(k or "", {}), **t, "share": round(t["runs"] / total_runs, 4)} for k, t in shown
    ]
    if rest:
        agg = {key: sum((t[key] or 0) for _, t in rest) for key in ("runs", "errors", "tokens", "input_tokens", "output_tokens", "tool_calls")}
        out["others"] = {"count": len(rest), **agg, "share": round(agg["runs"] / total_runs, 4)}
    return out


def model_errors(db: sqlite3.Connection, w: Window) -> dict[str, dict[str, Any]]:
    """모델별 실행 · 실패 수 (게이트웨이 상태 카드)."""
    lo, hi = w.bounds
    return {
        r["model"]: {"runs": r["runs"], "errors": r["errors"], "error_rate": round(r["errors"] / r["runs"], 4) if r["runs"] else 0.0}
        for r in db.execute(
            "SELECT model, COUNT(*) AS runs, SUM(status = 'error') AS errors FROM usage_events WHERE started_at >= ? AND started_at < ? GROUP BY model",
            (lo, hi),
        )
    }


def active_users(db: sqlite3.Connection, since_iso: str) -> int:
    return db.execute("SELECT COUNT(DISTINCT user_id) FROM usage_events WHERE started_at >= ? AND user_id IS NOT NULL", (since_iso,)).fetchone()[0]


def health_state(h: Any) -> tuple[str, str | None, str | None]:
    """(ok | error | unknown, 실패 code, 시각). 실패가 마지막 성공보다 나중이면 error (모델 표 · 개요가 같은 판정)."""
    if not h:
        return "unknown", None, None
    ok, err = h["last_ok_at"], h["last_error_at"]
    if err and (not ok or err > ok):
        return "error", h["last_error_code"], err
    return ("ok", None, ok) if ok else ("unknown", None, None)
