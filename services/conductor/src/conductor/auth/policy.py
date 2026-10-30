"""권한 판정 = 이 파일 한 곳 (ADR-0011 · slice 04 역할 표). 기본 거부.

입력 = DB 에서 읽은 사실(SpaceFacts 등) · 출력 = 통과 또는 Denied(status, code). 꺼내기는 guard.py.
SpaceFacts = 멤버십 층(scopes.MEMBERSHIP) 의 사실 — 그 아래 층(프로젝트 · 대화)은 이것을 물려받아 판정한다.
  못 보는 자원 = 404 (있는지도 숨김) · 보이지만 이 행동만 안 됨 = 403 forbidden · 상태 때문에 안 됨 = 409.
암묵 admin = 조직 owner·admin → shared 스페이스만. personal 은 주인 말고 아무도 (조직 owner · instance admin 포함).
대화: 만든 사람 또는 visibility shared 일 때 스페이스 멤버가 '보기'. 이어 쓰기 · 고치기 · 지우기 = 만든 사람만.
프로젝트: 멤버 · 역할 없음 = 스페이스 것. 만들기 = 멤버 누구나 · 고치기 · 보관 = 만든 사람 또는 space admin.
instance admin 은 설치본 관리(관리자 콘솔)만 — 스페이스 · 대화에 대한 암묵 권한은 없다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

OrgRole = Literal["owner", "admin", "member"]
SpaceRole = Literal["admin", "member"]
ORG_RANK = {"member": 1, "admin": 2, "owner": 3}
SPACE_RANK = {"member": 1, "admin": 2}


class Denied(Exception):
    def __init__(self, status: int, code: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code


@dataclass(frozen=True)
class Actor:
    user_id: str
    instance_admin: bool = False


@dataclass(frozen=True)
class SpaceFacts:
    id: str
    org_id: str
    kind: Literal["personal", "shared"]
    owner_user_id: str | None
    visibility: Literal["open", "private"]
    archived: bool
    direct_role: SpaceRole | None  # space_members 의 내 역할
    org_role: OrgRole | None  # 그 조직에서 내 역할 (없으면 조직 밖)


@dataclass(frozen=True)
class ThreadFacts:
    user_id: str | None
    visibility: Literal["private", "shared"]
    space: SpaceFacts


@dataclass(frozen=True)
class ProjectFacts:
    created_by: str | None
    archived: bool
    space: SpaceFacts


# ── 조직 ──
OrgAction = Literal["create_org", "manage_models", "delete_org", "assign_owner", "manage_members", "join_policy", "create_shared_space"]
_ORG_TABLE: dict[str, frozenset[str]] = {  # slice 04 '역할 — 조직' 표 (instance admin 은 따로)
    "create_org": frozenset(),
    "manage_models": frozenset(),
    "delete_org": frozenset({"owner"}),
    "assign_owner": frozenset({"owner"}),
    "manage_members": frozenset({"owner", "admin"}),
    "join_policy": frozenset({"owner", "admin"}),
    "create_shared_space": frozenset({"owner", "admin"}),
}


def org_can(actor: Actor, org_role: OrgRole | None, action: OrgAction, *, members_can_create_spaces: bool = True) -> bool:
    if actor.instance_admin:
        return True
    if org_role is None:
        return False
    if action == "create_shared_space" and org_role == "member":
        return members_can_create_spaces
    return org_role in _ORG_TABLE[action]


def can_set_org_role(actor_role: OrgRole | None, target_role: OrgRole | None, new_role: OrgRole | None, *, instance_admin: bool = False) -> bool:
    """초대 · 제거 · 역할 변경 = 자기 역할 이하만. owner 지정은 owner 만. new_role None = 제거."""
    if instance_admin:
        return True
    if actor_role not in ("owner", "admin"):
        return False
    rank = ORG_RANK[actor_role]
    if target_role is not None and ORG_RANK[target_role] > rank:
        return False
    if new_role is not None and (ORG_RANK[new_role] > rank or (new_role == "owner" and actor_role != "owner")):
        return False
    return True


# ── 스페이스 ──
def space_role(actor: Actor, s: SpaceFacts) -> SpaceRole | None:
    """실효 역할 = max(직접, 암묵). 조직을 떠나면 직접 역할도 무효."""
    if s.kind == "personal":
        return "admin" if s.owner_user_id == actor.user_id else None
    if s.org_role is None:
        return None
    implicit: SpaceRole | None = "admin" if s.org_role in ("owner", "admin") else None
    roles = [r for r in (s.direct_role, implicit) if r is not None]
    return max(roles, key=SPACE_RANK.__getitem__) if roles else None


def can_browse(actor: Actor, s: SpaceFacts) -> bool:
    """전환기 '둘러보기' · 스페이스 정보 = 멤버이거나, 같은 조직의 open shared (보관 안 됨)."""
    if space_role(actor, s) is not None:
        return True
    return s.kind == "shared" and s.visibility == "open" and s.org_role is not None and not s.archived


def require_space_visible(actor: Actor, s: SpaceFacts) -> SpaceRole | None:
    if not can_browse(actor, s):
        raise Denied(404, "space_not_found")
    return space_role(actor, s)


def require_space_member(actor: Actor, s: SpaceFacts) -> SpaceRole:
    """대화 · 실행 · 프로젝트 읽기. open 이어도 참여 전엔 안의 것을 못 본다."""
    role = space_role(actor, s)
    if role is None:
        raise Denied(404, "space_not_found")
    return role


def require_space_writable(actor: Actor, s: SpaceFacts) -> SpaceRole:
    role = require_space_member(actor, s)
    if s.archived:
        raise Denied(409, "space_archived")
    return role


def require_space_admin(actor: Actor, s: SpaceFacts) -> None:
    if require_space_member(actor, s) != "admin":
        raise Denied(403, "forbidden")


def require_can_join(actor: Actor, s: SpaceFacts) -> None:
    require_space_visible(actor, s)
    if s.archived:
        raise Denied(409, "space_archived")
    if s.kind != "shared" or s.visibility != "open":
        raise Denied(403, "forbidden")  # 내가 볼 수 있는 private = 이미 멤버 → 참여할 것이 없다


# ── 대화 ──
def require_thread_view(actor: Actor, t: ThreadFacts) -> None:
    if space_role(actor, t.space) is None or (t.user_id != actor.user_id and t.visibility != "shared"):
        raise Denied(404, "thread_not_found")


def require_thread_owner(actor: Actor, t: ThreadFacts) -> None:
    require_thread_view(actor, t)
    if t.user_id != actor.user_id:
        raise Denied(403, "forbidden")


def can_share(t: ThreadFacts) -> bool:
    return t.space.kind == "shared"


# ── 프로젝트 ──
def require_project_view(actor: Actor, p: ProjectFacts) -> None:
    if space_role(actor, p.space) is None:
        raise Denied(404, "project_not_found")


def can_edit_project(actor: Actor, p: ProjectFacts) -> bool:
    role = space_role(actor, p.space)
    return role == "admin" or (role is not None and p.created_by == actor.user_id)


def require_project_edit(actor: Actor, p: ProjectFacts) -> None:
    require_project_view(actor, p)
    if not can_edit_project(actor, p):
        raise Denied(403, "forbidden")
    if p.space.archived:
        raise Denied(409, "space_archived")


def require_project_usable(actor: Actor, p: ProjectFacts) -> None:
    """새 대화를 넣거나 대화를 옮겨 올 프로젝트: 보이고 · 보관 안 됨."""
    require_project_view(actor, p)
    if p.archived:
        raise Denied(409, "project_archived")
