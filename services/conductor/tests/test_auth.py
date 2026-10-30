"""로그인 · 세션 · 관리자 쿠키 + CSRF · 시도 제한 · 경로 인증 · 가입 · 재설정 · 첫 관리자 · v1 → v2 (ADR-0010 · slice 03)."""

from __future__ import annotations

import logging
import sqlite3
from dataclasses import replace
from datetime import timedelta

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic_ai.models.test import TestModel

from conductor.agent import ChatRuntime
from conductor.app import RedactQuery, create_app
from conductor.auth import passwords, tokens
from conductor.auth.accounts import Accounts
from conductor.auth.directory import Directory
from conductor.store import SCHEMA_VERSION, Store

BAD = (401, {"detail": "invalid_credentials"})


def new_api(make_api, **kw):
    return make_api(lambda _: TestModel(), **kw)


def advance(api, seconds: float) -> None:
    """서버 시계를 앞으로 (세션 · 잠금 만료)."""
    acc = api.app.state.accounts
    base = acc.clock()
    acc.clock = lambda: base + timedelta(seconds=seconds)


def status(res) -> tuple[int, object]:
    return res.status_code, res.json()


# ── 비밀번호 로그인 ───────────────────────────────────────────────────────────────


def test_password_login_and_one_failure_answer(make_api, h) -> None:
    api = new_api(make_api)
    b = api.add_user("b@brewai.test", name="비")
    anon = api.anon()
    res = anon.post("/api/auth/login", json={"email": "  B@BrewAI.test ", "password": h.PASSWORD})  # 이메일 = 대소문자 · 공백 무시
    assert res.status_code == 200
    body = res.json()
    assert body["access_token"].startswith("bwa_") and body["refresh_token"].startswith("bwr_")
    assert (body["token_type"], body["expires_in"]) == ("Bearer", 900)
    assert body["user"] | {"id": b, "email": "b@brewai.test", "display_name": "비", "has_password": True} == body["user"]
    # 틀림 · 없는 계정 · 비밀번호 없는 계정 · 비활성 = 같은 응답 하나
    api.add_user("nopw@brewai.test", password=None)
    api.add_user("off@brewai.test")
    api.store.query("UPDATE users SET status = 'disabled' WHERE email_norm = 'off@brewai.test'")
    for email, pw in [("b@brewai.test", "wrong-password-0000"), ("ghost@brewai.test", h.PASSWORD),
                      ("nopw@brewai.test", h.PASSWORD), ("off@brewai.test", h.PASSWORD), ("not-an-email", h.PASSWORD)]:
        res = anon.post("/api/auth/login", json={"email": email, "password": pw})
        assert status(res) == BAD, email
        assert res.headers["www-authenticate"] == "Bearer"
    # DB 엔 sha256 만 (토큰 원문 없음)
    dump = "\n".join(str(tuple(r)) for t in ("sessions", "refresh_tokens") for r in api.store.query(f"SELECT * FROM {t}"))
    assert body["access_token"] not in dump and body["refresh_token"] not in dump
    assert tokens.digest(body["refresh_token"]) in dump
    # argon2id 명시 매개변수
    stored = api.app.state.accounts.password_hash(b)
    assert stored.startswith("$argon2id$v=19$m=19456,t=2,p=1$")


def test_bearer_only_on_user_routes(make_api) -> None:
    api = new_api(make_api)
    anon = api.anon()
    assert status(anon.get("/api/threads")) == (401, {"detail": "auth_required"})
    assert status(anon.get("/api/threads", headers={"authorization": "Bearer bwa_nope"})) == (401, {"detail": "invalid_token"})
    assert status(anon.get("/api/threads", headers={"authorization": f"Basic {api.client.bearer}"})) == (401, {"detail": "invalid_token"})
    # 관리자 쿠키는 사용자 경로에서 안 본다
    cookie = api.client.cookies
    assert status(TestClient(api.app, base_url="http://127.0.0.1", cookies=cookie).get("/api/threads")) == (401, {"detail": "auth_required"})
    assert api.client.get("/api/threads").status_code == 200


