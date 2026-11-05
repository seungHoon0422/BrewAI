"""사용량 = 실행 한 번마다 한 줄 (usage_events). 관리자 개요 · 사용량 메뉴 · 사용자/조직/스페이스 서랍이 읽는다.

왜 runs 칸이 아니라 따로 표인가 (store v3):
  ① 대화를 지우면 runs 가 같이 지워진다 (ON DELETE CASCADE) → 사용량 · 비용 기록은 남아야 한다.
  ② 관리자 집계는 이 표만 읽는다 → 질문 · 답 · 제목(runs.prompt · messages)이 집계 SQL 에 아예 없다 (대화 내용 0).
  ③ 하루 묶음(usage_daily)은 만들지 않는다: 지금 규모(실행 수천~수만)는 started_at 색인 + GROUP BY 로 충분하고,
     묶음 표는 늦게 닫히는 실행 · 가격 갱신과 어긋날 수 있다. 느려지면 그때 이 표에서 만든다.
한 줄 = 누가(user · org · space) · 무엇으로(model · provider · 그때 이름) · 토큰(입력 · 출력 · 생각 · 캐시 읽기 · 캐시 쓰기) · 모델 요청 수 · 도구 호출 수
  · 추정 비용(토큰 × 그때 model_exposure 게이트웨이 가격 · 가격을 모르면 NULL) + 종류별 비용 칸 다섯 · 걸린 시간 · 상태(ok | error | cancelled) · 시작 시각.
토큰 칸은 겹친다 (Pydantic AI · OpenAI 형식): 입력 ⊇ 캐시 읽기 + 캐시 쓰기 · 출력 ⊇ 생각. 종류별 = 겹치지 않게 나눈 값 (tokens_by_kind · cost_by_kind).
캐시 · 종류별 비용 칸 (ADDED_COLUMNS)은 store v3 뒤에 더했다 → 스키마 번호를 올리지 않고 여기서 없으면 더한다 (ensure_columns · 몇 번이든 같은 결과).
  더할 때 이미 있던 줄의 비용은 지금 가격 비율로 입력 · 출력 · 생각에 나눠 둔다 (합 = 그때 cost_usd 그대로).
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

Group = Literal["day", "org", "user", "space", "model", "project", "key"]
Sort = Literal["runs", "tokens", "cost"]
GROUPS: tuple[Group, ...] = ("day", "org", "user", "space", "model", "project", "key")
NO_PROJECT = "none"  # 프로젝트 묶음 · 거르개: 프로젝트 밖 대화
PERSONAL = "personal"  # 스페이스 묶음: 내 스페이스(개인)는 사람마다 나누지 않고 한 줄 (내용은 본인만 · ADR-0011)
MAX_DAYS = 366
_STATUS = {"done": "ok", "error": "error", "cancelled": "cancelled"}

COLUMNS = (
    "run_id", "started_at", "finished_at", "status", "error_code", "user_id", "org_id", "space_id", "model", "model_label",
    "provider", "input_tokens", "output_tokens", "reasoning_tokens", "requests", "tool_calls", "cost_usd", "duration_ms",
    "cache_read_tokens", "cache_write_tokens", "cost_input_usd", "cost_output_usd", "cost_reasoning_usd", "cost_cache_read_usd",
    "cost_cache_write_usd", "cost_estimated", "project_id", "key_id", "source",
)
# 종류 = 겹치지 않는 토큰 묶음 (화면의 비용 분해 · 모델 사용량). 순서 = 막대 왼쪽부터
KINDS = ("input", "output", "reasoning", "cache_read", "cache_write")
# v3 표에 나중에 더한 칸 (이름, 모양). 새 DB 는 SCHEMA 가 처음부터 갖고, 옛 v3 DB 는 ensure_columns 가 더한다
ADDED_COLUMNS = (
    ("cache_read_tokens", "INTEGER"), ("cache_write_tokens", "INTEGER"),
    *((f"cost_{k}_usd", "REAL") for k in KINDS),
    ("cost_estimated", "INTEGER"),  # 1 = 캐시 가격을 몰라 입력 가격으로 어림
    ("project_id", "TEXT"),  # 실행이 닫힐 때 그 대화의 프로젝트 (NULL = 프로젝트 밖 · 더할 때 옛 줄은 지금 대화의 프로젝트로 채운다)
    ("key_id", "TEXT"),  # API 키로 부른 호출 (ADR-0017 · NULL = 앱)
    ("source", "TEXT"),  # app (데스크톱 대화) | api (/v1 · 키) · 옛 줄 = NULL (app 으로 읽는다)
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
  duration_ms      INTEGER,
  cache_read_tokens    INTEGER,
  cache_write_tokens   INTEGER,
  cost_input_usd       REAL,
  cost_output_usd      REAL,
  cost_reasoning_usd   REAL,
  cost_cache_read_usd  REAL,
  cost_cache_write_usd REAL,
  cost_estimated       INTEGER,
  project_id           TEXT,
  key_id               TEXT,
  source               TEXT
);
CREATE INDEX IF NOT EXISTS usage_at ON usage_events (started_at);
CREATE INDEX IF NOT EXISTS usage_org ON usage_events (org_id, started_at);
CREATE INDEX IF NOT EXISTS usage_space ON usage_events (space_id, started_at);
CREATE INDEX IF NOT EXISTS usage_user ON usage_events (user_id, started_at);
CREATE INDEX IF NOT EXISTS usage_model ON usage_events (model, started_at);
"""
# 더한 칸의 색인 (새 DB = Store 가 열 때 · 옛 표 = ensure_columns 가 칸을 더할 때)
ADDED_INDEXES = (
    "CREATE INDEX IF NOT EXISTS usage_project ON usage_events (project_id, started_at);"
    "CREATE INDEX IF NOT EXISTS usage_key ON usage_events (key_id, started_at);"
)


