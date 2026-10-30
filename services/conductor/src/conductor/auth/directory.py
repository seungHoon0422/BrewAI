"""조직 > 스페이스 > 프로젝트 · 초대 · 계정 만들기 · 첫 관리자 (ADR-0011). 판정은 하지 않는다 → policy.py 에 사실(*Facts)만 넘긴다.
층 순서 · 경로(breadcrumb) = conductor/scopes.py.

계정 만들기 = 한 트랜잭션: users + 로그인 수단 + org_members + 내 스페이스(personal · 주인 = admin 멤버) + 초대가 준 스페이스.
첫 관리자(bootstrap) = users 가 비어 있고 BREWAI_ADMIN_EMAIL · BREWAI_ADMIN_PASSWORD 가 있을 때만 → 기본 조직 '우리 팀' owner +
instance admin + 내 스페이스 + 옛 대화 · 실행(space_id NULL) 귀속.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
import uuid
from datetime import timedelta
from typing import Any

from . import passwords, tokens
from .accounts import Accounts, default_display_name, normalize_email
from .policy import ProjectFacts, SpaceFacts, ThreadFacts

log = logging.getLogger("conductor.auth")

DEFAULT_ORG_NAME = "우리 팀"
PERSONAL_SPACE_NAME = "내 스페이스"
INVITE_DAYS = 7


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s[:40] or "org"


class Directory:
    def __init__(self, accounts: Accounts) -> None:
        self.accounts = accounts
        self.store = accounts.store

    def _one(self, sql: str, params: tuple[Any, ...]) -> sqlite3.Row | None:
        rows = self.store.query(sql, params)
        return rows[0] if rows else None

    # ── 조직 ──
    def create_org(self, db: sqlite3.Connection, name: str, *, owner_id: str | None, slug: str | None = None) -> str:
        org_id = str(uuid.uuid4())
        base = _slug(slug or name)
        candidate, n = base, 1
        while db.execute("SELECT 1 FROM orgs WHERE slug = ?", (candidate,)).fetchone():
            n += 1
            candidate = f"{base}-{n}"
        db.execute("INSERT INTO orgs (id, name, slug, created_at) VALUES (?, ?, ?, ?)", (org_id, name, candidate, self.accounts.now()))
        if owner_id:
            self.set_org_role(db, org_id, owner_id, "owner")
        return org_id

    def org(self, org_id: str) -> sqlite3.Row | None:
        return self._one("SELECT * FROM orgs WHERE id = ?", (org_id,))

    def org_role(self, org_id: str, user_id: str) -> str | None:
        row = self._one("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?", (org_id, user_id))
        return row["role"] if row else None

    def user_orgs(self, user_id: str) -> list[sqlite3.Row]:
        return self.store.query(
            "SELECT o.*, m.role FROM org_members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? ORDER BY m.joined_at, o.name", (user_id,)
        )

    def set_org_role(self, db: sqlite3.Connection, org_id: str, user_id: str, role: str) -> None:
        db.execute(
            "INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)"
            " ON CONFLICT (org_id, user_id) DO UPDATE SET role = excluded.role",
            (org_id, user_id, role, self.accounts.now()),
        )

    def owner_count(self, db: sqlite3.Connection, org_id: str) -> int:
        return db.execute("SELECT COUNT(*) FROM org_members WHERE org_id = ? AND role = 'owner'", (org_id,)).fetchone()[0]

    def remove_org_member(self, db: sqlite3.Connection, org_id: str, user_id: str) -> None:
        """조직에서 빼면 그 조직 공유 스페이스 멤버십도 같이 (내 스페이스는 그 사람 것 = 그대로)."""
        db.execute("DELETE FROM space_members WHERE user_id = ? AND space_id IN (SELECT id FROM spaces WHERE org_id = ? AND kind = 'shared')", (user_id, org_id))
        db.execute("DELETE FROM org_members WHERE org_id = ? AND user_id = ?", (org_id, user_id))

    def domain_org(self, hd: str) -> sqlite3.Row | None:
        return self._one("SELECT * FROM orgs WHERE join_policy = 'domain_auto' AND lower(google_hd) = lower(?)", (hd,))

    def search_org_members(self, org_id: str, q: str, limit: int = 20) -> list[sqlite3.Row]:
        like = f"%{q.strip().lower()}%"
        return self.store.query(
            "SELECT u.id AS user_id, u.display_name, u.email, m.role FROM org_members m JOIN users u ON u.id = m.user_id"
            " WHERE m.org_id = ? AND u.status = 'active' AND (lower(u.display_name) LIKE ? OR u.email_norm LIKE ?)"
            " ORDER BY u.display_name, u.email_norm LIMIT ?",
            (org_id, like, like, limit),
        )

    # ── 스페이스 ──
    def create_space(
        self, db: sqlite3.Connection, *, org_id: str, kind: str, name: str, created_by: str | None,
        description: str = "", visibility: str = "private",
    ) -> str:
        space_id = str(uuid.uuid4())
        db.execute(
            "INSERT INTO spaces (id, org_id, kind, owner_user_id, name, description, visibility, created_by, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (space_id, org_id, kind, created_by if kind == "personal" else None, name, description, visibility, created_by, self.accounts.now()),
        )
        if created_by:
            self.set_space_role(db, space_id, created_by, "admin")
        return space_id

    def set_space_role(self, db: sqlite3.Connection, space_id: str, user_id: str, role: str) -> None:
        db.execute(
            "INSERT INTO space_members (space_id, user_id, role, added_at) VALUES (?, ?, ?, ?)"
            " ON CONFLICT (space_id, user_id) DO UPDATE SET role = excluded.role",
            (space_id, user_id, role, self.accounts.now()),
        )

    def space(self, space_id: str) -> sqlite3.Row | None:
        return self._one("SELECT * FROM spaces WHERE id = ?", (space_id,))

    def personal_space_id(self, user_id: str) -> str | None:
        row = self._one("SELECT id FROM spaces WHERE owner_user_id = ? AND kind = 'personal'", (user_id,))
        return row["id"] if row else None

    def space_facts(self, space_id: str | None, user_id: str) -> SpaceFacts | None:
        if not space_id:
            return None
        row = self._one(
            "SELECT s.*, (SELECT role FROM space_members WHERE space_id = s.id AND user_id = ?) AS direct_role,"
            " (SELECT role FROM org_members WHERE org_id = s.org_id AND user_id = ?) AS org_role FROM spaces s WHERE s.id = ?",
            (user_id, user_id, space_id),
        )
        return self._facts(row) if row else None

    @staticmethod
    def _facts(row: sqlite3.Row) -> SpaceFacts:
        return SpaceFacts(
            id=row["id"], org_id=row["org_id"], kind=row["kind"], owner_user_id=row["owner_user_id"], visibility=row["visibility"],
            archived=row["archived_at"] is not None, direct_role=row["direct_role"], org_role=row["org_role"],
        )

    def spaces_for(self, user_id: str) -> list[tuple[sqlite3.Row, SpaceFacts]]:
        """판정 후보 = 내 스페이스 + 내가 속한 조직의 shared 전부 (보이는지는 policy.can_browse 가 정한다)."""
        rows = self.store.query(
            "SELECT s.*, o.name AS org_name, (SELECT role FROM space_members WHERE space_id = s.id AND user_id = ?) AS direct_role,"
            " (SELECT role FROM org_members WHERE org_id = s.org_id AND user_id = ?) AS org_role,"
            " (SELECT COUNT(*) FROM space_members WHERE space_id = s.id) AS member_count"
            " FROM spaces s JOIN orgs o ON o.id = s.org_id"
            " WHERE (s.kind = 'personal' AND s.owner_user_id = ?)"
            " OR (s.kind = 'shared' AND s.org_id IN (SELECT org_id FROM org_members WHERE user_id = ?))"
            " ORDER BY s.kind = 'personal' DESC, lower(s.name), s.created_at",  # personal 먼저
            (user_id, user_id, user_id, user_id),
        )
        return [(r, self._facts(r)) for r in rows]

    def space_row(self, space_id: str, user_id: str) -> sqlite3.Row | None:
        return next((r for r, _ in self.spaces_for(user_id) if r["id"] == space_id), None)

    def space_members(self, space_id: str) -> list[sqlite3.Row]:
        return self.store.query(
            "SELECT m.user_id, m.role, m.added_at, u.display_name, u.email FROM space_members m JOIN users u ON u.id = m.user_id"
            " WHERE m.space_id = ? ORDER BY m.role, u.display_name",
            (space_id,),
        )

    def implicit_admins(self, space: SpaceFacts) -> list[sqlite3.Row]:
        """shared 의 암묵 admin = 조직 owner · admin 중 직접 멤버가 아닌 사람."""
        if space.kind != "shared":
            return []
        return self.store.query(
            "SELECT m.user_id, m.role AS org_role, u.display_name, u.email FROM org_members m JOIN users u ON u.id = m.user_id"
            " WHERE m.org_id = ? AND m.role IN ('owner', 'admin')"
            " AND m.user_id NOT IN (SELECT user_id FROM space_members WHERE space_id = ?) ORDER BY u.display_name",
            (space.org_id, space.id),
        )

    def thread_facts(self, thread: sqlite3.Row, user_id: str) -> ThreadFacts | None:
        space = self.space_facts(thread["space_id"], user_id)
        return ThreadFacts(user_id=thread["user_id"], visibility=thread["visibility"], space=space) if space else None

    # ── 프로젝트 ──
    def project(self, project_id: str | None) -> sqlite3.Row | None:
        if not project_id:
            return None
        return self._one(
            "SELECT p.*, u.display_name AS created_by_name FROM projects p LEFT JOIN users u ON u.id = p.created_by WHERE p.id = ?",
            (project_id,),
        )

    def project_facts(self, project: sqlite3.Row, user_id: str) -> ProjectFacts | None:
        space = self.space_facts(project["space_id"], user_id)
        return ProjectFacts(created_by=project["created_by"], archived=project["archived_at"] is not None, space=space) if space else None

    def projects(self, space_id: str, *, archived: bool) -> list[sqlite3.Row]:
        return self.store.query(
            "SELECT p.*, u.display_name AS created_by_name FROM projects p LEFT JOIN users u ON u.id = p.created_by"
            f" WHERE p.space_id = ? AND p.archived_at IS {'NOT ' if archived else ''}NULL ORDER BY p.sort_order, p.created_at",
            (space_id,),
        )

    def create_project(self, *, space_id: str, name: str, description: str, instructions: str, created_by: str) -> str:
        project_id = str(uuid.uuid4())
        with self.store.tx() as db:
            order = db.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM projects WHERE space_id = ?", (space_id,)).fetchone()[0]
            db.execute(
                "INSERT INTO projects (id, space_id, name, description, instructions, created_by, sort_order, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (project_id, space_id, name, description, instructions, created_by, order, self.accounts.now()),
            )
        return project_id

    def update_project(self, project_id: str, changes: dict[str, Any]) -> None:
        cols = {k: v for k, v in changes.items() if k in ("name", "description", "instructions", "sort_order", "archived_at")}
        if cols:
            with self.store.tx() as db:
                db.execute(f"UPDATE projects SET {', '.join(f'{c} = ?' for c in cols)} WHERE id = ?", (*cols.values(), project_id))

    # ── 계정 만들기 ──
    def create_account(
        self, db: sqlite3.Connection, *, email: str, display_name: str, org_id: str, org_role: str,
        space_ids: list[str] = (), password_hash: str | None = None, instance_role: str = "user",  # type: ignore[assignment]
        email_verified: bool = False,
    ) -> str:
        user_id = self.accounts.create_user(
            db, email=email, display_name=display_name, instance_role=instance_role, password_hash=password_hash, email_verified=email_verified
        )
        self.set_org_role(db, org_id, user_id, org_role)
        personal = self.create_space(db, org_id=org_id, kind="personal", name=PERSONAL_SPACE_NAME, created_by=user_id)
        db.execute("UPDATE users SET last_space_id = ? WHERE id = ?", (personal, user_id))
        for sid in space_ids:  # 초대가 준 공유 스페이스 (그 조직 · 보관 안 된 것만)
            if db.execute("SELECT 1 FROM spaces WHERE id = ? AND org_id = ? AND kind = 'shared' AND archived_at IS NULL", (sid, org_id)).fetchone():
                self.set_space_role(db, sid, user_id, "member")
        return user_id

    # ── 초대 ──
    def create_invite(
        self, *, org_id: str, created_by: str, email: str | None, org_role: str, space_ids: list[str], max_uses: int, days: int
    ) -> tuple[str, str]:
        """(invite_id, 코드). 코드는 이때 한 번만 보인다 (DB 엔 sha256)."""
        invite_id, code = str(uuid.uuid4()), tokens.new_invite_code()
        with self.store.tx() as db:
            db.execute(
                "INSERT INTO invites (id, code_hash, org_id, email, org_role, space_ids, max_uses, created_by, created_at, expires_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    invite_id, tokens.digest(code), org_id, email, org_role, json.dumps(space_ids), max_uses, created_by,
                    self.accounts.now(), self.accounts.at(timedelta(days=days).total_seconds()),
                ),
            )
        return invite_id, code

    def live_invite(self, code: str | None, db: sqlite3.Connection | None = None) -> sqlite3.Row | None:
        """쓸 수 있는 초대 (모양 · 만료 · 취소 · 횟수)."""
        norm = tokens.normalize_invite(code or "")
        if norm is None:
            return None
        sql = "SELECT * FROM invites WHERE code_hash = ? AND revoked_at IS NULL AND expires_at > ? AND uses < max_uses"
        params = (tokens.digest(norm), self.accounts.now())
        if db is not None:
            return db.execute(sql, params).fetchone()
        return self._one(sql, params)

    def redeem_invite(self, db: sqlite3.Connection, invite_id: str) -> bool:
        return db.execute("UPDATE invites SET uses = uses + 1 WHERE id = ? AND uses < max_uses", (invite_id,)).rowcount == 1

    def invite_space_names(self, invite: sqlite3.Row) -> list[dict[str, str]]:
        ids = json.loads(invite["space_ids"] or "[]")
        if not ids:
            return []
        rows = self.store.query(f"SELECT id, name FROM spaces WHERE id IN ({','.join('?' * len(ids))}) AND kind = 'shared'", tuple(ids))
        return [{"id": r["id"], "name": r["name"]} for r in rows]

    def signup(
        self, invite_code: str, *, email: str, display_name: str | None, password_hash: str | None = None,
        google: dict[str, Any] | None = None,
    ) -> str:
        """초대 코드로 가입 (한 트랜잭션: 초대 확인 · 사용 횟수 · 계정). 실패 = ValueError(code)."""
        email_norm = normalize_email(email)
        if email_norm is None:
            raise ValueError("bad_email")
        with self.store.tx() as db:
            invite = self.live_invite(invite_code, db)
            if invite is None:
                raise ValueError("invite_invalid")
            if invite["email"] and normalize_email(invite["email"]) != email_norm:
                raise ValueError("invite_email_mismatch")
            if db.execute("SELECT 1 FROM users WHERE email_norm = ?", (email_norm,)).fetchone():
                raise ValueError("email_taken")
            user_id = self.create_account(
                db, email=email, display_name=display_name or default_display_name(email), org_id=invite["org_id"],
                org_role=invite["org_role"], space_ids=json.loads(invite["space_ids"] or "[]"), password_hash=password_hash,
                email_verified=google is not None or bool(invite["email"]),  # 열린 초대 + 비밀번호 = 이메일 주인 미확인
            )
            if google:
                self.accounts.link_google(db, user_id, **google)
            self.redeem_invite(db, invite["id"])
            self.accounts.audit(
                "signup", actor=user_id, target_type="invite", target_id=invite["id"], detail={"method": "google" if google else "password"}, db=db
            )
        return user_id

    # ── 첫 관리자 ──
    def bootstrap(self, email: str | None, password: str | None) -> str | None:
        """users 가 비었을 때만. 값이 없거나 약하면 만들지 않는다 (→ /api/auth/state needs_bootstrap). 만든 사람 id."""
        if self.accounts.count_users() > 0:
            return None
        email_norm = normalize_email(email)
        if email_norm is None or not password:
            log.warning("첫 관리자 없음: .env 에 BREWAI_ADMIN_EMAIL · BREWAI_ADMIN_PASSWORD 를 넣고 다시 켜세요 (npm run dev · node scripts/stack.mjs secrets 가 만들어 줘요)")
            return None
        if passwords.problem(password, self.accounts.password_min):
            log.warning("첫 관리자 없음: BREWAI_ADMIN_PASSWORD 가 %d자보다 짧아요 → 그 줄을 지우고 npm run dev 를 다시", self.accounts.password_min)
            return None
        hashed = passwords.hash_password(password)
        with self.store.tx() as db:
            if db.execute("SELECT 1 FROM users").fetchone():
                return None  # 다른 프로세스가 먼저
            org = db.execute("SELECT id FROM orgs ORDER BY created_at LIMIT 1").fetchone()
            org_id = org["id"] if org else self.create_org(db, DEFAULT_ORG_NAME, owner_id=None, slug="team")
            user_id = self.create_account(
                db, email=email or email_norm, display_name=default_display_name(email_norm), org_id=org_id, org_role="owner",
                password_hash=hashed, instance_role="admin", email_verified=True,
            )
            personal = db.execute("SELECT id FROM spaces WHERE owner_user_id = ? AND kind = 'personal'", (user_id,)).fetchone()["id"]
            adopted = db.execute(
                "UPDATE threads SET space_id = ?, user_id = ?, visibility = 'private' WHERE space_id IS NULL", (personal, user_id)
            ).rowcount
            db.execute("UPDATE runs SET space_id = ?, user_id = ?, org_id = ? WHERE space_id IS NULL", (personal, user_id, org_id))
            self.accounts.audit("bootstrap", actor=user_id, target_type="user", target_id=user_id, detail={"adopted_threads": adopted}, db=db)
        # warning = 로깅 설정 없이도 uvicorn 줄 옆에 보인다 (첫 실행에 어디로 로그인하는지)
        log.warning("첫 관리자 %s · 비밀번호는 .env BREWAI_ADMIN_PASSWORD · 옛 대화 %d개 → 내 스페이스", email_norm, adopted)
        return user_id
