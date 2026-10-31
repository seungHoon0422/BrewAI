"""관리자 콘솔 '사용자·조직' (쿠키 + CSRF + instance admin · slice 04). 전역 조회는 여기서만.

  GET    /api/admin/users                     [AdminUser]
  PATCH  /api/admin/users/{id}                {status?: active|disabled, instance_role?: admin|user, display_name?} → AdminUser
                                              (비활성화 = 세션 전부 폐기 · 자기 자신 = 409 cannot_change_self)
  DELETE /api/admin/users/{id}/sessions       {revoked: n} (세션 끊기)
  POST   /api/admin/users/{id}/reset-code     {code: bwp_…, expires_at} (1회 표시 · 30분 · audit)
  GET    /api/admin/orgs · POST {name, slug?} · PATCH /api/admin/orgs/{id} {name?, join_policy?, google_hd?, members_can_create_spaces?}
  GET    /api/admin/orgs/{id}/members · PUT …/members/{uid} {role} · DELETE …/members/{uid}  (마지막 owner = 409 last_owner)
  GET    /api/admin/spaces                    {shared: [...], personal_count} (내 스페이스는 개수만 — 내용은 본인만)
  GET    /api/admin/invites · POST {org_id?, email?, org_role, space_ids?, max_uses?, days?} → {invite, code} (코드 1회 표시)
  DELETE /api/admin/invites/{id}              204 (취소)
  GET    /api/admin/audit?limit=              최근 감사 기록
  GET    /api/admin/usage?from&to&tz&group=day|org|space|user|model&org&space&user&model&limit&series
                                              {from, to, tz, days, group, filters, totals, previous, series: [하루], groups: [묶음], others}
                                              (usage.py · 숫자만 — 질문 · 답 · 제목 없음. space=personal = 내 스페이스 전부 한 줄)
  GET    /api/admin/usage/gateway?from&to&tz  {status: ok|down|error|auth, code, last_sync_at, models: {개수}, by_model: [연결 · 실패율]}
                                              (게이트웨이가 꺼져도 200 = 마지막으로 본 목록 + status)
  GET    /api/admin/stats                     {users: {total, active, disabled, admins}, orgs, spaces: {shared, archived, personal},
                                              invites_active, active_users: {d7, d30}}
  기간: from · to = YYYY-MM-DD (포함 · tz 기준 날짜) · 없으면 오늘까지 7일 · 최대 366일 (틀리면 422 bad_date | bad_range)
AdminUser = {id, email, display_name, instance_role, status, providers, orgs: [{id, name, role}], last_login_at, created_at, session_count}
"""

from __future__ import annotations

import json
import re
from datetime import UTC, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from . import usage
from .auth import tokens
from .auth.accounts import RESET_S, Principal, clean_display_name, normalize_email
from .auth.directory import INVITE_DAYS
from .auth.http import accounts_of, client_ip, directory_of, require_admin
from .auth.policy import Denied
from .gateway import GatewayError

_HD = re.compile(r"^[a-z0-9.-]{1,253}\.[a-z]{2,}$")


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class UserPatch(_In):
    status: Literal["active", "disabled"] | None = None
    instance_role: Literal["admin", "user"] | None = None
    display_name: str | None = Field(default=None, max_length=200)


class OrgIn(_In):
    name: str = Field(max_length=200)
    slug: str | None = Field(default=None, max_length=40)


class OrgPatch(_In):
    name: str | None = Field(default=None, max_length=200)
    join_policy: Literal["invite", "domain_auto"] | None = None
    google_hd: str | None = Field(default=None, max_length=253)
    members_can_create_spaces: bool | None = None


class OrgRoleIn(_In):
    role: Literal["owner", "admin", "member"]


class InviteIn(_In):
    org_id: str | None = Field(default=None, max_length=64)
    email: str | None = Field(default=None, max_length=320)
    org_role: Literal["admin", "member"] = "member"
    space_ids: list[str] = Field(default_factory=list, max_length=50)
    max_uses: int = Field(default=1, ge=1, le=100)
    days: int = Field(default=INVITE_DAYS, ge=1, le=30)


def _name(raw: str | None, max_len: int = 60) -> str:
    name = " ".join((raw or "").split())
    if not name or len(name) > max_len:
        raise Denied(422, "bad_name")
    return name