def test_refresh_rotates_and_reuse_revokes_the_whole_session(make_api, h) -> None:
    api = new_api(make_api)
    api.add_user("b@brewai.test")
    anon = api.anon()
    first = anon.post("/api/auth/login", json={"email": "b@brewai.test", "password": h.PASSWORD}).json()
    second = anon.post("/api/auth/token", json={"grant_type": "refresh_token", "refresh_token": first["refresh_token"]}).json()
    assert second["refresh_token"] != first["refresh_token"] and second["session_id"] == first["session_id"]
    bearer = lambda t: {"authorization": f"Bearer {t['access_token']}"}  # noqa: E731
    assert anon.get("/api/me", headers=bearer(first)).status_code == 401  # 회전 = 앞 access 도 끝
    assert anon.get("/api/me", headers=bearer(second)).status_code == 200
    # 이미 쓴 refresh 가 다시 옴 = 도난 신호 → 세션(family) 통째 폐기
    reuse = anon.post("/api/auth/token", json={"grant_type": "refresh_token", "refresh_token": first["refresh_token"]})
    assert status(reuse) == (401, {"detail": "invalid_grant"})
    assert anon.get("/api/me", headers=bearer(second)).status_code == 401
    again = anon.post("/api/auth/token", json={"grant_type": "refresh_token", "refresh_token": second["refresh_token"]})
    assert status(again) == (401, {"detail": "invalid_grant"})
    assert api.store.query("SELECT result FROM audit_events WHERE action = 'refresh_reuse'")[0]["result"] == "denied"
    assert api.client.get("/api/me").status_code == 200  # 다른 세션(관리자 데스크톱)은 그대로


def test_access_expires_after_15_minutes_and_refresh_has_idle_limit(make_api, h) -> None:
    api = new_api(make_api)
    anon = api.anon()
    t = anon.post("/api/auth/login", json={"email": h.ADMIN_EMAIL, "password": h.ADMIN_PASSWORD}).json()
    advance(api, 15 * 60 + 1)
    assert anon.get("/api/me", headers={"authorization": f"Bearer {t['access_token']}"}).status_code == 401
    t2 = anon.post("/api/auth/token", json={"grant_type": "refresh_token", "refresh_token": t["refresh_token"]})
    assert t2.status_code == 200
    advance(api, 15 * 60 + 31 * 86400)  # idle 30일 넘김
    late = anon.post("/api/auth/token", json={"grant_type": "refresh_token", "refresh_token": t2.json()["refresh_token"]})
    assert status(late) == (401, {"detail": "invalid_grant"})


def test_logout_revokes_only_this_session(make_api, h) -> None:
    api = new_api(make_api)
    other = api.login(h.ADMIN_EMAIL, h.ADMIN_PASSWORD)
    assert other.post("/api/auth/logout").status_code == 204
    assert other.get("/api/me").status_code == 401
    assert api.client.get("/api/me").status_code == 200


# ── 관리자 콘솔 = 쿠키 + CSRF ────────────────────────────────────────────────────────


