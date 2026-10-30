"""id → 사실(directory) → 판정(policy) → 줄. 경로(route)는 자원을 이걸로만 꺼낸다 (조회 + 판정을 경로마다 다시 쓰지 않게).

없거나 못 보는 자원 = 404 (있는지 숨김) · 판정 = policy.py · 층 관계(같은 멤버십 층인가) = conductor/scopes.py.
  need  space:   visible(둘러보기 포함) · member · writable(보관 안 됨) · admin
        thread:  view · owner
        project: view · edit · usable(새 대화를 넣거나 옮겨 올 수 있음 = 보관 안 됨)
"""

from __future__ import annotations

import sqlite3
from typing import Literal

from ..scopes import Scopes
from . import policy
from .directory import Directory
from .policy import Actor, Denied, ProjectFacts, SpaceFacts, ThreadFacts

SpaceNeed = Literal["visible", "member", "writable", "admin"]
ThreadNeed = Literal["view", "owner"]
ProjectNeed = Literal["view", "edit", "usable"]


class Guard:
    def __init__(self, directory: Directory, scopes: Scopes) -> None:
        self.directory = directory
        self.scopes = scopes

    def space(self, actor: Actor, space_id: str | None, need: SpaceNeed = "member") -> SpaceFacts:
        """space_id 없음 = 내 스페이스."""
        facts = self.directory.space_facts(space_id or self.directory.personal_space_id(actor.user_id), actor.user_id)
        if facts is None:
            raise Denied(404, "space_not_found")
        {
            "visible": policy.require_space_visible, "member": policy.require_space_member,
            "writable": policy.require_space_writable, "admin": policy.require_space_admin,
        }[need](actor, facts)
        return facts

    def thread(self, actor: Actor, thread_id: str, need: ThreadNeed = "view") -> tuple[sqlite3.Row, ThreadFacts]:
        row = self.directory.store.thread_row(thread_id)
        facts = self.directory.thread_facts(row, actor.user_id) if row is not None else None
        if row is None or facts is None:
            raise Denied(404, "thread_not_found")
        (policy.require_thread_owner if need == "owner" else policy.require_thread_view)(actor, facts)
        return row, facts

    def project(self, actor: Actor, project_id: str, need: ProjectNeed = "view") -> tuple[sqlite3.Row, ProjectFacts]:
        row = self.directory.project(project_id)
        facts = self.directory.project_facts(row, actor.user_id) if row is not None else None
        if row is None or facts is None:
            raise Denied(404, "project_not_found")
        {"view": policy.require_project_view, "edit": policy.require_project_edit, "usable": policy.require_project_usable}[need](actor, facts)
        return row, facts

    def project_in(self, actor: Actor, project_id: str, space: SpaceFacts) -> sqlite3.Row:
        """새 대화 · 옮기기의 목적지: 쓸 수 있고 · 같은 멤버십 층(스페이스) 안. 다른 스페이스 = 409 project_in_other_space."""
        row, _ = self.project(actor, project_id, "usable")
        if self.scopes.ancestor("project", row["id"]) != space.id:
            raise Denied(409, "project_in_other_space")
        return row
