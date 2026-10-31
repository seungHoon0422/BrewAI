"""conductor 로컬 저장소 = SQLite (표준 라이브러리 sqlite3). 파일 = CONDUCTOR_DB_PATH (기본 .data/conductor.sqlite3, gitignore).

표
  meta            키·값 (첫 동기화 여부 · 마지막 동기화 시각)
  model_health    모델별 마지막 성공 · 마지막 실패(code = diagnose detail) — 채팅 결과와 관리자 '연결 시험' 이 남긴다
  model_exposure  관리자 소유: 노출 · 표시 이름 · 순서 · 기본값 + 게이트웨이 정보 스냅샷 (ADR-0006. 등록·가격 입력 없음)
  threads         대화 (id = AG-UI threadId) · space_id · project_id(NULL = 프로젝트 없음) · user_id(만든 사람) · visibility
  runs            실행 한 번 = 질문 하나. 완료(done) 실행의 messages 를 이어 붙인 것 = 대화 기록 (서버가 원본) · user · space · org
  ↓ v2 (ADR-0010 · 0011) — 읽고 쓰는 코드 = auth/accounts.py · auth/directory.py
  users · identities · sessions · refresh_tokens · one_time_tokens · login_attempts   로그인 · 세션 (토큰은 sha256 만)
  orgs · org_members · spaces · space_members · projects · invites                    조직 > 스페이스 > 프로젝트
  audit_events                                                                         append-only (UPDATE · DELETE 코드 없음)
  ↓ v3 — 읽고 쓰는 코드 = usage.py
  usage_events    실행 한 번 = 한 줄 (누가 · 어느 모델 · 토큰 · 도구 호출 · 추정 비용 · 상태). 대화를 지워도 남는다 · 대화 내용 없음

v1 → v2: 파일 DB 면 먼저 `<파일>.v1.bak` 으로 백업 → threads · runs 에 칸을 더한다. 옛 대화(space_id NULL)는 첫 관리자가
생길 때 그 사람의 내 스페이스로 (auth/directory.bootstrap).
v2 → v3: 파일 DB 면 먼저 `<파일>.v2.bak` → usage_events 표 + 이미 닫힌 옛 실행을 한 번 채운다 (v1 에서 오면 v1.bak 이 원본).
대화 · 실행 함수는 범위 인자(user_id · space_id)를 받는다. 전역 조회는 admin_* 만. 권한 판정은 auth/policy.py (여기선 안 한다).
연결 하나 + 잠금 하나 (요청이 짧다 · P1). ":memory:" = 테스트·E2E (프로세스가 끝나면 사라짐).
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from . import usage as usage_log  # 이름 usage 는 finish_run 인자 (토큰 dict)

SCHEMA_VERSION = 3  # 표 추가(IF NOT EXISTS)는 버전을 올리지 않는다. 칸 추가 · 뜻이 바뀌는 변경 · 채우기만 (v2 = 로그인 · 조직 · v3 = 사용량)
log = logging.getLogger("conductor.store")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_exposure (
  gateway_id   TEXT PRIMARY KEY,
  display_name TEXT,
  sort_order   INTEGER NOT NULL,
  exposed      INTEGER NOT NULL DEFAULT 0 CHECK (exposed IN (0, 1)),
  is_default   INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  status       TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'missing')),
  reviewed     INTEGER NOT NULL DEFAULT 0 CHECK (reviewed IN (0, 1)),
  gateway_info TEXT NOT NULL DEFAULT '{}',
  first_seen   TEXT NOT NULL,
  last_seen    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS model_exposure_one_default ON model_exposure (is_default) WHERE is_default = 1;
CREATE TABLE IF NOT EXISTS threads (
  id         TEXT PRIMARY KEY,
  title      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  space_id   TEXT REFERENCES spaces (id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects (id) ON DELETE SET NULL,
  user_id    TEXT REFERENCES users (id) ON DELETE CASCADE,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared'))
);
CREATE TABLE IF NOT EXISTS runs (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,
  thread_id   TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('running', 'done', 'error', 'cancelled')),
  model       TEXT NOT NULL,
  model_label TEXT NOT NULL,
  provider    TEXT NOT NULL,
  reasoning   TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  steps       TEXT NOT NULL DEFAULT '[]',
  messages    TEXT,
  usage       TEXT,
  error_code  TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  user_id     TEXT REFERENCES users (id) ON DELETE SET NULL,
  space_id    TEXT,
  org_id      TEXT
);
CREATE INDEX IF NOT EXISTS runs_thread ON runs (thread_id, seq);
CREATE TABLE IF NOT EXISTS model_health (
  gateway_id      TEXT PRIMARY KEY,
  last_ok_at      TEXT,
  last_error_code TEXT,
  last_error_at   TEXT,
  last_source     TEXT CHECK (last_source IN ('chat', 'probe'))
);
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  email_norm    TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  instance_role TEXT NOT NULL DEFAULT 'user' CHECK (instance_role IN ('admin', 'user')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_space_id TEXT,
  created_at    TEXT NOT NULL,
  last_login_at TEXT,
  email_verified_at TEXT
);
CREATE TABLE IF NOT EXISTS identities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('password', 'google')),
  issuer        TEXT NOT NULL,
  subject       TEXT NOT NULL,
  password_hash TEXT,
  email         TEXT,
  hd            TEXT,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT,
  UNIQUE (issuer, subject)
);
CREATE UNIQUE INDEX IF NOT EXISTS identities_one_per_provider ON identities (user_id, provider);
CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client            TEXT NOT NULL CHECK (client IN ('desktop', 'admin')),
  access_hash       TEXT UNIQUE,
  access_expires_at TEXT,
  csrf_token        TEXT,
  created_at        TEXT NOT NULL,
  last_used_at      TEXT NOT NULL,
  idle_expires_at   TEXT NOT NULL,
  abs_expires_at    TEXT NOT NULL,
  revoked_at        TEXT,
  revoke_reason     TEXT,
  ip                TEXT,
  user_agent        TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  hash       TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE TABLE IF NOT EXISTS one_time_tokens (
  hash       TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('handoff', 'reset', 'oauth_flow', 'link')),
  user_id    TEXT REFERENCES users (id) ON DELETE CASCADE,
  data       TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE TABLE IF NOT EXISTS login_attempts (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  locked_until TEXT
);
CREATE TABLE IF NOT EXISTS orgs (
  id                        TEXT PRIMARY KEY,
  name                      TEXT NOT NULL,
  slug                      TEXT NOT NULL UNIQUE,
  join_policy               TEXT NOT NULL DEFAULT 'invite' CHECK (join_policy IN ('invite', 'domain_auto')),
  google_hd                 TEXT,
  members_can_create_spaces INTEGER NOT NULL DEFAULT 1 CHECK (members_can_create_spaces IN (0, 1)),
  created_at                TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS org_members (
  org_id    TEXT NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE TABLE IF NOT EXISTS spaces (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('personal', 'shared')),
  owner_user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  visibility    TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('open', 'private')),
  created_by    TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  archived_at   TEXT,
  CHECK ((kind = 'personal') = (owner_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS spaces_one_personal ON spaces (owner_user_id) WHERE kind = 'personal';
CREATE TABLE IF NOT EXISTS space_members (
  space_id TEXT NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role     TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  added_at TEXT NOT NULL,
  PRIMARY KEY (space_id, user_id)
);
CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  space_id     TEXT NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  created_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  archived_at  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_space ON projects (space_id, sort_order);
CREATE TABLE IF NOT EXISTS invites (
  id         TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL UNIQUE,
  org_id     TEXT NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  email      TEXT,
  org_role   TEXT NOT NULL CHECK (org_role IN ('admin', 'member')),
  space_ids  TEXT NOT NULL DEFAULT '[]',
  max_uses   INTEGER NOT NULL DEFAULT 1,
  uses       INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_events (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT NOT NULL,
  actor_user_id TEXT,
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  result        TEXT NOT NULL CHECK (result IN ('ok', 'denied', 'error')),
  ip            TEXT,
  detail        TEXT
);
CREATE INDEX IF NOT EXISTS threads_space ON threads (space_id, updated_at);
CREATE INDEX IF NOT EXISTS runs_user ON runs (user_id, seq);
""" + usage_log.SCHEMA