def test_admin_cookie_session_and_csrf(make_api, h) -> None:
    api = new_api(make_api)
    c = h.AuthClient(api.app, base_url="http://127.0.0.1")
    res = c.post("/api/admin/auth/login", json={"email": h.ADMIN_EMAIL, "password": h.ADMIN_PASSWORD})
    assert res.status_code == 200 and res.headers["cache-control"] == "no-store"
    cookie = res.headers["set-cookie"].lower()
    assert cookie.startswith("brewai_admin=bwc_") and "httponly" in cookie and "samesite=strict" in cookie and "path=/" in cookie
    csrf = res.json()["csrf_token"]
    assert res.json()["user"]["email"] == h.ADMIN_EMAIL
    me = c.get("/api/admin/auth/me").json()
    assert me["csrf_token"] == csrf and me["user"]["instance_role"] == "admin"
    # 안전하지 않은 메서드: CSRF 토큰이 맞아야 · Sec-Fetch-Site 는 same-origin | none 만
    assert status(c.post("/api/admin/models/sync")) == (403, {"detail": "csrf_failed"})
    assert status(c.post("/api/admin/models/sync", headers={"x-csrf-token": "x" * 43})) == (403, {"detail": "csrf_failed"})
    cross = c.post("/api/admin/models/sync", headers={"x-csrf-token": csrf, "sec-fetch-site": "cross-site"})
    assert status(cross) == (403, {"detail": "csrf_failed"})
    assert c.post("/api/admin/models/sync", headers={"x-csrf-token": csrf, "sec-fetch-site": "same-origin"}).status_code == 200
    # 표면이 섞이면 401: 관리자 경로에 Bearer
    assert status(c.get("/api/admin/models", headers={"authorization": f"Bearer {api.client.bearer}"})) == (401, {"detail": "wrong_surface"})
    # 로그아웃 = 쿠키 지움 + 세션 폐기
    assert c.post("/api/admin/auth/logout", headers={"x-csrf-token": csrf}).status_code == 204
    assert status(c.get("/api/admin/models")) == (401, {"detail": "auth_required"})


def test_admin_requires_instance_admin_and_expires(make_api, h) -> None:
    api = new_api(make_api)
    b = api.add_user("b@brewai.test")
    anon = api.anon()
    assert status(anon.post("/api/admin/auth/login", json={"email": "b@brewai.test", "password": h.PASSWORD})) == (403, {"detail": "not_admin"})
    member = api.login("b@brewai.test")
    assert status(member.get("/api/admin/users")) == (401, {"detail": "auth_required"})
    surface = member.get("/api/admin/users", headers={"authorization": f"Bearer {member.bearer}"})
    assert status(surface) == (401, {"detail": "wrong_surface"})
    # 로그인 뒤 강등 = 다음 요청부터 403 (역할은 토큰이 아니라 DB)
    api.store.query("UPDATE users SET instance_role = 'admin' WHERE id = ?", (b,))
    c = api.login("b@brewai.test", admin=True)
    assert c.get("/api/admin/users").status_code == 200
    api.store.query("UPDATE users SET instance_role = 'user' WHERE id = ?", (b,))
    assert status(c.get("/api/admin/users")) == (403, {"detail": "forbidden"})
    # idle 30분
    advance(api, 31 * 60)
    assert status(api.client.get("/api/admin/models")) == (401, {"detail": "auth_required"})


def test_secure_admin_cookie_on_https(make_api, h) -> None:
    api = new_api(make_api, admin_url="https://admin.brewai.example")
    res = api.anon().post("/api/admin/auth/login", json={"email": h.ADMIN_EMAIL, "password": h.ADMIN_PASSWORD})
    cookie = res.headers["set-cookie"].lower()
    assert cookie.startswith("__host-brewai_admin=") and "secure" in cookie


# ── 시도 제한 ─────────────────────────────────────────────────────────────────


def test_login_lockout_and_ip_limits(make_api, h) -> None:
    api = new_api(make_api)
    api.add_user("b@brewai.test")
    anon = api.anon()
    for _ in range(6):  # 5번까지 바로 · 6번째 실패부터 2^n 초 잠금
        assert status(anon.post("/api/auth/login", json={"email": "b@brewai.test", "password": "wrong-password-0000"})) == BAD
    locked = anon.post("/api/auth/login", json={"email": "b@brewai.test", "password": h.PASSWORD})  # 맞아도 잠금 중
    assert locked.status_code == 429 and locked.json()["detail"] == "rate_limited" and int(locked.headers["retry-after"]) >= 1
    advance(api, 3)
    assert anon.post("/api/auth/login", json={"email": "b@brewai.test", "password": h.PASSWORD}).status_code == 200
    # 공개 경로 IP 상한 (초대 미리보기 = 10분에 20번)
    codes = [anon.post("/api/auth/invite/preview", json={"code": "BREW-0000-0000"}).status_code for _ in range(21)]
    assert codes[:20] == [404] * 20 and codes[20] == 429