# ── 기록 (store.finish_run · 옛 DB 채우기 · 꺼진 뒤 닫은 실행) ──


def _int(v: Any) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else None


def _price(info: Mapping[str, Any], key: str) -> float | None:
    v = info.get(key)
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0 else None


def cost_parts(
    info: Mapping[str, Any], input_tokens: int | None, output_tokens: int | None,
    reasoning_tokens: int | None = 0, cache_read_tokens: int | None = 0, cache_write_tokens: int | None = 0,
) -> dict[str, Any] | None:
    """토큰 × 게이트웨이 가격 (USD) → {parts: {종류: 비용}, total, estimated}. 입력 · 출력 토큰이나 그 가격을 모르면 None (0 으로 속이지 않는다).
    입력 토큰 안에 캐시 읽기 · 쓰기가, 출력 토큰 안에 생각이 들어 있다 (OpenAI 형식) → 겹치지 않게 나눠서 각 가격을 곱한다.
    캐시 가격(cache_read_input_token_cost · cache_creation_input_token_cost)을 모르면 입력 가격으로 어림 → estimated True.
    캐시 토큰이 입력보다 크게 오면(입력에서 캐시를 뺀 provider 형식) 캐시 아닌 입력 = 0 으로 막는다."""
    pin, pout = _price(info, "input_cost_per_token"), _price(info, "output_cost_per_token")
    if input_tokens is None or output_tokens is None or pin is None or pout is None:
        return None
    cr, cw = cache_read_tokens or 0, cache_write_tokens or 0
    think = min(reasoning_tokens or 0, output_tokens)
    pread, pwrite = _price(info, "cache_read_input_token_cost"), _price(info, "cache_creation_input_token_cost")
    parts = {
        "input": max(0, input_tokens - cr - cw) * pin,
        "output": (output_tokens - think) * pout,
        "reasoning": think * pout,
        "cache_read": cr * (pin if pread is None else pread),
        "cache_write": cw * (pin if pwrite is None else pwrite),
    }
    return {
        "parts": {k: round(v, 10) for k, v in parts.items()}, "total": round(sum(parts.values()), 10),
        "estimated": bool((cr and pread is None) or (cw and pwrite is None)),
    }