def register(admin: APIRouter) -> None:
    def audit(request: Request, p: Principal, action: str, target_type: str, target_id: str, **detail: Any) -> None:
        accounts_of(request).audit(action, actor=p.user_id, target_type=target_type, target_id=target_id, ip=client_ip(request), detail=detail or None)

    def user_rows(request: Request, user_id: str | None = None) -> list[dict[str, Any]]:
        acc = accounts_of(request)
        now = acc.now()
        where = "WHERE u.id = ?" if user_id else ""
        rows = acc.store.query(
            "SELECT u.*, (SELECT group_concat(provider) FROM identities WHERE user_id = u.id) AS providers,"
            " (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.idle_expires_at > ? AND s.abs_expires_at > ?)"
            f" AS session_count FROM users u {where} ORDER BY u.created_at",
            (now, now, *([user_id] if user_id else [])),
        )
        orgs: dict[str, list[dict[str, Any]]] = {}
        for m in acc.store.query("SELECT m.user_id, o.id, o.name, m.role FROM org_members m JOIN orgs o ON o.id = m.org_id ORDER BY o.name"):
            orgs.setdefault(m["user_id"], []).append({"id": m["id"], "name": m["name"], "role": m["role"]})
        keys = ("id", "email", "display_name", "instance_role", "status", "last_login_at", "created_at", "session_count")
        return [
            {k: r[k] for k in keys} | {"providers": sorted((r["providers"] or "").split(",")) if r["providers"] else [], "orgs": orgs.get(r["id"], [])}
            for r in rows
        ]

    def one_user(request: Request, user_id: str) -> dict[str, Any]:
        rows = user_rows(request, user_id)
        if not rows:
            raise Denied(404, "user_not_found")
        return rows[0]

    def org_rows(request: Request, org_id: str | None = None) -> list[dict[str, Any]]:
        where = "WHERE o.id = ?" if org_id else ""
        rows = accounts_of(request).store.query(
            "SELECT o.*, (SELECT COUNT(*) FROM org_members WHERE org_id = o.id) AS member_count,"
            " (SELECT COUNT(*) FROM spaces WHERE org_id = o.id AND kind = 'shared') AS space_count"
            f" FROM orgs o {where} ORDER BY o.created_at",
            (org_id,) if org_id else (),
        )
        return [dict(r) | {"members_can_create_spaces": bool(r["members_can_create_spaces"])} for r in rows]

    def one_org(request: Request, org_id: str) -> dict[str, Any]:
        rows = org_rows(request, org_id)
        if not rows:
            raise Denied(404, "org_not_found")
        return rows[0]

    def invite_rows(request: Request, invite_id: str | None = None) -> list[dict[str, Any]]:
        acc, dirx = accounts_of(request), directory_of(request)
        now = acc.now()
        where = "WHERE i.id = ?" if invite_id else ""
        rows = acc.store.query(
            "SELECT i.*, o.name AS org_name, u.display_name AS created_by_name FROM invites i JOIN orgs o ON o.id = i.org_id"
            f" LEFT JOIN users u ON u.id = i.created_by {where} ORDER BY i.created_at DESC",
            (invite_id,) if invite_id else (),
        )
        out = []
        for r in rows:
            status = (
                "revoked" if r["revoked_at"] else "used_up" if r["uses"] >= r["max_uses"] else "expired" if r["expires_at"] <= now else "active"
            )
            keys = ("id", "org_id", "org_name", "email", "org_role", "max_uses", "uses", "created_by_name", "created_at", "expires_at", "revoked_at")
            out.append({k: r[k] for k in keys} | {"spaces": dirx.invite_space_names(r), "status": status})
        return out

    # ── 사용자 ──
    @admin.get("/api/admin/users")
    async def list_users(request: Request) -> list[dict[str, Any]]:
        return user_rows(request)

    @admin.patch("/api/admin/users/{user_id}")
    async def patch_user(request: Request, user_id: str, body: UserPatch, p: Principal = Depends(require_admin)) -> dict[str, Any]:
        one_user(request, user_id)
        acc = accounts_of(request)
        changes: dict[str, Any] = {}
        if body.display_name is not None:
            if (name := clean_display_name(body.display_name)) is None:
                raise Denied(422, "bad_display_name")
            changes["display_name"] = name
        for key in ("status", "instance_role"):
            if getattr(body, key) is not None:
                changes[key] = getattr(body, key)
        if user_id == p.user_id and (changes.get("status") == "disabled" or changes.get("instance_role") == "user"):
            raise Denied(409, "cannot_change_self")  # 마지막 관리자가 스스로 잠그지 않게
        if changes:
            with acc.store.tx() as db:
                db.execute(f"UPDATE users SET {', '.join(f'{k} = ?' for k in changes)} WHERE id = ?", (*changes.values(), user_id))
                if changes.get("status") == "disabled":
                    acc.revoke_user(user_id, "disabled", db=db)
            audit(request, p, "user_update", "user", user_id, **{k: v for k, v in changes.items() if k != "display_name"})
        return one_user(request, user_id)

    @admin.delete("/api/admin/users/{user_id}/sessions")
    async def revoke_sessions(request: Request, user_id: str, p: Principal = Depends(require_admin)) -> dict[str, int]:
        one_user(request, user_id)
        n = accounts_of(request).revoke_user(user_id, "admin", keep=p.session_id)
        audit(request, p, "sessions_revoked", "user", user_id, count=n)
        return {"revoked": n}

    @admin.post("/api/admin/users/{user_id}/reset-code")
    async def reset_code(request: Request, user_id: str, p: Principal = Depends(require_admin)) -> dict[str, Any]:
        one_user(request, user_id)
        acc = accounts_of(request)
        code = acc.issue_once("reset", RESET_S, prefix=tokens.RESET, user_id=user_id)
        audit(request, p, "reset_code_issued", "user", user_id)
        return {"code": code, "expires_at": acc.at(RESET_S)}

    # ── 조직 ──
    @admin.get("/api/admin/orgs")
    async def list_orgs(request: Request) -> list[dict[str, Any]]:
        return org_rows(request)

    @admin.post("/api/admin/orgs", status_code=201)
    async def create_org(request: Request, body: OrgIn, p: Principal = Depends(require_admin)) -> dict[str, Any]:
        dirx = directory_of(request)
        with dirx.store.tx() as db:
            org_id = dirx.create_org(db, _name(body.name), owner_id=p.user_id, slug=body.slug)
        audit(request, p, "org_create", "org", org_id)
        return one_org(request, org_id)

    @admin.patch("/api/admin/orgs/{org_id}")
    async def patch_org(request: Request, org_id: str, body: OrgPatch, p: Principal = Depends(require_admin)) -> dict[str, Any]:
        current = one_org(request, org_id)
        changes: dict[str, Any] = {}
        if body.name is not None:
            changes["name"] = _name(body.name)
        if "google_hd" in body.model_fields_set:
            hd = (body.google_hd or "").strip().lower() or None
            if hd is not None and not _HD.match(hd):
                raise Denied(422, "bad_google_hd")
            changes["google_hd"] = hd
        if body.join_policy is not None:
            changes["join_policy"] = body.join_policy
        if body.members_can_create_spaces is not None:
            changes["members_can_create_spaces"] = int(body.members_can_create_spaces)
        if changes.get("join_policy", current["join_policy"]) == "domain_auto" and not changes.get("google_hd", current["google_hd"]):
            raise Denied(422, "google_hd_required")
        if changes:
            with accounts_of(request).store.tx() as db:
                db.execute(f"UPDATE orgs SET {', '.join(f'{k} = ?' for k in changes)} WHERE id = ?", (*changes.values(), org_id))
            audit(request, p, "org_update", "org", org_id, **changes)
        return one_org(request, org_id)

    @admin.get("/api/admin/orgs/{org_id}/members")
    async def list_org_members(request: Request, org_id: str) -> list[dict[str, Any]]:
        one_org(request, org_id)
        return [
            dict(r) for r in accounts_of(request).store.query(
                "SELECT u.id AS user_id, u.email, u.display_name, u.status, m.role, m.joined_at FROM org_members m"
                " JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY m.role = 'member', u.display_name",
                (org_id,),
            )
        ]

    @admin.put("/api/admin/orgs/{org_id}/members/{user_id}")
    async def set_org_member(request: Request, org_id: str, user_id: str, body: OrgRoleIn, p: Principal = Depends(require_admin)) -> dict[str, Any]:
        one_org(request, org_id)
        one_user(request, user_id)
        dirx = directory_of(request)
        with dirx.store.tx() as db:
            current = db.execute("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?", (org_id, user_id)).fetchone()
            if current and current["role"] == "owner" and body.role != "owner" and dirx.owner_count(db, org_id) <= 1:
                raise Denied(409, "last_owner")
            dirx.set_org_role(db, org_id, user_id, body.role)
        audit(request, p, "org_member_set", "org", org_id, user_id=user_id, role=body.role)
        return {"org_id": org_id, "user_id": user_id, "role": body.role}

    @admin.delete("/api/admin/orgs/{org_id}/members/{user_id}", status_code=204)
    async def remove_org_member(request: Request, org_id: str, user_id: str, p: Principal = Depends(require_admin)) -> Response:
        one_org(request, org_id)
        dirx = directory_of(request)
        with dirx.store.tx() as db:
            current = db.execute("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?", (org_id, user_id)).fetchone()
            if current is None:
                raise Denied(404, "member_not_found")
            if current["role"] == "owner" and dirx.owner_count(db, org_id) <= 1:
                raise Denied(409, "last_owner")
            dirx.remove_org_member(db, org_id, user_id)
        audit(request, p, "org_member_remove", "org", org_id, user_id=user_id)
        return Response(status_code=204)

    # ── 스페이스 (공유만 · 내 스페이스는 개수) ──
    @admin.get("/api/admin/spaces")
    async def list_spaces(request: Request) -> dict[str, Any]:
        store = accounts_of(request).store
        shared = store.query(
            "SELECT s.id, s.org_id, o.name AS org_name, s.name, s.description, s.visibility, s.archived_at, s.created_at,"
            " (SELECT COUNT(*) FROM space_members WHERE space_id = s.id) AS member_count,"
            " (SELECT COUNT(*) FROM projects WHERE space_id = s.id AND archived_at IS NULL) AS project_count"
            " FROM spaces s JOIN orgs o ON o.id = s.org_id WHERE s.kind = 'shared' ORDER BY o.name, lower(s.name)"
        )
        personal = store.query("SELECT COUNT(*) AS n FROM spaces WHERE kind = 'personal'")[0]["n"]
        return {"shared": [dict(r) for r in shared], "personal_count": personal}

    # ── 초대 ──
    @admin.get("/api/admin/invites")
    async def list_invites(request: Request) -> list[dict[str, Any]]:
        return invite_rows(request)

    @admin.post("/api/admin/invites", status_code=201)
    async def create_invite(request: Request, body: InviteIn, p: Principal = Depends(require_admin)) -> dict[str, Any]:
        dirx = directory_of(request)
        org_id = body.org_id or next((o["id"] for o in org_rows(request)), None)
        if org_id is None or dirx.org(org_id) is None:
            raise Denied(404, "org_not_found")
        email = None
        if body.email and body.email.strip():
            if normalize_email(body.email) is None:
                raise Denied(422, "bad_email")
            email = body.email.strip()
        for sid in body.space_ids:
            space = dirx.space(sid)
            if space is None or space["org_id"] != org_id or space["kind"] != "shared":
                raise Denied(404, "space_not_found")
        invite_id, code = dirx.create_invite(
            org_id=org_id, created_by=p.user_id, email=email, org_role=body.org_role, space_ids=list(dict.fromkeys(body.space_ids)),
            max_uses=body.max_uses, days=body.days,
        )
        audit(request, p, "invite_create", "invite", invite_id, org_role=body.org_role, max_uses=body.max_uses)
        return {"invite": invite_rows(request, invite_id)[0], "code": code}

    @admin.delete("/api/admin/invites/{invite_id}", status_code=204)
    async def revoke_invite(request: Request, invite_id: str, p: Principal = Depends(require_admin)) -> Response:
        acc = accounts_of(request)
        with acc.store.tx() as db:
            if not db.execute("UPDATE invites SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?", (acc.now(), invite_id)).rowcount:
                raise Denied(404, "invite_not_found")
        audit(request, p, "invite_revoke", "invite", invite_id)
        return Response(status_code=204)

    # ── 감사 기록 ──
    @admin.get("/api/admin/audit")
    async def list_audit(request: Request, limit: int = Query(100, ge=1, le=500)) -> list[dict[str, Any]]:
        rows = accounts_of(request).store.query(
            "SELECT a.*, u.display_name AS actor_name FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id ORDER BY a.seq DESC LIMIT ?",
            (limit,),
        )
        return [dict(r) | {"detail": json.loads(r["detail"]) if r["detail"] else None} for r in rows]

    # ── 사용량 (usage.py · 숫자만) ──
    def usage_window(request: Request, start: str | None, end: str | None, tz: int) -> usage.Window:
        try:
            return usage.window(start, end, tz=tz, now=accounts_of(request).clock())
        except usage.BadRange as e:
            raise Denied(422, str(e)) from e

    def model_labels(request: Request) -> dict[str, str]:
        return {r.gateway_id: r.label for r in request.app.state.registry.rows()}

    # def (async 아님) = 스레드풀에서 집계 → 긴 기간 집계가 이벤트 루프(채팅 스트림)를 막지 않는다. 잠금은 store 의 RLock
    @admin.get("/api/admin/usage")
    def get_usage(
        request: Request,
        start: str | None = Query(None, alias="from", max_length=10), end: str | None = Query(None, alias="to", max_length=10),
        tz: int = Query(0, ge=-720, le=840), group: usage.Group = Query("day"),
        org: str | None = Query(None, max_length=64), space: str | None = Query(None, max_length=64),
        user: str | None = Query(None, max_length=64), model: str | None = Query(None, max_length=200),
        limit: int = Query(50, ge=1, le=200), series: bool = Query(True),
    ) -> dict[str, Any]:
        w = usage_window(request, start, end, tz)
        store = accounts_of(request).store
        labels = model_labels(request)
        with store.read() as db:
            return usage.summary(
                db, w, usage.Filters(org=org, space=space, user=user, model=model), group, limit=limit, model_labels=labels, series=series,
            )

    @admin.get("/api/admin/usage/gateway")
    async def get_gateway_status(
        request: Request,
        start: str | None = Query(None, alias="from", max_length=10), end: str | None = Query(None, alias="to", max_length=10),
        tz: int = Query(0, ge=-720, le=840),
    ) -> dict[str, Any]:
        w = usage_window(request, start, end, tz)
        registry = request.app.state.registry
        status, code = "ok", None
        try:
            await registry.refresh()  # 카탈로그 캐시(30초) — 꺼져 있으면 마지막으로 본 목록으로
        except GatewayError as e:
            code = e.code
            status = "down" if e.code == "gateway_unreachable" else "auth" if e.code == "gateway_auth_failed" else "error"
        store = accounts_of(request).store
        rows = registry.rows()
        health = store.model_health()
        with store.read() as db:
            errors = usage.model_errors(db, w)
        counts = {"total": 0, "exposed": 0, "candidate": 0, "hidden": 0, "missing": 0, "failing": 0}
        by_model = []
        for r in rows:
            used = errors.get(r.gateway_id)
            if not r.is_chat and not used:
                continue  # 임베딩 등 = 채팅에 안 쓰는 모델
            state, hcode, at = usage.health_state(health.get(r.gateway_id))
            counts[r.state] += 1
            counts["total"] += r.status == "present"
            counts["failing"] += r.status == "present" and state == "error"
            h = health.get(r.gateway_id)
            by_model.append({
                "id": r.gateway_id, "label": r.label, "provider": r.provider, "state": r.state, "health": state, "health_code": hcode,
                "health_at": at, "health_source": h["last_source"] if h else None,
                **(used or {"runs": 0, "errors": 0, "error_rate": 0.0}),
            })
        by_model.sort(key=lambda m: (-m["errors"], -m["runs"], m["label"].lower()))
        return {
            "status": status, "code": code, "last_sync_at": registry.last_sync_at(), "from": w.start.isoformat(), "to": w.end.isoformat(),
            "models": counts, "by_model": by_model,
        }

    @admin.get("/api/admin/stats")
    async def get_stats(request: Request) -> dict[str, Any]:
        acc = accounts_of(request)
        q = lambda sql, *a: acc.store.query(sql, a)[0][0]  # noqa: E731
        now = acc.clock()
        iso = lambda d: (now - timedelta(days=d)).astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")  # noqa: E731
        with acc.store.read() as db:
            d7, d30 = usage.active_users(db, iso(7)), usage.active_users(db, iso(30))
        return {
            "users": {
                "total": q("SELECT COUNT(*) FROM users"), "active": q("SELECT COUNT(*) FROM users WHERE status = 'active'"),
                "disabled": q("SELECT COUNT(*) FROM users WHERE status = 'disabled'"), "admins": q("SELECT COUNT(*) FROM users WHERE instance_role = 'admin'"),
            },
            "orgs": q("SELECT COUNT(*) FROM orgs"),
            "spaces": {
                "shared": q("SELECT COUNT(*) FROM spaces WHERE kind = 'shared' AND archived_at IS NULL"),
                "archived": q("SELECT COUNT(*) FROM spaces WHERE kind = 'shared' AND archived_at IS NOT NULL"),
                "personal": q("SELECT COUNT(*) FROM spaces WHERE kind = 'personal'"),
            },
            "invites_active": q(
                "SELECT COUNT(*) FROM invites WHERE revoked_at IS NULL AND uses < max_uses AND expires_at > ?", acc.now(),
            ),
            "active_users": {"d7": d7, "d30": d30},
            "at": acc.now(),
        }