def test_ip_limit_window_does_not_lock_out_a_day_of_other_peoples_typos(make_api, h) -> None:
    """같은 IP(회사 NAT · 관리자 Vite proxy) 에서 남들의 오타가 하루 내내 쌓여도 맞는 비밀번호는 들어간다 (IP 창 = 15분)."""
    api = new_api(make_api)
    anon = api.anon()
    for i in range(60):  # 12분마다 다른 사람 한 번씩 (계정 키는 저마다 1번 = 잠금 없음)
        assert status(anon.post("/api/auth/login", json={"email": f"u{i}@brewai.test", "password": "wrong-password-0000"})) == BAD
        advance(api, 12 * 60)
    assert anon.post("/api/admin/auth/login", json={"email": h.ADMIN_EMAIL, "password": h.ADMIN_PASSWORD}).status_code == 200
    # 몰아서 틀리면 IP 도 잠긴다 (50번까지 바로 · 그 뒤 2^n 초)
    for i in range(51):
        anon.post("/api/auth/login", json={"email": f"burst{i}@brewai.test", "password": "wrong-password-0000"})
    assert anon.post("/api/auth/login", json={"email": h.ADMIN_EMAIL, "password": h.ADMIN_PASSWORD}).status_code == 429
    advance(api, 15 * 60 + 1)
    assert anon.post("/api/auth/login", json={"email": h.ADMIN_EMAIL, "password": h.ADMIN_PASSWORD}).status_code == 200


# ── 경로 표 전체: 공개 목록 밖은 모두 인증 ─────────────────────────────────────────────────

PUBLIC = {
    ("GET", "/api/auth/state"), ("POST", "/api/auth/login"), ("POST", "/api/auth/token"), ("POST", "/api/auth/invite/preview"),
    ("POST", "/api/auth/signup"), ("POST", "/api/auth/reset"), ("POST", "/api/admin/auth/login"),
    ("GET", "/api/auth/google/start"), ("GET", "/api/auth/google/callback"),
}


def api_routes(routes) -> list[APIRoute]:
    """app.routes 를 펼친다 (include_router 한 라우터 안까지)."""
    out: list[APIRoute] = []
    for route in routes:
        if isinstance(route, APIRoute):
            out.append(route)
        elif (inner := getattr(route, "original_router", None)) is not None:
            out += api_routes(inner.routes)
    return out


def test_every_api_route_requires_auth(make_api) -> None:
    api = new_api(make_api)
    anon = api.anon()
    seen = set()
    routes = api_routes(api.app.routes)
    documented = {(m.upper(), p) for p, ops in api.app.openapi()["paths"].items() for m in ops}
    flat = {(m, r.path.replace(":path}", "}")) for r in routes for m in r.methods - {"HEAD"}}
    assert flat == documented  # 펼치기가 빠뜨린 경로 없음
    for route in routes:
        assert route.path.startswith("/api/") or route.path == "/healthz", route.path  # /api 밖 경로 금지 (healthz 만)
        for method in route.methods - {"HEAD"}:
            seen.add((method, route.path))
            if (method, route.path) in PUBLIC or route.path == "/healthz":
                continue
            url = route.path.replace("{gateway_id:path}", "m").format(**{k: "x" for k in route.param_convertors})
            res = anon.request(method, url, json={})
            assert status(res) == (401, {"detail": "auth_required"}), (method, route.path)
    assert PUBLIC <= seen  # 공개 목록이 실제 경로와 맞다
    assert len(seen) > 50


def test_access_log_hides_codes_and_states() -> None:
    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1:5000", "GET", "/api/auth/google/callback?state=abc&code=4/0Axyz&scope=email&ds=s3cr3t", "1.1", 302), None,
    )
    RedactQuery().filter(record)
    line = record.getMessage()
    assert "abc" not in line and "4/0Axyz" not in line and "s3cr3t" not in line
    assert "state=***" in line and "scope=email" in line


# ── 내 계정 ──────────────────────────────────────────────────────────────────


