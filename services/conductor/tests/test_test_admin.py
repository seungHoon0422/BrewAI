"""테스트 관리자 admin / admin (BREWAI_TEST_ADMIN · loopback 만): 만들기 · 되돌리기 · 두 표면 로그인 · 끄면 잠금 · 다른 규칙은 그대로."""

from __future__ import annotations

import logging
from dataclasses import replace

from fastapi.testclient import TestClient
from pydantic_ai.models.test import TestModel

from conductor.agent import ChatRuntime
from conductor.app import create_app
from conductor.auth import passwords
from conductor.settings import load_settings
from conductor.store import Store

BAD = (401, {"detail": "invalid_credentials"})
ENV = {"LLM_GATEWAY_KEY": "sk-test"}
LOCAL = ("127.0.0.1", 50000)


def boot(h, store: Store, **overrides) -> TestClient:
    settings = replace(h.SETTINGS, **overrides)
    app = create_app(settings, catalog=h.MemoryCatalog([]), runtime=ChatRuntime(gateway_url="http://x.invalid", gateway_key="k"), store=store)
    return TestClient(app, base_url="http://127.0.0.1", client=LOCAL)


def admin_row(store: Store):
    rows = store.query("SELECT * FROM users WHERE email_norm = 'admin'")
    return rows[0] if rows else None


def test_switch_reads_env_and_only_counts_on_loopback() -> None:
    assert load_settings(ENV).test_admin is False  # 기본 = 꺼짐 (npm run dev 가 켠다)
    assert load_settings(ENV | {"BREWAI_TEST_ADMIN": "1"}).test_admin_active is True
    off = load_settings(ENV | {"BREWAI_TEST_ADMIN": "0"})
    assert (off.test_admin, off.test_admin_lock) == (False, True)
    assert load_settings(ENV).test_admin_lock is False  # 비어 있음 (npm run api 등) = 잠그지 않는다
    assert load_settings(ENV | {"CONDUCTOR_PUBLIC_URL": "https://brewai.example.com"}).test_admin_lock is True  # 이 PC 밖 = 잠근다
    # E2E: 셸에 남은 1 은 무시 · 스펙이 'e2e' 라고 적을 때만
    assert load_settings(ENV | {"BREWAI_TEST_ADMIN": "1", "BREWAI_E2E": "1"}).test_admin is False
    assert load_settings(ENV | {"BREWAI_TEST_ADMIN": "e2e", "BREWAI_E2E": "1"}).test_admin is True
    # 이 PC 밖 주소 = 켜지지 않는다 (conductor 공개 주소 · 관리자 콘솔 주소 둘 다 loopback 이어야)
    on = ENV | {"BREWAI_TEST_ADMIN": "1"}
    assert load_settings(on | {"CONDUCTOR_PUBLIC_URL": "https://brewai.example.com"}).test_admin_active is False
    assert load_settings(on | {"CONDUCTOR_ADMIN_URL": "https://admin.brewai.example.com"}).test_admin_active is False
    assert load_settings(on | {"CONDUCTOR_PUBLIC_URL": "http://localhost:8787", "CONDUCTOR_ADMIN_URL": "http://[::1]:5174"}).test_admin_active is True


def test_admin_admin_logs_in_on_both_surfaces(make_api, h, caplog) -> None:
    with caplog.at_level(logging.WARNING, logger="conductor.auth"):
        api = make_api(lambda _: TestModel(), test_admin=True)
    assert "테스트 관리자 admin / admin 켜짐" in caplog.text
    anon = api.anon()
    assert anon.get("/api/auth/state").json()["test_admin"] is True
    # 데스크톱 (Bearer) · 대소문자 · 공백 무시
    res = anon.post("/api/auth/login", json={"email": " Admin ", "password": "admin"})
    assert res.status_code == 200, res.text
    me = res.json()["user"]
    assert (me["email"], me["display_name"], me["instance_role"]) == ("admin", "admin", "admin")
    assert me["orgs"][0]["role"] == "owner" and me["personal_space_id"]
    # 관리자 콘솔 (쿠키 + CSRF)
    c = TestClient(api.app, base_url="http://127.0.0.1", client=LOCAL)
    res = c.post("/api/admin/auth/login", json={"email": "admin", "password": "admin"})
    assert res.status_code == 200, res.text
    assert c.get("/api/admin/auth/me").json()["user"]["email"] == "admin"
    # 틀린 비밀번호 = 같은 401
    assert (lambda r: (r.status_code, r.json()))(anon.post("/api/auth/login", json={"email": "admin", "password": "admin1"})) == BAD
    # .env 첫 관리자는 그대로 (옛 대화 귀속도 그쪽 · 같은 조직)
    assert api.me["instance_role"] == "admin" and api.me["orgs"][0]["id"] == me["orgs"][0]["id"]