def estimate_cost(info: Mapping[str, Any], input_tokens: int | None, output_tokens: int | None) -> float | None:
    """캐시 · 생각을 모를 때의 합계 (모두 정가 입력 · 출력)."""
    c = cost_parts(info, input_tokens, output_tokens)
    return c["total"] if c else None


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
    think, cr, cw = _int(usage.get("reasoning_tokens")), _int(usage.get("cache_read_tokens")), _int(usage.get("cache_write_tokens"))
    calls = _int(usage.get("tool_calls"))
    cost = cost_parts(gateway_info or {}, tin, tout, think, cr, cw)
    return {
        "run_id": run["id"], "started_at": run["started_at"], "finished_at": run["finished_at"], "status": status,
        "error_code": run["error_code"], "user_id": run["user_id"], "org_id": run["org_id"], "space_id": run["space_id"],
        "model": run["model"], "model_label": run["model_label"], "provider": run["provider"],
        "input_tokens": tin, "output_tokens": tout, "reasoning_tokens": think,
        "requests": _int(usage.get("requests")), "tool_calls": calls if calls is not None else tool_calls_of(steps),
        "cost_usd": cost["total"] if cost else None, "duration_ms": _int(run["duration_ms"]),
        # 캐시 토큰: 토큰을 아는 실행(성공)만 값 (모르면 NULL · 옛 실행 = 0 으로 센 적 없음)
        "cache_read_tokens": (cr or 0) if tin is not None else None, "cache_write_tokens": (cw or 0) if tin is not None else None,
        **{f"cost_{k}_usd": cost["parts"][k] if cost else None for k in KINDS},
        "cost_estimated": int(cost["estimated"]) if cost else None,
        "project_id": run["project_id"] if "project_id" in run.keys() else None,  # record 가 대화의 프로젝트를 붙여 준다
        "key_id": None, "source": "app",
    }


def ensure_columns(db: sqlite3.Connection) -> list[str]:
    """옛 v3 표에 나중 칸(ADDED_COLUMNS)이 없으면 더한다 → 더한 칸 이름 (이미 다 있으면 []). 몇 번 불러도 같은 결과.
    SAVEPOINT = 트랜잭션 안(store.tx)에서도 · 밖(store.read)에서도 한 덩어리. 표가 아직 없으면(Store 가 만들기 전) 아무것도 안 한다."""
    have = {r[1] for r in db.execute("PRAGMA table_info(usage_events)")}
    missing = [(n, t) for n, t in ADDED_COLUMNS if n not in have]
    if not have or not missing:
        return []
    db.execute("SAVEPOINT usage_columns")
    try:
        for name, kind in missing:
            db.execute(f"ALTER TABLE usage_events ADD COLUMN {name} {kind}")
        if "cost_input_usd" in {n for n, _ in missing}:
            _split_old_costs(db)
        if "project_id" in {n for n, _ in missing}:
            db.execute(
                "UPDATE usage_events SET project_id = (SELECT t.project_id FROM runs r JOIN threads t ON t.id = r.thread_id"
                " WHERE r.id = usage_events.run_id)"
            )
        add_indexes(db)
    except BaseException:
        db.execute("ROLLBACK TO usage_columns")
        db.execute("RELEASE usage_columns")
        raise
    db.execute("RELEASE usage_columns")
    return [n for n, _ in missing]


def add_indexes(db: sqlite3.Connection) -> None:
    """더한 칸의 색인 (칸이 있는 것만 · 몇 번이든 같은 결과)."""
    have = {r[1] for r in db.execute("PRAGMA table_info(usage_events)")}
    for sql in (x.strip() for x in ADDED_INDEXES.split(";")):
        col = sql[sql.index("(") + 1:].split(",")[0].strip() if sql else ""
        if sql and col in have:
            db.execute(sql)


def _split_old_costs(db: sqlite3.Connection) -> None:
    """칸을 더하기 전 줄 = 캐시 토큰을 모른다 → 그때 cost_usd 를 지금 가격 비율로 입력 · 출력 · 생각에 나눈다 (합은 그대로).
    지금 가격을 모르면(None) 토큰 수 비율로 · 가격 0(무료)은 그대로 0 (그 종류에 옛 비용을 싣지 않는다).
    cost_estimated = NULL: 캐시 토큰을 몰라 정확한지 아닌지 모른다 (0 = 정확으로 읽히지 않게 · 어림 문구에도 안 센다)."""
    prices: dict[str, dict[str, Any]] = {}
    for r in db.execute("SELECT gateway_id, gateway_info FROM model_exposure"):
        try:
            info = json.loads(r[1] or "{}")
        except ValueError:
            info = {}
        prices[r[0]] = info if isinstance(info, dict) else {}
    rows = db.execute(
        "SELECT run_id, model, input_tokens, output_tokens, reasoning_tokens, cost_usd FROM usage_events WHERE cost_usd IS NOT NULL"
    ).fetchall()
    for run_id, model, tin, tout, think, cost in rows:
        info = prices.get(model, {})
        pin, pout = _price(info, "input_cost_per_token"), _price(info, "output_cost_per_token")
        pin, pout = 1.0 if pin is None else pin, 1.0 if pout is None else pout
        t = min(think or 0, tout or 0)
        w = {"input": (tin or 0) * pin, "output": ((tout or 0) - t) * pout, "reasoning": t * pout}
        total = sum(w.values()) or 1.0
        db.execute(
            "UPDATE usage_events SET cost_input_usd = ?, cost_output_usd = ?, cost_reasoning_usd = ?, cost_cache_read_usd = 0,"
            " cost_cache_write_usd = 0, cost_estimated = NULL WHERE run_id = ?",
            (*(round(cost * w[k] / total, 10) for k in ("input", "output", "reasoning")), run_id),
        )