def test_nickname_is_free_text_and_not_unique(make_api) -> None:
    api = new_api(make_api)
    assert api.me["display_name"] == "admin"  # 기본 = 이메일 @ 앞
    res = api.client.patch("/api/me", json={"display_name": "  민지   김 "})
    assert res.json()["display_name"] == "민지 김"
    api.add_user("twin@brewai.test", name="민지 김")  # 중복 허용
    for bad in ("", "   ", "가" * 41, "a\u0000b"):
        assert status(api.client.patch("/api/me", json={"display_name": bad})) == (422, {"detail": "bad_display_name"}), bad
    assert api.client.patch("/api/me", json={"display_name": "가" * 40}).status_code == 200
    assert api.client.patch("/api/me", json={"email": "x@y.z"}).status_code == 422  # 로그인 ID 는 못 바꾼다


def test_password_change_and_admin_reset_code(make_api, h) -> None:
    api = new_api(make_api)
    b = api.add_user("b@brewai.test")
    here, there = api.login("b@brewai.test"), api.login("b@brewai.test")
    assert status(here.post("/api/me/password", json={"current_password": "nope-nope-nope-00", "new_password": "x" * 20})) == (
        403, {"detail": "wrong_password"})
    assert status(here.post("/api/me/password", json={"current_password": h.PASSWORD, "new_password": "short"})) == (
        422, {"detail": "password_too_short"})
    assert status(here.post("/api/me/password", json={"current_password": h.PASSWORD, "new_password": "y" * 129})) == (
        422, {"detail": "password_too_long"})
    assert here.post("/api/me/password", json={"current_password": h.PASSWORD, "new_password": "new-password-000001"}).status_code == 204
    assert here.get("/api/me").status_code == 200 and there.get("/api/me").status_code == 401  # 다른 세션만 끝
    anon = api.anon()
    assert status(anon.post("/api/auth/login", json={"email": "b@brewai.test", "password": h.PASSWORD})) == BAD
    # 관리자 재설정 코드 (1회 · 30분) → 모든 세션 폐기
    code = api.client.post(f"/api/admin/users/{b}/reset-code").json()["code"]
    assert code.startswith("bwp_")
    assert status(anon.post("/api/auth/reset", json={"code": code, "password": "short"})) == (422, {"detail": "password_too_short"})
    assert anon.post("/api/auth/reset", json={"code": code, "password": "reset-password-00001"}).status_code == 204  # 약한 값은 코드를 안 태움
    assert here.get("/api/me").status_code == 401
    assert status(anon.post("/api/auth/reset", json={"code": code, "password": "reset-password-00002"})) == (404, {"detail": "reset_invalid"})
    assert anon.post("/api/auth/login", json={"email": "b@brewai.test", "password": "reset-password-00001"}).status_code == 200
    assert [r["action"] for r in api.store.query("SELECT action FROM audit_events WHERE target_id = ? ORDER BY seq", (b,))][-2:] == [
        "reset_code_issued", "password_reset"]


def test_admin_disable_user_ends_sessions(make_api) -> None:
    api = new_api(make_api)
    b = api.add_user("b@brewai.test")
    c = api.login("b@brewai.test")
    res = api.client.patch(f"/api/admin/users/{b}", json={"status": "disabled"})
    assert res.json()["status"] == "disabled" and res.json()["session_count"] == 0
    assert c.get("/api/me").status_code == 401
    assert status(api.client.patch(f"/api/admin/users/{api.me['id']}", json={"status": "disabled"})) == (409, {"detail": "cannot_change_self"})


# ── 초대 코드 가입 ────────────────────────────────────────────────────────────────


