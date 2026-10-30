"""권한 판정 (auth/policy.py 한 곳 · 기본 거부 · 404 숨김 / 403) + 스페이스 · 프로젝트 · 대화 범위 API (ADR-0011 · slice 04)."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models.function import AgentInfo, FunctionModel

from conductor.agent import INSTRUCTIONS
from conductor.auth import policy
from conductor.auth.policy import Actor, ProjectFacts, SpaceFacts, ThreadFacts

ME, OTHER = "u-me", "u-other"


def space(kind: str = "shared", *, owner: str | None = None, direct=None, org=None, visibility="private", archived=False) -> SpaceFacts:
    return SpaceFacts(id="s", org_id="o", kind=kind, owner_user_id=owner, visibility=visibility, archived=archived, direct_role=direct, org_role=org)


# ── 순수 판정 표 ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("facts", "admin", "role"),
    [
        (space("personal", owner=ME, direct="admin", org="member"), False, "admin"),
        (space("personal", owner=OTHER, org="owner"), False, None),  # 조직 owner 도 남의 내 스페이스 못 봄
        (space("personal", owner=OTHER, org="owner"), True, None),  # instance admin 도
        (space(org="owner"), False, "admin"),  # 암묵 admin = shared 만
        (space(org="admin"), False, "admin"),
        (space(org="member"), False, None),
        (space(org="member", direct="member"), False, "member"),
        (space(org="admin", direct="member"), False, "admin"),  # max(직접, 암묵)
        (space(org=None, direct="admin"), False, None),  # 조직을 떠나면 직접 역할도 무효
        (space(org=None), True, None),  # instance admin 은 스페이스 권한 없음
    ],
)
def test_space_role(facts: SpaceFacts, admin: bool, role: str | None) -> None:
    assert policy.space_role(Actor(ME, admin), facts) == role


def test_browse_join_and_errors() -> None:
    me = Actor(ME)
    open_ = space(org="member", visibility="open")
    assert policy.can_browse(me, open_) and policy.space_role(me, open_) is None
    with pytest.raises(policy.Denied) as e:
        policy.require_space_member(me, open_)  # 참여 전엔 안의 것을 못 본다
    assert (e.value.status, e.value.code) == (404, "space_not_found")
    policy.require_can_join(me, open_)
    for hidden in (space(org="member"), space(org=None, visibility="open"), space(org="member", visibility="open", archived=True)):
        with pytest.raises(policy.Denied) as e:
            policy.require_can_join(me, hidden)
        assert e.value.status in (404, 409)
    with pytest.raises(policy.Denied) as e:
        policy.require_space_admin(me, space(org="member", direct="member"))
    assert (e.value.status, e.value.code) == (403, "forbidden")  # 보이지만 행동 권한만 없음
    with pytest.raises(policy.Denied) as e:
        policy.require_space_writable(me, space(org="member", direct="member", archived=True))
    assert e.value.code == "space_archived"


@pytest.mark.parametrize(
    ("owner", "visibility", "facts", "view", "write"),
    [
        (ME, "private", space(org="member", direct="member"), True, True),
        (OTHER, "private", space(org="member", direct="member"), False, False),
        (OTHER, "shared", space(org="member", direct="member"), True, False),
        (OTHER, "private", space(org="owner"), False, False),  # 조직 owner (암묵 space admin) 도 남의 private 못 봄
        (OTHER, "shared", space(org="member"), False, False),  # 스페이스 멤버가 아니면 공유도 못 봄
    ],
)
def test_thread_matrix(owner: str, visibility: str, facts: SpaceFacts, view: bool, write: bool) -> None:
    t = ThreadFacts(user_id=owner, visibility=visibility, space=facts)  # type: ignore[arg-type]
    for check, allowed in ((policy.require_thread_view, view), (policy.require_thread_owner, write)):
        if allowed:
            check(Actor(ME, True), t)
        else:
            with pytest.raises(policy.Denied):
                check(Actor(ME, True), t)


@pytest.mark.parametrize(
    ("creator", "facts", "edit"),
    [
        (ME, space(org="member", direct="member"), True),  # 만든 사람
        (OTHER, space(org="member", direct="member"), False),
        (OTHER, space(org="member", direct="admin"), True),  # space admin
        (OTHER, space(org="admin"), True),  # 조직 admin = shared 의 암묵 admin
        (OTHER, space("personal", owner=ME, direct="admin", org="member"), True),  # 내 스페이스의 프로젝트
        (ME, space(org=None, direct="member"), False),  # 조직을 떠남
    ],
)
def test_project_edit(creator: str, facts: SpaceFacts, edit: bool) -> None:
    assert policy.can_edit_project(Actor(ME), ProjectFacts(created_by=creator, archived=False, space=facts)) is edit


def test_org_actions_default_deny() -> None:
    me = Actor(ME)
    assert policy.org_can(Actor(ME, True), None, "manage_models")
    assert not policy.org_can(me, "owner", "manage_models") and not policy.org_can(me, None, "create_shared_space")
    assert policy.org_can(me, "member", "create_shared_space") and not policy.org_can(me, "member", "create_shared_space", members_can_create_spaces=False)
    assert policy.can_set_org_role("admin", "member", "admin") and not policy.can_set_org_role("admin", "member", "owner")
    assert not policy.can_set_org_role("admin", "owner", None) and not policy.can_set_org_role("member", "member", None)


# ── API: 한 조직 · 세 사람 ──────────────────────────────────────────────────────────


def capture() -> tuple[FunctionModel, list[str | None]]:
    seen: list[str | None] = []

    async def stream(messages: list[ModelMessage], info: AgentInfo) -> AsyncIterator[str]:
        seen.append(info.instructions)
        yield "| 표 | 답 |"

    return FunctionModel(stream_function=stream), seen


@pytest.fixture
def team(make_api, h):
    """A = 첫 관리자(조직 owner · instance admin) · B · C = 조직 member."""
    model, seen = capture()
    api = make_api(lambda _: model)
    api.add_user("b@brewai.test", name="비")
    api.add_user("c@brewai.test", name="씨")
    b, c = api.login("b@brewai.test"), api.login("c@brewai.test")

    def chat(client, text="질문", *, thread="t", run=None, **props):
        run = run or f"r-{len(seen)}-{thread}"
        return client.post("/api/chat", json=h.chat_body(text, thread=thread, run=run, **props))

    return api, b, c, chat, seen


def test_private_threads_are_hidden_even_from_org_owner_and_instance_admin(team) -> None:
    api, b, _, chat, _ = team
    assert chat(b, thread="b-secret").status_code == 200  # B 의 내 스페이스
    b_personal = b.get("/api/me").json()["personal_space_id"]
    assert api.client.get("/api/threads/b-secret").json() == {"detail": "thread_not_found"}
    assert api.client.get("/api/threads", params={"space": b_personal}).json() == {"detail": "space_not_found"}
    assert api.client.get("/api/runs", params={"space": b_personal}).json() == {"detail": "space_not_found"}
    assert api.client.patch("/api/threads/b-secret", json={"title": "x"}).json() == {"detail": "thread_not_found"}
    assert api.client.delete("/api/threads/b-secret").json() == {"detail": "thread_not_found"}
    # 남의 대화 id 로 이어 쓰기 = 404 (있는지도 숨김)
    assert chat(api.client, thread="b-secret").json() == {"detail": "thread_not_found"}
    # 관리자 콘솔에도 내용 경로가 없다 — 스페이스는 개수만
    spaces = api.client.get("/api/admin/spaces").json()
    assert spaces["personal_count"] == 3 and spaces["shared"] == []
    admin_paths = [p for p in api.app.openapi()["paths"] if p.startswith("/api/admin/")]
    assert admin_paths and not any("thread" in p or "run" in p for p in admin_paths)


def test_shared_space_projects_instructions_and_sharing(team) -> None:
    api, b, c, chat, seen = team
    res = api.client.post("/api/spaces", json={"name": "  팀  ", "visibility": "open", "description": "같이"})
    assert res.status_code == 201
    sp = res.json()
    assert (sp["name"], sp["role"], sp["can_manage"], sp["kind"]) == ("팀", "admin", True, "shared")
    assert [(x["kind"], x["name"]) for x in sp["path"]] == [("org", "우리 팀"), ("space", "팀")]
    # C: 참여 전엔 둘러보기에만 · 안의 것은 404
    lists = c.get("/api/spaces").json()
    assert [s["name"] for s in lists["browse"]] == ["팀"] and [s["kind"] for s in lists["spaces"]] == ["personal"]
    assert c.get(f"/api/spaces/{sp['id']}").json()["joined"] is False
    assert c.get(f"/api/spaces/{sp['id']}/projects").json() == {"detail": "space_not_found"}
    assert chat(c, thread="c-x", spaceId=sp["id"]).json() == {"detail": "space_not_found"}
    for who in (b, c):
        assert who.post(f"/api/spaces/{sp['id']}/join").json()["role"] == "member"
    # B: 프로젝트 만들기 (멤버 누구나) · 지침이 시스템 프롬프트 '뒤'에
    pr = b.post(f"/api/spaces/{sp['id']}/projects", json={"name": "주간 보고", "instructions": "표로 답한다"}).json()
    assert pr["can_edit"] is True and [x["kind"] for x in pr["path"]] == ["org", "space", "project"]
    assert chat(b, "이번 주", thread="b-week", spaceId=sp["id"], projectId=pr["id"]).status_code == 200
    assert seen[-1].startswith(INSTRUCTIONS) and seen[-1].rstrip().endswith("표로 답한다")
    thread = b.get("/api/threads/b-week").json()
    assert (thread["space_id"], thread["project_id"], thread["visibility"]) == (sp["id"], pr["id"], "private")
    assert [(x["kind"], x["name"]) for x in thread["path"]] == [("org", "우리 팀"), ("space", "팀"), ("project", "주간 보고"), ("thread", "이번 주")]
    # 기존 대화 = DB 의 범위 (클라이언트가 보낸 spaceId · projectId 는 무시)
    b_personal = b.get("/api/me").json()["personal_space_id"]
    assert chat(b, "또", thread="b-week", spaceId=b_personal).status_code == 200
    assert b.get("/api/threads/b-week").json()["space_id"] == sp["id"]
    # 프로젝트 고치기: C(남의 것) = 403 · A(조직 owner = 암묵 space admin) = 됨 · B(만든 사람) = 됨
    assert c.get(f"/api/projects/{pr['id']}").json()["can_edit"] is False
    assert c.patch(f"/api/projects/{pr['id']}", json={"instructions": "무시"}).json() == {"detail": "forbidden"}
    assert api.client.patch(f"/api/projects/{pr['id']}", json={"description": "매주"}).json()["description"] == "매주"
    assert b.patch(f"/api/projects/{pr['id']}", json={"name": "주간"}).json()["name"] == "주간"
    # 공유 전: C 와 A 모두 못 본다 (A 는 암묵 space admin 이어도)
    assert c.get("/api/threads/b-week").status_code == 404 and api.client.get("/api/threads/b-week").status_code == 404
    assert c.get("/api/threads", params={"space": sp["id"]}).json() == []
    # [공유] → 멤버가 본다 (닉네임 태그) · 보기만
    assert b.patch("/api/threads/b-week", json={"visibility": "shared"}).json()["visibility"] == "shared"
    listed = c.get("/api/threads", params={"space": sp["id"], "project": pr["id"]}).json()
    assert [(t["id"], t["owner_name"], t["mine"]) for t in listed] == [("b-week", "비", False)]
    assert c.get("/api/threads/b-week").json()["can_edit"] is False
    assert chat(c, thread="b-week").json() == {"detail": "forbidden"}
    assert c.patch("/api/threads/b-week", json={"title": "x"}).json() == {"detail": "forbidden"}
    assert c.delete("/api/threads/b-week").json() == {"detail": "forbidden"}
    # 닉네임을 바꾸면 사람이 보이는 곳이 다 바뀐다
    b.patch("/api/me", json={"display_name": "비비"})
    assert c.get("/api/threads/b-week").json()["owner_name"] == "비비"
    # 프로젝트 필터 · 프로젝트 없음
    assert chat(b, "따로", thread="b-loose", spaceId=sp["id"]).status_code == 200
    assert [t["id"] for t in b.get("/api/threads", params={"space": sp["id"], "project": "none"}).json()] == ["b-loose"]
    assert {t["id"] for t in b.get("/api/threads", params={"space": sp["id"]}).json()} == {"b-week", "b-loose"}
    assert [r["path"][-1]["id"] for r in b.get("/api/runs", params={"space": sp["id"]}).json()][:1] == ["b-loose"]


def test_moving_threads_stays_inside_one_space(team) -> None:
    api, b, _, chat, _ = team
    sp = api.client.post("/api/spaces", json={"name": "팀", "visibility": "open"}).json()
    b.post(f"/api/spaces/{sp['id']}/join")
    here = b.post(f"/api/spaces/{sp['id']}/projects", json={"name": "여기"}).json()
    b_personal = b.get("/api/me").json()["personal_space_id"]
    mine = b.post(f"/api/spaces/{b_personal}/projects", json={"name": "내 프로젝트"}).json()  # 내 스페이스에도 프로젝트
    assert chat(b, thread="b-1", spaceId=sp["id"]).status_code == 200
    assert b.patch("/api/threads/b-1", json={"project_id": here["id"]}).json()["project_id"] == here["id"]
    assert b.patch("/api/threads/b-1", json={"project_id": mine["id"]}).json() == {"detail": "project_in_other_space"}
    assert b.patch("/api/threads/b-1", json={"project_id": None}).json()["project_id"] is None
    assert b.patch("/api/threads/b-1", json={"project_id": "nope"}).json() == {"detail": "project_not_found"}
    # 새 대화도: 다른 스페이스의 프로젝트 = 409 · 보관된 프로젝트 = 409
    assert chat(b, thread="b-2", spaceId=sp["id"], projectId=mine["id"]).json() == {"detail": "project_in_other_space"}
    b.patch(f"/api/projects/{here['id']}", json={"archived": True})
    assert chat(b, thread="b-3", spaceId=sp["id"], projectId=here["id"]).json() == {"detail": "project_archived"}
    assert [p["name"] for p in b.get(f"/api/spaces/{sp['id']}/projects", params={"archived": True}).json()] == ["여기"]
    assert b.get(f"/api/spaces/{sp['id']}/projects").json() == []
    # 내 스페이스의 대화는 공유할 수 없다 (멤버가 없다)
    assert chat(b, thread="b-4").status_code == 200
    assert b.patch("/api/threads/b-4", json={"visibility": "shared"}).json() == {"detail": "personal_space"}
    # 남의 프로젝트 목록 · 다른 스페이스 프로젝트로 대화 목록 거르기 = 404
    assert api.client.get(f"/api/spaces/{b_personal}/projects").json() == {"detail": "space_not_found"}
    assert b.get("/api/threads", params={"space": sp["id"], "project": mine["id"]}).json() == {"detail": "project_not_found"}


def test_space_admin_members_leave_and_archive(team) -> None:
    api, b, c, chat, _ = team
    private = b.post("/api/spaces", json={"name": "비밀", "visibility": "private"}).json()
    assert private["role"] == "admin"
    # private = 초대한 사람만 · 둘러보기에도 없음 · 조직 owner(A) 는 암묵 admin 으로 보임
    assert c.get(f"/api/spaces/{private['id']}").json() == {"detail": "space_not_found"}
    assert [s["name"] for s in c.get("/api/spaces").json()["browse"]] == []
    assert c.post(f"/api/spaces/{private['id']}/join").json() == {"detail": "space_not_found"}
    assert api.client.get(f"/api/spaces/{private['id']}").json()["implicit"] is True
    # 멤버 추가 = 조직 사람만 · member 는 관리 못 함
    c_id = c.get("/api/me").json()["id"]
    assert b.put(f"/api/spaces/{private['id']}/members/{c_id}", json={"role": "member"}).json()["role"] == "member"
    assert b.put(f"/api/spaces/{private['id']}/members/nobody", json={"role": "member"}).json() == {"detail": "user_not_found"}
    assert c.patch(f"/api/spaces/{private['id']}", json={"name": "x"}).json() == {"detail": "forbidden"}
    members = c.get(f"/api/spaces/{private['id']}/members").json()
    assert {(m["display_name"], m["role"], m["implicit"]) for m in members} == {("비", "admin", False), ("씨", "member", False), ("admin", "admin", True)}
    assert [m["display_name"] for m in c.get("/api/org/members", params={"q": "비"}).json()] == ["비"]
    # 나가기 · 암묵 admin 은 못 나감 · 내 스페이스는 못 바꿈
    assert c.post(f"/api/spaces/{private['id']}/leave").status_code == 204
    assert c.get(f"/api/spaces/{private['id']}").status_code == 404
    assert api.client.post(f"/api/spaces/{private['id']}/leave").json() == {"detail": "implicit_member"}
    b_personal = b.get("/api/me").json()["personal_space_id"]
    assert b.patch(f"/api/spaces/{b_personal}", json={"name": "x"}).json() == {"detail": "personal_space"}
    # 보관 = 읽기만
    assert b.patch(f"/api/spaces/{private['id']}", json={"archived": True}).json()["archived_at"]
    assert chat(b, thread="b-arch", spaceId=private["id"]).json() == {"detail": "space_archived"}
    assert b.post(f"/api/spaces/{private['id']}/projects", json={"name": "p"}).json() == {"detail": "space_archived"}
    # 조직 설정: member 가 공유 스페이스를 못 만들게
    org = api.me["orgs"][0]["id"]
    api.client.patch(f"/api/admin/orgs/{org}", json={"members_can_create_spaces": False})
    assert c.get("/api/spaces").json()["orgs"][0]["can_create_spaces"] is False
    assert c.post("/api/spaces", json={"name": "x"}).json() == {"detail": "forbidden"}
    # 조직에서 빼면 그 조직 공유 스페이스 멤버십도 끝
    b_id = b.get("/api/me").json()["id"]
    assert api.client.delete(f"/api/admin/orgs/{org}/members/{b_id}").status_code == 204
    assert b.get(f"/api/spaces/{private['id']}").status_code == 404
    assert api.client.delete(f"/api/admin/orgs/{org}/members/{api.me['id']}").json() == {"detail": "last_owner"}


def test_last_space_is_remembered_only_for_members(team) -> None:
    api, b, _, _, _ = team
    sp = api.client.post("/api/spaces", json={"name": "팀", "visibility": "private"}).json()
    assert b.patch("/api/me", json={"last_space_id": sp["id"]}).json() == {"detail": "space_not_found"}
    assert api.client.patch("/api/me", json={"last_space_id": sp["id"]}).json()["last_space_id"] == sp["id"]
