"""conductor 로컬 저장소 = SQLite (표준 라이브러리 sqlite3). 파일 = CONDUCTOR_DB_PATH (기본 .data/conductor.sqlite3, gitignore).

표 4개
  meta            키·값 (첫 동기화 여부 · 마지막 동기화 시각)
  model_exposure  관리자 소유: 노출 · 표시 이름 · 순서 · 기본값 + 게이트웨이 정보 스냅샷 (ADR-0006. 등록·가격 입력 없음)
  threads         대화 (id = AG-UI threadId)
  runs            실행 한 번 = 질문 하나. 완료(done) 실행의 messages 를 이어 붙인 것 = 대화 기록 (서버가 원본)

연결 하나 + 잠금 하나 (요청이 짧고 사용자 한 명 · P1). ":memory:" = 테스트·E2E (프로세스가 끝나면 사라짐).
"""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1

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
  updated_at TEXT NOT NULL
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
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS runs_thread ON runs (thread_id, seq);
"""


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
        self._db.executescript(_SCHEMA)
        self._db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        # 지난번 conductor 가 실행 중에 꺼졌으면 그 실행은 끝나지 않는다 → 취소로 닫는다
        self._db.execute(
            "UPDATE runs SET status = 'cancelled', error_code = 'interrupted', finished_at = ? WHERE status = 'running'",
            (now_iso(),),
        )

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

    def start_run(self, *, run_id: str, thread_id: str, model: str, model_label: str, provider: str, reasoning: str, prompt: str) -> None:
        """같은 대화에서 실행 중이면 thread_busy · 같은 runId 가 또 오면 run_exists (확인과 기록을 한 트랜잭션에서)."""
        at = now_iso()
        cutoff = (datetime.now(UTC) - timedelta(seconds=BUSY_STALE_S)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        with self.tx() as db:
            if db.execute("SELECT 1 FROM runs WHERE id = ?", (run_id,)).fetchone():
                raise StoreConflict("run_exists")
            if db.execute(
                "SELECT 1 FROM runs WHERE thread_id = ? AND status = 'running' AND started_at > ?", (thread_id, cutoff)
            ).fetchone():
                raise StoreConflict("thread_busy")
            db.execute(
                "INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, NULL, ?, ?)"
                " ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at",
                (thread_id, at, at),
            )
            db.execute(
                "INSERT INTO runs (id, thread_id, status, model, model_label, provider, reasoning, prompt, started_at)"
                " VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?)",
                (run_id, thread_id, model, model_label, provider, reasoning, prompt, at),
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

    def list_threads(self, limit: int) -> list[sqlite3.Row]:
        """완료된 실행이 하나라도 있는 대화만 (첫 질문이 실패만 한 대화는 목록에 안 뜬다). 최근 순."""
        return self.query(
            "SELECT t.id, t.title, t.created_at, t.updated_at,"
            " (SELECT COUNT(*) FROM runs r WHERE r.thread_id = t.id AND r.status = 'done') AS turns,"
            " (SELECT r.model FROM runs r WHERE r.thread_id = t.id ORDER BY r.seq DESC LIMIT 1) AS last_model,"
            " EXISTS (SELECT 1 FROM runs r WHERE r.thread_id = t.id AND r.status = 'running') AS running"
            " FROM threads t WHERE EXISTS (SELECT 1 FROM runs r WHERE r.thread_id = t.id AND r.status = 'done')"
            " ORDER BY t.updated_at DESC, t.id LIMIT ?",
            (limit,),
        )

    def get_thread(self, thread_id: str) -> tuple[sqlite3.Row, list[sqlite3.Row]] | None:
        rows = self.query("SELECT id, title, created_at, updated_at FROM threads WHERE id = ?", (thread_id,))
        if not rows:
            return None
        runs = self.query("SELECT * FROM runs WHERE thread_id = ? AND status = 'done' ORDER BY seq", (thread_id,))
        return rows[0], runs

    def delete_thread(self, thread_id: str) -> bool:
        """실행 중이면 thread_busy. 지우면 그 대화의 실행 기록(runs)도 같이 지운다."""
        with self.tx() as db:
            if db.execute("SELECT 1 FROM runs WHERE thread_id = ? AND status = 'running'", (thread_id,)).fetchone():
                raise StoreConflict("thread_busy")
            return db.execute("DELETE FROM threads WHERE id = ?", (thread_id,)).rowcount > 0

    def list_runs(self, limit: int) -> list[sqlite3.Row]:
        return self.query(
            "SELECT r.*, t.title AS thread_title FROM runs r JOIN threads t ON t.id = r.thread_id ORDER BY r.seq DESC LIMIT ?",
            (limit,),
        )