def record(db: sqlite3.Connection, run_id: str) -> bool:
    """닫힌 실행 하나를 사용량에 (이미 있으면 그대로 = 한 번만). 가격 = 지금 model_exposure 스냅샷."""
    ensure_columns(db)
    run = db.execute(
        "SELECT r.*, t.project_id AS project_id FROM runs r LEFT JOIN threads t ON t.id = r.thread_id WHERE r.id = ?", (run_id,)
    ).fetchone()
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


def record_api(db: sqlite3.Connection, ev: Mapping[str, Any], gateway_info: Mapping[str, Any] | None) -> None:
    """/v1 호출 한 번 = 한 줄 (ADR-0017 · 대화 · 실행 기록 없음 · 숫자만). ev = run_id · started_at · finished_at · status · error_code ·
    user_id · org_id · key_id · model · model_label · provider · duration_ms · usage(OpenAI 모양 dict | None)."""
    ensure_columns(db)
    u = ev.get("usage") or {}
    tin, tout = _int(u.get("prompt_tokens")), _int(u.get("completion_tokens"))
    pd, cd = u.get("prompt_tokens_details") or {}, u.get("completion_tokens_details") or {}
    cr = _int(pd.get("cached_tokens") if isinstance(pd, dict) else None) or _int(u.get("cache_read_input_tokens"))
    cw = _int(u.get("cache_creation_input_tokens"))
    think = _int(cd.get("reasoning_tokens") if isinstance(cd, dict) else None)
    cost = cost_parts(gateway_info or {}, tin, tout, think, cr, cw) if tin is not None else None
    row = {
        "run_id": ev["run_id"], "started_at": ev["started_at"], "finished_at": ev.get("finished_at"), "status": ev["status"],
        "error_code": ev.get("error_code"), "user_id": ev["user_id"], "org_id": ev.get("org_id"), "space_id": None,
        "model": ev["model"], "model_label": ev["model_label"], "provider": ev["provider"],
        "input_tokens": tin, "output_tokens": tout, "reasoning_tokens": think, "requests": 1, "tool_calls": 0,
        "cost_usd": cost["total"] if cost else None, "duration_ms": ev.get("duration_ms"),
        "cache_read_tokens": (cr or 0) if tin is not None else None, "cache_write_tokens": (cw or 0) if tin is not None else None,
        **{f"cost_{k}_usd": cost["parts"][k] if cost else None for k in KINDS},
        "cost_estimated": int(cost["estimated"]) if cost else None, "project_id": None, "key_id": ev["key_id"], "source": "api",
    }
    db.execute(f"INSERT OR IGNORE INTO usage_events ({', '.join(COLUMNS)}) VALUES ({', '.join('?' * len(COLUMNS))})", tuple(row[c] for c in COLUMNS))


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
    project: str | None = None  # 'none' = 프로젝트 밖
    key: str | None = None  # API 키 id ('none' = 앱에서 한 대화)

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
        if self.key == NO_PROJECT:
            where.append("u.key_id IS NULL")
        elif self.key:
            where.append("u.key_id = ?")
            params.append(self.key)
        if self.project == NO_PROJECT:
            where.append("u.project_id IS NULL")
        elif self.project:
            where.append("u.project_id = ?")
            params.append(self.project)
        return "".join(f" AND {w}" for w in where), params