def test_other_rules_unchanged(make_api, h) -> None:
    api = make_api(lambda _: TestModel(), test_admin=True)
    admin = api.login("admin", "admin")
    # 테스트 관리자라도 새 비밀번호는 길이 규칙 그대로
    res = admin.post("/api/me/password", json={"current_password": "admin", "new_password": "short"})
    assert (res.status_code, res.json()) == (422, {"detail": "password_too_short"})
    # 다른 계정의 짧은 비밀번호 · 이메일 아닌 ID 는 안 된다
    api.add_user("short@brewai.test", password="admin")
    assert (lambda r: (r.status_code, r.json()))(api.anon().post("/api/auth/login", json={"email": "short", "password": "admin"})) == BAD
    # 이메일 아닌 ID 로 초대 · 가입 안 됨
    res = api.client.post("/api/admin/invites", json={"email": "admin", "org_role": "member", "space_ids": [], "max_uses": 1, "days": 7})
    assert (res.status_code, res.json()) == (422, {"detail": "bad_email"})
    res = api.client.post("/api/admin/invites", json={"org_role": "member", "space_ids": [], "max_uses": 1, "days": 7})
    code = res.json()["code"]
    res = api.anon().post("/api/auth/signup", json={"code": code, "email": "admin", "password": "x" * 20})
    assert (res.status_code, res.json()) == (422, {"detail": "bad_email"})


def test_ensure_creates_restores_and_off_locks(h) -> None:
    store = Store(":memory:")
    with store.tx() as db:
        db.execute("INSERT INTO threads (id, title, created_at, updated_at) VALUES ('old-1', '옛 대화', '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z')")
    # .env 값이 없고 users 가 비었다 → 테스트 관리자가 첫 관리자 (옛 대화 귀속)
    with boot(h, store, test_admin=True, admin_email=None, admin_password=None) as c:
        state = c.get("/api/auth/state").json()
        assert (state["needs_bootstrap"], state["test_admin"]) == (False, True)
        row = admin_row(store)
        assert row["instance_role"] == "admin"
        thread = store.query("SELECT user_id, space_id FROM threads WHERE id = 'old-1'")[0]
        assert thread["user_id"] == row["id"] and thread["space_id"]
        assert store.query("SELECT COUNT(*) AS n FROM users")[0]["n"] == 1
    # 누가 권한 · 상태 · 비밀번호를 바꿔 둠 → 다시 켜면 되돌린다 (계정 · 대화는 그대로)
    with store.tx() as db:
        db.execute("UPDATE users SET instance_role = 'user', status = 'disabled' WHERE id = ?", (row["id"],))
    with store.tx() as db:
        c.app.state.accounts.set_password(db, row["id"], passwords.hash_password("another-password-0001"))
    with boot(h, store, test_admin=True, admin_email=None, admin_password=None) as c:
        again = admin_row(store)
        assert (again["id"], again["instance_role"], again["status"]) == (row["id"], "admin", "active")
        assert c.post("/api/admin/auth/login", json={"email": "admin", "password": "admin"}).status_code == 200
    # 그냥 비어 있으면 (npm run api 만 다시 켬) 'admin' 은 로그인 ID 가 아니지만 · 계정 · 세션은 그대로
    live = "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL"
    with boot(h, store, test_admin=False, admin_email=None, admin_password=None) as c:
        assert "test_admin" not in c.get("/api/auth/state").json()
        assert admin_row(store)["status"] == "active" and store.query(live, (row["id"],))[0]["n"] > 0
        assert c.post("/api/auth/login", json={"email": "admin", "password": "admin"}).status_code == 401
    # 일부러 끄면 (0) 그 계정은 잠기고 · 세션도 끝
    with boot(h, store, test_admin=False, test_admin_off=True, admin_email=None, admin_password=None) as c:
        assert "test_admin" not in c.get("/api/auth/state").json()
        assert admin_row(store)["status"] == "disabled"
        assert store.query(live, (row["id"],))[0]["n"] == 0
        assert c.post("/api/auth/login", json={"email": "admin", "password": "admin"}).status_code == 401


def test_not_on_non_loopback(h, caplog) -> None:
    store = Store(":memory:")
    with caplog.at_level(logging.WARNING):
        with boot(h, store, test_admin=True, public_url="https://brewai.example.com", admin_url="https://admin.brewai.example.com") as c:
            assert "test_admin" not in c.get("/api/auth/state").json()
            assert c.post("/api/auth/login", json={"email": "admin", "password": "admin"}).status_code == 401
    assert admin_row(store) is None
    assert "BREWAI_TEST_ADMIN 을 무시해요" in caplog.text and "켜짐" not in caplog.text


def test_only_from_this_pc(make_api, h) -> None:
    # 설정 주소가 loopback 이어도 (같은 PC 의 reverse proxy · 0.0.0.0 바인드) 다른 PC 에서 온 admin / admin 은 같은 401
    api = make_api(lambda _: TestModel(), test_admin=True)
    far = TestClient(api.app, base_url="http://127.0.0.1", client=("203.0.113.5", 50000))
    for path in ("/api/auth/login", "/api/admin/auth/login"):
        res = far.post(path, json={"email": "admin", "password": "admin"})
        assert (res.status_code, res.json()) == BAD
    # IPv4-mapped loopback (node 듀얼 스택 proxy) 은 이 PC
    near = TestClient(api.app, base_url="http://127.0.0.1", client=("::ffff:127.0.0.1", 50000))
    assert near.post("/api/auth/login", json={"email": "admin", "password": "admin"}).status_code == 200
    # 다른 계정은 어디서든 그대로
    assert far.post("/api/auth/login", json={"email": h.ADMIN_EMAIL, "password": h.ADMIN_PASSWORD}).status_code == 200
