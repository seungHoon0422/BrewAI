"""스페이스 · 프로젝트 · 조직 사람 찾기 (데스크톱 · Bearer · ADR-0011 · slice 04). 꺼내기 + 판정 = auth/guard.py → policy.py.

  GET    /api/spaces                         {spaces: [Space] (내 스페이스 먼저 · 참여한 공유), browse: [Space] (참여 안 한 open), orgs: [Org]}
  POST   /api/spaces                         {name, description?, visibility: open|private, org_id?, members?: [{user_id, role}]} → 201 Space
  GET    /api/spaces/{id}                    Space
  PATCH  /api/spaces/{id}                    {name?, description?, visibility?, archived?} → Space (space admin · 내 스페이스 = 409 personal_space)
  POST   /api/spaces/{id}/join               Space (open 만) · POST …/leave 204 (암묵 admin = 409 implicit_member)
  GET    /api/spaces/{id}/members            [{user_id, display_name, email, role, implicit}]
  PUT    /api/spaces/{id}/members/{uid}      {role: admin|member} → 멤버 (조직 사람만 · 아니면 404 user_not_found)
  DELETE /api/spaces/{id}/members/{uid}      204 (자기 자신 = 나가기)
  GET    /api/org/members?q=&org_id=         [{user_id, display_name, email, role}] (내가 속한 조직만 · 20명)
  GET    /api/spaces/{id}/projects?archived= [Project]
  POST   /api/spaces/{id}/projects           {name, description?, instructions?} → 201 Project (멤버 누구나)
  GET    /api/projects/{id} · PATCH          {name?, description?, instructions?, sort_order?, archived?} → Project (만든 사람 · space admin)
Space   = {id, org_id, org_name, kind, name, description, visibility (personal = null), role, joined, implicit, member_count,
           archived_at, created_at, can_manage, path}
Project = {id, space_id, name, description, instructions, created_by, created_by_name, sort_order, archived_at, created_at, can_edit, path}
path    = [{kind, id, name}] 위 → 아래 · 자기 자신 포함 (conductor/scopes.py)
"""

from __future__ import annotations

import sqlite3
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from .auth import policy
from .auth.accounts import Principal
from .auth.http import accounts_of, client_ip, directory_of, guard_of, require_user, scopes_of
from .auth.policy import Denied, ProjectFacts, SpaceFacts
from .scopes import Crumb

SPACE_NAME_MAX = 60
PROJECT_NAME_MAX = 80
DESCRIPTION_MAX = 500
INSTRUCTIONS_MAX = 4000


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MemberIn(_In):
    user_id: str = Field(max_length=64)
    role: Literal["admin", "member"] = "member"


class SpaceIn(_In):
    name: str = Field(max_length=200)
    description: str = Field(default="", max_length=DESCRIPTION_MAX)
    visibility: Literal["open", "private"] = "open"
    org_id: str | None = Field(default=None, max_length=64)
    members: list[MemberIn] = Field(default_factory=list, max_length=100)


class SpacePatch(_In):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX)
    visibility: Literal["open", "private"] | None = None
    archived: bool | None = None


class RoleIn(_In):
    role: Literal["admin", "member"]


class ProjectIn(_In):
    name: str = Field(max_length=200)
    description: str = Field(default="", max_length=DESCRIPTION_MAX)
    instructions: str = Field(default="", max_length=INSTRUCTIONS_MAX)


class ProjectPatch(_In):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX)
    instructions: str | None = Field(default=None, max_length=INSTRUCTIONS_MAX)
    sort_order: int | None = Field(default=None, ge=0, le=1_000_000)
    archived: bool | None = None


def clean_name(raw: str | None, max_len: int) -> str:
    name = " ".join((raw or "").split())
    if not name or len(name) > max_len:
        raise Denied(422, "bad_name")
    return name