_SUMS = (
    "COUNT(*) AS runs, SUM(u.status = 'ok') AS ok, SUM(u.status = 'error') AS errors, SUM(u.status = 'cancelled') AS cancelled,"
    " SUM(u.input_tokens) AS input_tokens, SUM(u.output_tokens) AS output_tokens, SUM(u.reasoning_tokens) AS reasoning_tokens,"
    " SUM(u.requests) AS requests, SUM(u.tool_calls) AS tool_calls, SUM(u.cost_usd) AS cost_usd, COUNT(u.cost_usd) AS cost_runs,"
    " SUM(u.cache_read_tokens) AS cache_read_tokens, SUM(u.cache_write_tokens) AS cache_write_tokens, SUM(u.cost_estimated) AS cost_estimated_runs,"
    + "".join(f" SUM(u.cost_{k}_usd) AS cost_{k}_usd," for k in KINDS) +
    " COUNT(DISTINCT u.user_id) AS active_users, CAST(AVG(u.duration_ms) AS INTEGER) AS avg_duration_ms"
)
_KEY: dict[Group, str] = {
    "day": "date(u.started_at, ?)",
    "org": "u.org_id",
    "space": f"CASE WHEN s.kind = 'personal' THEN '{PERSONAL}' ELSE u.space_id END",
    "user": "u.user_id",
    "model": "u.model",
    "project": f"COALESCE(u.project_id, '{NO_PROJECT}')",
    "key": f"COALESCE(u.key_id, '{NO_PROJECT}')",
}


def _usd(v: Any) -> float | None:
    return round(float(v), 8) if v is not None else None


_SORT: dict[str, Any] = {
    "runs": lambda t: (-t["runs"], -t["tokens"]),
    "tokens": lambda t: (-t["tokens"], -t["runs"]),
    "cost": lambda t: (-(t["cost_usd"] or 0), -t["runs"]),
}