def test_invite_code_signup(make_api, h) -> None:
    api = new_api(make_api)
    team = api.client.post("/api/spaces", json={"name": "팀", "visibility": "private"}).json()
    res = api.client.post("/api/admin/invites", json={"email": "New@Brewai.test", "space_ids": [team["id"]], "max_uses": 1})
    assert res.status_code == 201
    code, invite = res.json()["code"], res.json()["invite"]
    assert tokens.normalize_invite(code) == code and invite["status"] == "active" and invite["uses"] == 0
    assert code not in str([tuple(r) for r in api.store.query("SELECT * FROM invites")])  # 코드 원문은 DB 에 없다
    anon = api.anon()
    typed = code.lower().replace("-", " ").replace("0", "o")  # 사람이 옮겨 적은 모양
    preview = anon.post("/api/auth/invite/preview", json={"code": typed}).json()
    assert preview | {"org_role": "member", "email_hint": "N***@Brewai.test", "inviter_name": "admin", "google": False} == preview
    assert preview["spaces"] == [{"id": team["id"], "name": "팀"}] and preview["org"]["name"] == "우리 팀"
    form = {"code": code, "email": "new@brewai.test", "password": h.PASSWORD}
    assert status(anon.post("/api/auth/signup", json=form | {"email": "other@brewai.test"})) == (403, {"detail": "invite_email_mismatch"})
    assert status(anon.post("/api/auth/signup", json=form | {"password": "short"})) == (422, {"detail": "password_too_short"})
    assert status(anon.post("/api/auth/signup", json=form | {"display_name": "  "})) == (422, {"detail": "bad_display_name"})
    res = anon.post("/api/auth/signup", json=form | {"display_name": "새 사람"})
    assert res.status_code == 201
    user = res.json()["user"]
    assert (user["display_name"], user["orgs"][0]["role"], user["instance_role"]) == ("새 사람", "member", "user")
    me = h.AuthClient(api.app, base_url="http://127.0.0.1")
    me.bearer = res.json()["access_token"]
    spaces = me.get("/api/spaces").json()["spaces"]
    assert [(s["kind"], s["name"], s["role"]) for s in spaces] == [("personal", "내 스페이스", "admin"), ("shared", "팀", "member")]
    assert status(anon.post("/api/auth/signup", json=form)) == (404, {"detail": "invite_invalid"})  # 횟수 다 씀
    # 이메일 지정 없는 초대 · 이미 있는 이메일 · 기본 닉네임 · 만료 · 취소
    open_code = api.client.post("/api/admin/invites", json={"max_uses": 5}).json()["code"]
    assert status(anon.post("/api/auth/signup", json=form | {"code": open_code})) == (409, {"detail": "email_taken"})
    res = anon.post("/api/auth/signup", json={"code": open_code, "email": "kim.minji@brewai.test", "password": h.PASSWORD})
    assert res.json()["user"]["display_name"] == "kim.minji"
    invites = api.client.get("/api/admin/invites").json()
    revoke_id = next(i["id"] for i in invites if i["max_uses"] == 5)
    assert api.client.delete(f"/api/admin/invites/{revoke_id}").status_code == 204
    assert status(anon.post("/api/auth/invite/preview", json={"code": open_code})) == (404, {"detail": "invite_invalid"})
    late = api.client.post("/api/admin/invites", json={"days": 1}).json()["code"]
    advance(api, 86400 + 1)
    assert status(anon.post("/api/auth/invite/preview", json={"code": late})) == (404, {"detail": "invite_invalid"})


# ── 첫 관리자 · v1 → v2 마이그레이션 ─────────────────────────────────────────────────────

V1_SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE runs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, thread_id TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'error', 'cancelled')), model TEXT NOT NULL, model_label TEXT NOT NULL,
  provider TEXT NOT NULL, reasoning TEXT NOT NULL, prompt TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '[]', messages TEXT, usage TEXT,
  error_code TEXT, started_at TEXT NOT NULL, finished_at TEXT, duration_ms INTEGER
);
CREATE TABLE model_health (gateway_id TEXT PRIMARY KEY, last_ok_at TEXT, last_error_code TEXT, last_error_at TEXT, last_source TEXT);
INSERT INTO threads VALUES ('old-1', '옛 대화', '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:01.000Z');
INSERT INTO runs (id, thread_id, status, model, model_label, provider, reasoning, prompt, messages, started_at, finished_at)
  VALUES ('old-run', 'old-1', 'done', 'fake-chat-small', 'Small', 'openai', 'off', '옛 질문', '[]', '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:01.000Z');