def space_out(row: sqlite3.Row, facts: SpaceFacts, actor: policy.Actor, path: list[Crumb]) -> dict[str, Any]:
    role = policy.space_role(actor, facts)
    return {
        "id": row["id"], "org_id": row["org_id"], "org_name": row["org_name"], "kind": row["kind"], "name": row["name"],
        "description": row["description"], "visibility": row["visibility"] if row["kind"] == "shared" else None,
        "role": role, "joined": role is not None, "implicit": role is not None and row["kind"] == "shared" and facts.direct_role is None,
        "member_count": row["member_count"], "archived_at": row["archived_at"], "created_at": row["created_at"],
        "can_manage": role == "admin" and row["kind"] == "shared", "path": path,
    }


def project_out(row: sqlite3.Row, facts: ProjectFacts, actor: policy.Actor, path: list[Crumb]) -> dict[str, Any]:
    keys = ("id", "space_id", "name", "description", "instructions", "created_by", "created_by_name", "sort_order", "archived_at", "created_at")
    return {k: row[k] for k in keys} | {"can_edit": policy.can_edit_project(actor, facts), "path": path}


def register(user: APIRouter) -> None:
    def out(request: Request, space_id: str, p: Principal) -> dict[str, Any]:
        dirx = directory_of(request)
        row = dirx.space_row(space_id, p.user_id)
        facts = dirx.space_facts(space_id, p.user_id)
        assert row is not None and facts is not None
        return space_out(row, facts, p.actor, scopes_of(request).path("space", space_id))

    def project_view(request: Request, project_id: str, p: Principal) -> dict[str, Any]:
        row, facts = guard_of(request).project(p.actor, project_id)
        return project_out(row, facts, p.actor, scopes_of(request).path("project", project_id))

    def audit(request: Request, p: Principal, action: str, target_type: str, target_id: str, **detail: Any) -> None:
        accounts_of(request).audit(action, actor=p.user_id, target_type=target_type, target_id=target_id, ip=client_ip(request), detail=detail or None)

    # ── 스페이스 ──
    @user.get("/api/spaces")
    async def list_spaces(request: Request, p: Principal = Depends(require_user)) -> dict[str, Any]:
        dirx = directory_of(request)
        items = [(r, f) for r, f in dirx.spaces_for(p.user_id) if policy.can_browse(p.actor, f)]
        paths = scopes_of(request).paths("space", [r["id"] for r, _ in items])
        return {
            "spaces": [space_out(r, f, p.actor, paths[r["id"]]) for r, f in items if policy.space_role(p.actor, f)],
            "browse": [space_out(r, f, p.actor, paths[r["id"]]) for r, f in items if not policy.space_role(p.actor, f)],
            "orgs": [
                {
                    "id": o["id"], "name": o["name"], "role": o["role"],
                    "can_create_spaces": policy.org_can(
                        p.actor, o["role"], "create_shared_space", members_can_create_spaces=bool(o["members_can_create_spaces"])
                    ),
                }
                for o in dirx.user_orgs(p.user_id)
            ],
        }

    @user.post("/api/spaces", status_code=201)
    async def create_space(request: Request, body: SpaceIn, p: Principal = Depends(require_user)) -> dict[str, Any]:
        dirx = directory_of(request)
        orgs = dirx.user_orgs(p.user_id)
        org = next((o for o in orgs if o["id"] == body.org_id), None) if body.org_id else (orgs[0] if orgs else None)
        if org is None:
            raise Denied(404, "org_not_found")
        if not policy.org_can(p.actor, org["role"], "create_shared_space", members_can_create_spaces=bool(org["members_can_create_spaces"])):
            raise Denied(403, "forbidden")
        name = clean_name(body.name, SPACE_NAME_MAX)
        if any(dirx.org_role(org["id"], m.user_id) is None for m in body.members):
            raise Denied(404, "user_not_found")  # 조직 밖 사람은 멤버가 될 수 없다
        with dirx.store.tx() as db:
            space_id = dirx.create_space(
                db, org_id=org["id"], kind="shared", name=name, created_by=p.user_id, description=body.description.strip(), visibility=body.visibility
            )
            for m in body.members:
                if m.user_id != p.user_id:
                    dirx.set_space_role(db, space_id, m.user_id, m.role)
        audit(request, p, "space_create", "space", space_id, visibility=body.visibility)
        return out(request, space_id, p)

    @user.get("/api/spaces/{space_id}")
    async def get_space(request: Request, space_id: str, p: Principal = Depends(require_user)) -> dict[str, Any]:
        guard_of(request).space(p.actor, space_id, "visible")
        return out(request, space_id, p)

    @user.patch("/api/spaces/{space_id}")
    async def patch_space(request: Request, space_id: str, body: SpacePatch, p: Principal = Depends(require_user)) -> dict[str, Any]:
        facts = guard_of(request).space(p.actor, space_id, "admin")
        if facts.kind == "personal":
            raise Denied(409, "personal_space")
        changes: dict[str, Any] = {}
        if body.name is not None:
            changes["name"] = clean_name(body.name, SPACE_NAME_MAX)
        if body.description is not None:
            changes["description"] = body.description.strip()
        if body.visibility is not None:
            changes["visibility"] = body.visibility
        if body.archived is not None:
            changes["archived_at"] = accounts_of(request).now() if body.archived else None
        if changes:
            with directory_of(request).store.tx() as db:
                db.execute(f"UPDATE spaces SET {', '.join(f'{k} = ?' for k in changes)} WHERE id = ?", (*changes.values(), space_id))
            audit(request, p, "space_update", "space", space_id, fields=sorted(changes))
        return out(request, space_id, p)

    @user.post("/api/spaces/{space_id}/join")
    async def join_space(request: Request, space_id: str, p: Principal = Depends(require_user)) -> dict[str, Any]:
        facts = guard_of(request).space(p.actor, space_id, "visible")
        if policy.space_role(p.actor, facts) is None:
            policy.require_can_join(p.actor, facts)
            dirx = directory_of(request)
            with dirx.store.tx() as db:
                dirx.set_space_role(db, space_id, p.user_id, "member")
            audit(request, p, "space_join", "space", space_id)
        return out(request, space_id, p)

    @user.post("/api/spaces/{space_id}/leave", status_code=204)
    async def leave_space(request: Request, space_id: str, p: Principal = Depends(require_user)) -> Response:
        facts = guard_of(request).space(p.actor, space_id)
        if facts.kind == "personal":
            raise Denied(409, "personal_space")
        if facts.direct_role is None:
            raise Denied(409, "implicit_member")  # 조직 owner · admin 은 모든 공유 스페이스의 암묵 admin (떠날 수 없다)
        with directory_of(request).store.tx() as db:
            db.execute("DELETE FROM space_members WHERE space_id = ? AND user_id = ?", (space_id, p.user_id))
        audit(request, p, "space_leave", "space", space_id)
        return Response(status_code=204)

    @user.get("/api/spaces/{space_id}/members")
    async def space_members(request: Request, space_id: str, p: Principal = Depends(require_user)) -> list[dict[str, Any]]:
        facts = guard_of(request).space(p.actor, space_id)
        dirx = directory_of(request)
        keys = ("user_id", "display_name", "email", "role")
        direct = [{k: m[k] for k in keys} | {"implicit": False} for m in dirx.space_members(space_id)]
        implicit = [{k: m[k] for k in keys[:3]} | {"role": "admin", "implicit": True} for m in dirx.implicit_admins(facts)]
        return direct + implicit

    @user.put("/api/spaces/{space_id}/members/{user_id}")
    async def set_member(request: Request, space_id: str, user_id: str, body: RoleIn, p: Principal = Depends(require_user)) -> dict[str, Any]:
        facts = guard_of(request).space(p.actor, space_id, "admin")
        if facts.kind == "personal":
            raise Denied(409, "personal_space")
        dirx = directory_of(request)
        if dirx.org_role(facts.org_id, user_id) is None:
            raise Denied(404, "user_not_found")
        with dirx.store.tx() as db:
            dirx.set_space_role(db, space_id, user_id, body.role)
        audit(request, p, "space_member_set", "space", space_id, user_id=user_id, role=body.role)
        m = next(m for m in dirx.space_members(space_id) if m["user_id"] == user_id)
        return {"user_id": user_id, "display_name": m["display_name"], "email": m["email"], "role": m["role"], "implicit": False}

    @user.delete("/api/spaces/{space_id}/members/{user_id}", status_code=204)
    async def remove_member(request: Request, space_id: str, user_id: str, p: Principal = Depends(require_user)) -> Response:
        if user_id == p.user_id:
            return await leave_space(request, space_id, p)
        facts = guard_of(request).space(p.actor, space_id, "admin")
        if facts.kind == "personal":
            raise Denied(409, "personal_space")
        with directory_of(request).store.tx() as db:
            gone = db.execute("DELETE FROM space_members WHERE space_id = ? AND user_id = ?", (space_id, user_id)).rowcount
        if not gone:
            raise Denied(404, "member_not_found")
        audit(request, p, "space_member_remove", "space", space_id, user_id=user_id)
        return Response(status_code=204)

    @user.get("/api/org/members")
    async def org_members(
        request: Request, q: str = Query("", max_length=100), org_id: str | None = Query(None, max_length=64),
        p: Principal = Depends(require_user),
    ) -> list[dict[str, Any]]:
        dirx = directory_of(request)
        orgs = dirx.user_orgs(p.user_id)
        org = next((o for o in orgs if o["id"] == org_id), None) if org_id else (orgs[0] if orgs else None)
        if org is None:
            raise Denied(404, "org_not_found")
        return [dict(r) for r in dirx.search_org_members(org["id"], q)]

    # ── 프로젝트 (멤버 · 역할 = 스페이스 것) ──
    @user.get("/api/spaces/{space_id}/projects")
    async def list_projects(request: Request, space_id: str, archived: bool = False, p: Principal = Depends(require_user)) -> list[dict[str, Any]]:
        facts = guard_of(request).space(p.actor, space_id)
        rows = directory_of(request).projects(space_id, archived=archived)
        paths = scopes_of(request).paths("project", [r["id"] for r in rows])
        return [
            project_out(r, ProjectFacts(created_by=r["created_by"], archived=r["archived_at"] is not None, space=facts), p.actor, paths[r["id"]])
            for r in rows
        ]

    @user.post("/api/spaces/{space_id}/projects", status_code=201)
    async def create_project(request: Request, space_id: str, body: ProjectIn, p: Principal = Depends(require_user)) -> dict[str, Any]:
        guard_of(request).space(p.actor, space_id, "writable")
        project_id = directory_of(request).create_project(
            space_id=space_id, name=clean_name(body.name, PROJECT_NAME_MAX), description=body.description.strip(),
            instructions=body.instructions.strip(), created_by=p.user_id,
        )
        audit(request, p, "project_create", "project", project_id, space_id=space_id)
        return project_view(request, project_id, p)

    @user.get("/api/projects/{project_id}")
    async def get_project(request: Request, project_id: str, p: Principal = Depends(require_user)) -> dict[str, Any]:
        return project_view(request, project_id, p)

    @user.patch("/api/projects/{project_id}")
    async def patch_project(request: Request, project_id: str, body: ProjectPatch, p: Principal = Depends(require_user)) -> dict[str, Any]:
        guard_of(request).project(p.actor, project_id, "edit")
        changes: dict[str, Any] = {}
        if body.name is not None:
            changes["name"] = clean_name(body.name, PROJECT_NAME_MAX)
        for key in ("description", "instructions"):
            if getattr(body, key) is not None:
                changes[key] = getattr(body, key).strip()
        if body.sort_order is not None:
            changes["sort_order"] = body.sort_order
        if body.archived is not None:
            changes["archived_at"] = accounts_of(request).now() if body.archived else None
        if changes:
            directory_of(request).update_project(project_id, changes)
            audit(request, p, "project_update", "project", project_id, fields=sorted(changes))
        return project_view(request, project_id, p)