def _totals(row: Mapping[str, Any] | None) -> dict[str, Any]:
    r = dict(row) if row is not None else {}
    n = lambda k: int(r.get(k) or 0)  # noqa: E731
    tin, tout = n("input_tokens"), n("output_tokens")
    runs, errors = n("runs"), n("errors")
    cr, cw, think = n("cache_read_tokens"), n("cache_write_tokens"), n("reasoning_tokens")
    cost = _usd(r.get("cost_usd"))
    return {
        "runs": runs, "ok": n("ok"), "errors": errors, "cancelled": n("cancelled"),
        "error_rate": round(errors / runs, 4) if runs else 0.0,
        "input_tokens": tin, "output_tokens": tout, "tokens": tin + tout, "reasoning_tokens": think,
        "cache_read_tokens": cr, "cache_write_tokens": cw,
        # 입력 중 캐시에서 읽은 비율 = 캐시 읽기 / 입력 전체 (입력 ⊇ 캐시 읽기 + 캐시 쓰기 · 캐시 쓰기도 분모에 = Anthropic 보고와 같은 뜻).
        # 계획의 '캐시 읽기 / (입력 + 캐시 읽기)' 와 다르다: 여기 입력은 이미 캐시를 품어 그 식은 캐시 읽기를 두 번 센다
        "cache_hit_rate": round(cr / tin, 4) if tin else 0.0,
        # 겹치지 않는 토큰 묶음 (합 = tokens)
        "tokens_by_kind": {"input": max(0, tin - cr - cw), "output": max(0, tout - think), "reasoning": think, "cache_read": cr, "cache_write": cw},
        "requests": n("requests"), "tool_calls": n("tool_calls"),
        "cost_usd": cost,
        # 종류별 비용 (합 ≈ cost_usd). 비용을 하나도 모르면 전부 None
        "cost_by_kind": {k: (_usd(r.get(f"cost_{k}_usd")) or 0.0) if cost is not None else None for k in KINDS},
        "cost_runs": n("cost_runs"),  # 비용을 안 실행 수 (나머지 = 가격 모름 · 실패 · 취소)
        "cost_estimated_runs": n("cost_estimated_runs"),  # 캐시 가격을 몰라 입력 가격으로 어림한 실행 수
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


TREND_KEYS = ("runs", "tokens", "cost_usd")


def _trend(db: sqlite3.Connection, w: Window, f: Filters, group: Group) -> dict[str | None, dict[str, list[Any]]]:
    """묶음마다 하루별 흐름 (호출 · 토큰 · 비용 · w.dates() 순 · 빈 날 = 0 · 비용을 모르는 날 = None) — 개요 '단위별 추이'."""
    lo, hi = w.bounds
    cond, params = f.sql()
    rows = db.execute(
        f"SELECT {_KEY[group]} AS k, date(u.started_at, ?) AS d, COUNT(*) AS runs,"
        " COALESCE(SUM(u.input_tokens), 0) + COALESCE(SUM(u.output_tokens), 0) AS tokens, SUM(u.cost_usd) AS cost_usd"
        f" FROM usage_events u LEFT JOIN spaces s ON s.id = u.space_id WHERE u.started_at >= ? AND u.started_at < ?{cond} GROUP BY k, d",
        (w.modifier, lo, hi, *params),
    ).fetchall()
    at = {d: i for i, d in enumerate(w.dates())}
    out: dict[str | None, dict[str, list[Any]]] = {}
    for r in rows:
        i = at.get(r["d"])
        if i is None:
            continue
        t = out.setdefault(r["k"], {"runs": [0] * len(at), "tokens": [0] * len(at), "cost_usd": [None] * len(at)})
        t["runs"][i] = int(r["runs"] or 0)
        t["tokens"][i] = int(r["tokens"] or 0)
        t["cost_usd"][i] = _usd(r["cost_usd"])
    return out


def _sum_trend(parts: list[dict[str, list[Any]]], n: int) -> dict[str, list[Any]]:
    out: dict[str, list[Any]] = {"runs": [0] * n, "tokens": [0] * n, "cost_usd": [None] * n}
    for p in parts:
        for i in range(n):
            out["runs"][i] += p["runs"][i]
            out["tokens"][i] += p["tokens"][i]
            if p["cost_usd"][i] is not None:
                out["cost_usd"][i] = round((out["cost_usd"][i] or 0) + p["cost_usd"][i], 8)
    return out


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
    if group == "key":
        out = {NO_PROJECT: {"label": None, "kind": "app"}}  # 이름은 화면이 정한다 (앱에서 한 대화)
        rows = db.execute(f"SELECT id, name, hint, revoked_at FROM api_keys WHERE id IN ({marks})", keys)
        out |= {r["id"]: {"label": r["name"], "sub": r["hint"], "kind": "revoked" if r["revoked_at"] else "key"} for r in rows}
        return out
    if group == "project":
        out = {NO_PROJECT: {"label": None, "kind": "none"}}  # 이름은 화면이 정한다 (프로젝트 밖)
        rows = db.execute(
            f"SELECT p.id, p.name, s.name AS space_name, s.kind FROM projects p JOIN spaces s ON s.id = p.space_id WHERE p.id IN ({marks})", keys)
        out |= {r["id"]: {"label": r["name"], "sub": r["space_name"], "kind": "project", "space_kind": r["kind"]} for r in rows}
        return out
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
    series: bool = True, sort: Sort = "runs", trend: bool = False,
) -> dict[str, Any]:
    """기간 하나 = 합계 + 지난 같은 길이 기간 합계(증감) + 하루별 흐름(빈 날 = 0) + 묶음별 줄 (group != day).
    series=False = 묶음 줄만 쓰는 곳(개요의 Top 5 카드): 지난 기간 · 하루별 흐름을 건너뛴다 (previous None · series []).
    sort = 묶음 줄 순서 (runs | tokens | cost · 큰 것부터) → limit 으로 자른 나머지는 others 하나.
    trend = 묶음 줄 · others 마다 하루별 흐름 {runs, tokens, cost_usd} (dates = 그 날짜들 · 개요 '단위별 추이' 차트)."""
    ensure_columns(db)
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
    rank = _SORT[sort]
    rows = sorted(((r["k"], _totals(r)) for r in _select(db, w, f, group)), key=lambda kv: (*rank(kv[1]), str(kv[0])))
    shown, rest = rows[:limit], rows[limit:]
    labels = _labels(db, group, [k for k, _ in shown if k], w, model_labels or {})
    total_runs = totals["runs"] or 1
    out["groups"] = [
        {"key": k, "label": None, "sub": None, **labels.get(k or "", {}), **t, "share": round(t["runs"] / total_runs, 4)} for k, t in shown
    ]
    if rest:
        keys = ("runs", "errors", "tokens", "input_tokens", "output_tokens", "tool_calls", "cache_read_tokens", "cache_write_tokens")
        agg: dict[str, Any] = {key: sum((t[key] or 0) for _, t in rest) for key in keys}
        costs = [t["cost_usd"] for _, t in rest if t["cost_usd"] is not None]
        agg["cost_usd"] = round(sum(costs), 8) if costs else None
        out["others"] = {"count": len(rest), **agg, "share": round(agg["runs"] / total_runs, 4)}
    if trend:
        dates = w.dates()
        by = _trend(db, w, f, group)
        zero = _sum_trend([], len(dates))
        out["dates"] = dates
        for g in out["groups"]:
            g["trend"] = by.get(g["key"], zero)
        if out["others"] is not None:
            out["others"]["trend"] = _sum_trend([by[k] for k, _ in rest if k in by], len(dates))
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