# v1 → v2: 이미 있는 표에 더하는 칸 (새 DB 는 _SCHEMA 의 CREATE TABLE 이 처음부터 갖고 있다)
_V2_COLUMNS = {
    "threads": (
        "space_id TEXT REFERENCES spaces (id) ON DELETE CASCADE",
        "project_id TEXT REFERENCES projects (id) ON DELETE SET NULL",
        "user_id TEXT REFERENCES users (id) ON DELETE CASCADE",
        "visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared'))",
    ),
    "runs": ("user_id TEXT REFERENCES users (id) ON DELETE SET NULL", "space_id TEXT", "org_id TEXT"),
}


BUSY_STALE_S = 600  # 이보다 오래된 running 은 막지 않는다 (만약 닫히지 못한 실행이 남아도 대화가 영영 잠기지 않게)


class StoreConflict(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Store:
    def __init__(self, path: str | Path = ":memory:") -> None:
        target = str(path)
        if target != ":memory:":
            p = Path(target)
            p.parent.mkdir(parents=True, exist_ok=True)  # 윈도우·맥 같은 코드 (pathlib)
            target = str(p)
        self.path = target
        self._lock = threading.RLock()
        self._db = sqlite3.connect(target, check_same_thread=False, isolation_level=None, timeout=5.0)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA foreign_keys = ON")
        if target != ":memory:":
            self._db.execute("PRAGMA journal_mode = WAL")
        version = self._db.execute("PRAGMA user_version").fetchone()[0]
        if version > SCHEMA_VERSION:
            raise RuntimeError(f"{target} 은 더 새 conductor 가 만든 DB 예요 (schema {version} > {SCHEMA_VERSION})")
        had_runs = "runs" in self._tables()
        self._migrate()
        if 0 < version < 3 and had_runs:
            self._backup(f"{self.path}.v2.bak", skip=version < 2)  # v1 에서 오면 v1.bak 이 이미 원본
        self._db.executescript(_SCHEMA)
        with self.tx() as db:
            if version < 3 and had_runs:
                log.info("DB v%d → v3: 사용량 %d건 채움", version, usage_log.backfill(db))
            db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
            # 지난번 conductor 가 실행 중에 꺼졌으면 그 실행은 끝나지 않는다 → 취소로 닫는다 (사용량도 그대로 한 줄)
            at = now_iso()
            stale = [r[0] for r in db.execute("SELECT id FROM runs WHERE status = 'running'")]
            db.execute("UPDATE runs SET status = 'cancelled', error_code = 'interrupted', finished_at = ? WHERE status = 'running'", (at,))
            for run_id in stale:
                usage_log.record(db, run_id)

    def _tables(self) -> set[str]:
        return {r["name"] for r in self._db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}

    def _backup(self, dest_path: str, *, skip: bool = False) -> None:
        """파일 DB 를 바꾸기 전 복사 (있으면 그대로 둔다 = 첫 백업이 원본). :memory: 는 없음."""
        if skip or self.path == ":memory:":
            return
        bak = Path(dest_path)
        if bak.exists():
            return
        dest = sqlite3.connect(str(bak))
        try:
            self._db.backup(dest)
        finally:
            dest.close()
        log.info("DB 백업 %s", bak)

    def _columns(self, table: str) -> set[str]:
        return {r["name"] for r in self._db.execute(f"PRAGMA table_info({table})")}

    def _migrate(self) -> None:
        """v1 → v2: 옛 표에 칸 더하기. 파일 DB 는 바꾸기 전에 `<파일>.v1.bak` (있으면 그대로 둔다 = 첫 백업이 원본)."""
        missing = {t: [c for c in cols if c.split()[0] not in self._columns(t)] for t, cols in _V2_COLUMNS.items()}
        if not any(missing[t] for t in missing if self._columns(t)):
            return  # 새 DB (표 없음) · 이미 v2
        self._backup(f"{self.path}.v1.bak")
        self._db.execute("BEGIN IMMEDIATE")
        try:
            for table, cols in missing.items():
                for col in cols:
                    self._db.execute(f"ALTER TABLE {table} ADD COLUMN {col}")
        except BaseException:
            self._db.execute("ROLLBACK")
            raise
        self._db.execute("COMMIT")

    def close(self) -> None:
        with self._lock:
            self._db.close()

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                yield self._db
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
            self._db.execute("COMMIT")

    @contextmanager
    def read(self) -> Iterator[sqlite3.Connection]:
        """여러 SELECT 를 잠금 하나로 (트랜잭션 없음 · 쓰지 않는다)."""
        with self._lock:
            yield self._db

    def query(self, sql: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, params).fetchall()

    # ── meta ──
    def get_meta(self, key: str) -> str | None:
        rows = self.query("SELECT value FROM meta WHERE key = ?", (key,))
        return rows[0]["value"] if rows else None

    @staticmethod
    def set_meta(db: sqlite3.Connection, key: str, value: str) -> None:
        db.execute("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", (key, value))

    # ── threads · runs ──
    def thread_history(self, thread_id: str) -> list[str]:
        """완료된 실행의 messages(JSON) 를 순서대로. 실패·취소한 실행은 기록에 안 들어간다 (다시 시도가 질문을 두 번 넣지 않게)."""
        rows = self.query(
            "SELECT messages FROM runs WHERE thread_id = ? AND status = 'done' AND messages IS NOT NULL ORDER BY seq",
            (thread_id,),
        )
        return [r["messages"] for r in rows]

    def start_run(
        self, *, run_id: str, thread_id: str, model: str, model_label: str, provider: str, reasoning: str, prompt: str,
        user_id: str | None = None, space_id: str | None = None, org_id: str | None = None, project_id: str | None = None,
    ) -> None:
        """같은 대화에서 실행 중이면 thread_busy · 같은 runId 가 또 오면 run_exists (확인과 기록을 한 트랜잭션에서).
        새 대화 = space · project · 만든 사람을 이때 정한다. 이미 있는 대화가 남의 것이면 thread_not_found (검사와 쓰기 사이 경합)."""
        at = now_iso()
        cutoff = (datetime.now(UTC) - timedelta(seconds=BUSY_STALE_S)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        with self.tx() as db:
            if db.execute("SELECT 1 FROM runs WHERE id = ?", (run_id,)).fetchone():
                raise StoreConflict("run_exists")
            owner = db.execute("SELECT user_id FROM threads WHERE id = ?", (thread_id,)).fetchone()
            if owner is not None and owner["user_id"] != user_id:
                raise StoreConflict("thread_not_found")
            if db.execute(
                "SELECT 1 FROM runs WHERE thread_id = ? AND status = 'running' AND started_at > ?", (thread_id, cutoff)
            ).fetchone():
                raise StoreConflict("thread_busy")
            db.execute(
                "INSERT INTO threads (id, title, created_at, updated_at, space_id, project_id, user_id) VALUES (?, NULL, ?, ?, ?, ?, ?)"
                " ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at",
                (thread_id, at, at, space_id, project_id, user_id),
            )
            db.execute(
                "INSERT INTO runs (id, thread_id, status, model, model_label, provider, reasoning, prompt, started_at, user_id, space_id, org_id)"
                " VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (run_id, thread_id, model, model_label, provider, reasoning, prompt, at, user_id, space_id, org_id),
            )

    def update_steps(self, run_id: str, steps: list[dict[str, Any]]) -> None:
        with self._lock:
            self._db.execute("UPDATE runs SET steps = ? WHERE id = ?", (json.dumps(steps, ensure_ascii=False), run_id))

    def finish_run(
        self,
        run_id: str,
        *,
        status: str,
        steps: list[dict[str, Any]],
        duration_ms: int,
        messages: str | None = None,
        usage: dict[str, Any] | None = None,
        error_code: str | None = None,
        title: str | None = None,
    ) -> None:
        at = now_iso()
        with self.tx() as db:
            row = db.execute("SELECT thread_id, status FROM runs WHERE id = ?", (run_id,)).fetchone()
            if row is None or row["status"] != "running":
                return  # 이미 닫힘 (스레드 삭제 등)
            db.execute(
                "UPDATE runs SET status = ?, steps = ?, messages = ?, usage = ?, error_code = ?, finished_at = ?, duration_ms = ?"
                " WHERE id = ?",
                (
                    status,
                    json.dumps(steps, ensure_ascii=False),
                    messages if status == "done" else None,
                    json.dumps(usage) if usage is not None else None,
                    error_code,
                    at,
                    duration_ms,
                    run_id,
                ),
            )
            db.execute(
                "UPDATE threads SET updated_at = ?, title = COALESCE(title, ?) WHERE id = ?",
                (at, title if status == "done" else None, row["thread_id"]),
            )
            usage_log.record(db, run_id)  # 같은 트랜잭션 = 실행이 닫히면 사용량도 반드시 한 줄

    _THREAD_COLS = (
        "t.id, t.title, t.created_at, t.updated_at, t.space_id, t.project_id, t.user_id, t.visibility, u.display_name AS owner_name,"
        " (SELECT COUNT(*) FROM runs r WHERE r.thread_id = t.id AND r.status = 'done') AS turns,"
        " (SELECT r.model FROM runs r WHERE r.thread_id = t.id ORDER BY r.seq DESC LIMIT 1) AS last_model,"
        " EXISTS (SELECT 1 FROM runs r WHERE r.thread_id = t.id AND r.status = 'running') AS running"
    )

    def list_threads(self, *, user_id: str, space_id: str, project_id: str | None = None, no_project: bool = False, limit: int) -> list[sqlite3.Row]:
        """한 스페이스에서 이 사람이 볼 대화 = 내 대화 + 공유된 대화. 완료된 실행이 하나라도 있는 대화만
        (첫 질문이 실패만 한 대화는 목록에 안 뜬다). 최근 순. project_id = 그 프로젝트만 · no_project = 프로젝트 없는 것만."""
        where = ["t.space_id = ?", "(t.user_id = ? OR t.visibility = 'shared')"]
        params: list[Any] = [space_id, user_id]
        if project_id is not None:
            where.append("t.project_id = ?")
            params.append(project_id)
        elif no_project:
            where.append("t.project_id IS NULL")
        return self.query(
            f"SELECT {self._THREAD_COLS} FROM threads t LEFT JOIN users u ON u.id = t.user_id"
            f" WHERE {' AND '.join(where)} AND EXISTS (SELECT 1 FROM runs r WHERE r.thread_id = t.id AND r.status = 'done')"
            " ORDER BY t.updated_at DESC, t.id LIMIT ?",
            (*params, limit),
        )

    def thread_row(self, thread_id: str) -> sqlite3.Row | None:
        """권한 판정용 한 줄 (판정은 부르는 쪽 · auth/policy.py)."""
        rows = self.query(f"SELECT {self._THREAD_COLS} FROM threads t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?", (thread_id,))
        return rows[0] if rows else None

    def thread_runs(self, thread_id: str) -> list[sqlite3.Row]:
        return self.query("SELECT * FROM runs WHERE thread_id = ? AND status = 'done' ORDER BY seq", (thread_id,))

    def update_thread(self, thread_id: str, changes: dict[str, Any]) -> None:
        """title · visibility · project_id 만 (판정 · 같은 스페이스 검사는 부르는 쪽)."""
        cols = [k for k in ("title", "visibility", "project_id") if k in changes]
        if cols:
            with self._lock:
                self._db.execute(
                    f"UPDATE threads SET {', '.join(f'{c} = ?' for c in cols)} WHERE id = ?", (*[changes[c] for c in cols], thread_id)
                )

    def delete_thread(self, thread_id: str) -> bool:
        """실행 중이면 thread_busy. 지우면 그 대화의 실행 기록(runs)도 같이 지운다."""
        with self.tx() as db:
            if db.execute("SELECT 1 FROM runs WHERE thread_id = ? AND status = 'running'", (thread_id,)).fetchone():
                raise StoreConflict("thread_busy")
            return db.execute("DELETE FROM threads WHERE id = ?", (thread_id,)).rowcount > 0

    def list_runs(self, *, user_id: str, space_id: str | None = None, limit: int) -> list[sqlite3.Row]:
        """내 실행만 (진행 상황 화면). space_id = 그 스페이스만."""
        where, params = "r.user_id = ?", [user_id]
        if space_id is not None:
            where += " AND r.space_id = ?"
            params.append(space_id)
        return self.query(
            f"SELECT r.*, t.title AS thread_title, t.project_id FROM runs r JOIN threads t ON t.id = r.thread_id WHERE {where}"
            " ORDER BY r.seq DESC LIMIT ?",
            (*params, limit),
        )

    # ── model_health ──
    def record_model_result(self, gateway_id: str, *, error_code: str | None, source: str) -> str:
        """성공(error_code None) = last_ok_at · 실패 = last_error_code/at. 시각을 돌려준다."""
        at = now_iso()
        with self._lock:
            if error_code is None:
                self._db.execute(
                    "INSERT INTO model_health (gateway_id, last_ok_at, last_source) VALUES (?, ?, ?)"
                    " ON CONFLICT (gateway_id) DO UPDATE SET last_ok_at = excluded.last_ok_at, last_source = excluded.last_source",
                    (gateway_id, at, source),
                )
            else:
                self._db.execute(
                    "INSERT INTO model_health (gateway_id, last_error_code, last_error_at, last_source) VALUES (?, ?, ?, ?)"
                    " ON CONFLICT (gateway_id) DO UPDATE SET last_error_code = excluded.last_error_code,"
                    " last_error_at = excluded.last_error_at, last_source = excluded.last_source",
                    (gateway_id, error_code[:64], at, source),
                )
        return at

    def model_health(self) -> dict[str, sqlite3.Row]:
        return {r["gateway_id"]: r for r in self.query("SELECT * FROM model_health")}

    # ── 스킬 사용 횟수 = 실행 단계(skill:<이름>) 에서 센다 (실행마다 한 번) ──
    def skill_usage(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for r in self.query("SELECT steps FROM runs WHERE steps LIKE '%\"skill:%'"):
            try:
                steps = json.loads(r["steps"] or "[]")
            except ValueError:
                continue
            names = {s.get("name", "")[6:] for s in steps if isinstance(s, dict) and str(s.get("name", "")).startswith("skill:")}
            for n in names:
                counts[n] = counts.get(n, 0) + 1
        return counts