PRAGMA user_version = 1;
"""


def test_v1_database_is_backed_up_migrated_and_adopted(make_api, tmp_path, h) -> None:
    path = tmp_path / "conductor.sqlite3"
    db = sqlite3.connect(path)
    db.executescript(V1_SCHEMA)
    db.close()
    store = Store(path)
    bak = sqlite3.connect(tmp_path / "conductor.sqlite3.v1.bak")
    assert bak.execute("PRAGMA user_version").fetchone()[0] == 1  # 바꾸기 전 원본
    assert bak.execute("SELECT name FROM sqlite_master WHERE name = 'users'").fetchone() is None
    bak.close()
    assert store.query("PRAGMA user_version")[0][0] == SCHEMA_VERSION
    assert store.query("SELECT space_id FROM threads WHERE id = 'old-1'")[0]["space_id"] is None
    api = new_api(make_api, store=store)  # create_app = 첫 관리자 시드 + 옛 대화 귀속
    personal = api.me["personal_space_id"]
    run = store.query("SELECT user_id, space_id, org_id FROM runs WHERE id = 'old-run'")[0]
    assert (run["user_id"], run["space_id"], run["org_id"]) == (api.me["id"], personal, api.me["orgs"][0]["id"])
    threads = api.client.get("/api/threads").json()
    assert [(t["id"], t["mine"], t["visibility"]) for t in threads] == [("old-1", True, "private")]
    assert [(c["kind"], c["name"]) for c in threads[0]["path"]] == [("org", "우리 팀"), ("space", "내 스페이스"), ("thread", "옛 대화")]
    assert api.me["instance_role"] == "admin" and api.me["orgs"][0]["role"] == "owner"
    assert store.query("SELECT detail FROM audit_events WHERE action = 'bootstrap'")[0]["detail"] == '{"adopted_threads": 1}'
    # 다시 켜도 그대로 (users 가 있으면 시드 안 함 · 백업도 첫 것 유지)
    assert Directory(Accounts(store, password_min=15)).bootstrap("other@brewai.test", "x" * 30) is None
    assert store.query("SELECT COUNT(*) AS n FROM users")[0]["n"] == 1


def test_no_admin_env_means_needs_bootstrap(h) -> None:
    store = Store(":memory:")
    acc = Accounts(store, password_min=15)
    assert Directory(acc).bootstrap(None, None) is None
    assert Directory(acc).bootstrap("dev@brewai.local", "too-short") is None  # 약한 값으로는 안 만든다
    settings = replace(h.SETTINGS, admin_email=None, admin_password=None)
    app = create_app(settings, catalog=h.MemoryCatalog([]), runtime=ChatRuntime(gateway_url="http://x.invalid", gateway_key="k"), store=store)
    with TestClient(app, base_url="http://127.0.0.1") as c:
        state = c.get("/api/auth/state").json()
        assert state == {"needs_bootstrap": True, "first_login": True, "providers": {"password": True, "google": False}, "password_min": 15}


def test_first_login_hint_until_someone_logs_in(h) -> None:
    """첫 관리자가 생겼지만 아직 아무도 로그인 안 함 → first_login (로그인 화면이 .env 값을 알려 준다)."""
    store = Store(":memory:")
    app = create_app(h.SETTINGS, catalog=h.MemoryCatalog([]), runtime=ChatRuntime(gateway_url="http://x.invalid", gateway_key="k"), store=store)
    with TestClient(app, base_url="http://127.0.0.1") as c:
        assert c.get("/api/auth/state").json()["first_login"] is True
        assert c.post("/api/auth/login", json={"email": h.ADMIN_EMAIL, "password": h.ADMIN_PASSWORD}).status_code == 200
        state = c.get("/api/auth/state").json()
        assert (state["needs_bootstrap"], state["first_login"]) == (False, False)


@pytest.mark.parametrize(("raw", "min_length", "code"), [("a" * 14, 15, "password_too_short"), ("a" * 15, 15, None),
                                                           ("a" * 129, 15, "password_too_long"), (" " * 15, 15, None)])
def test_password_rules(raw: str, min_length: int, code: str | None) -> None:
    assert passwords.problem(raw, min_length) == code
