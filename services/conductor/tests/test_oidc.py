"""Google 로그인 (OIDC code + PKCE · 서버 교환 · loopback handoff) — Google 은 httpx2.MockTransport (ADR-0010 · slice 03)."""

from __future__ import annotations

import base64
import json
import secrets
import time
from dataclasses import replace
from datetime import timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx2
import pytest
from pydantic_ai.models.test import TestModel

from conductor.auth import tokens
from conductor.auth.google import GoogleOIDC, OIDCError, check_claims

ISSUER = "https://accounts.google.com"
CLIENT_ID = "brewai-test.apps.googleusercontent.com"
PORT = 54321


def b64(data: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()


class FakeGoogle:
    """discovery + token endpoint. account = 다음 로그인 계정 · bad = id_token claim 덮어쓰기."""

    def __init__(self) -> None:
        self.account: dict[str, Any] = {"sub": "g-1", "email": "minji@gmail.com", "email_verified": True, "name": "민지"}
        self.bad: dict[str, Any] = {}
        self.nonces: dict[str, str] = {}  # Google 이 받은 code → 그때의 nonce (authorize 를 흉내)
        self.posts: list[dict[str, list[str]]] = []

    def approve(self, authorize_url: str) -> tuple[str, str]:
        """사람이 '허용'을 누른 것 = (state, code)."""
        q = {k: v[0] for k, v in parse_qs(urlsplit(authorize_url).query).items()}
        code = f"4/{secrets.token_urlsafe(8)}"
        self.nonces[code] = q["nonce"]
        return q["state"], code

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        if request.url.path == "/.well-known/openid-configuration":
            return httpx2.Response(200, json={
                "issuer": ISSUER, "authorization_endpoint": f"{ISSUER}/o/oauth2/v2/auth", "token_endpoint": "https://oauth2.googleapis.com/token",
            })
        form = parse_qs(request.content.decode())
        self.posts.append(form)
        code = form["code"][0]
        if code not in self.nonces or form["client_secret"] != ["google-secret"] or len(form["code_verifier"][0]) < 43:
            return httpx2.Response(400, json={"error": "invalid_grant"})
        now = int(time.time())
        claims = {"iss": ISSUER, "aud": CLIENT_ID, "azp": CLIENT_ID, "iat": now, "exp": now + 3600, "nonce": self.nonces.pop(code)}
        claims |= self.account | self.bad
        return httpx2.Response(200, json={"id_token": f"{b64({'alg': 'RS256'})}.{b64(claims)}.sig", "access_token": "ya29.x"})


@pytest.fixture
def google(make_api, h):
    """Google 이 켜진 conductor + 가짜 Google. (api, fake)."""

    def make(**overrides: Any):
        fake = FakeGoogle()
        settings = replace(h.SETTINGS, google_client_id=CLIENT_ID, google_client_secret="google-secret", **overrides)
        oidc = GoogleOIDC(settings, client=httpx2.AsyncClient(transport=httpx2.MockTransport(fake.handler)))
        return make_api(lambda _: TestModel(), settings=settings, app_kw={"google": oidc}), fake

    return make


def desktop_start(client, fake: FakeGoogle, **extra: str) -> dict[str, str]:
    """데스크톱 main 이 하는 일: verifier · ds 를 만들고 시스템 브라우저로 start → Google 이 허용."""
    verifier, ds = secrets.token_urlsafe(48), secrets.token_urlsafe(12)
    res = client.get(
        "/api/auth/google/start", params={"client": "desktop", "port": PORT, "cc": tokens.s256(verifier), "ds": ds, **extra},
        follow_redirects=False,
    )
    assert res.status_code == 302, res.text
    state, code = fake.approve(res.headers["location"])
    return {"verifier": verifier, "ds": ds, "state": state, "code": code, "authorize": res.headers["location"]}


def callback(client, flow: dict[str, str]) -> dict[str, str]:
    res = client.get("/api/auth/google/callback", params={"state": flow["state"], "code": flow["code"]}, follow_redirects=False)
    assert res.status_code == 302, res.text
    loc = urlsplit(res.headers["location"])
    assert (loc.scheme, loc.netloc, loc.path) == ("http", f"127.0.0.1:{PORT}", "/cb")  # host 고정 · start 의 port
    out = {k: v[0] for k, v in parse_qs(loc.query).items()}
    assert out["ds"] == flow["ds"]
    return out


def redeem(api, back: dict[str, str], verifier: str):
    return api.anon().post("/api/auth/token", json={"grant_type": "handoff", "code": back.get("code"), "code_verifier": verifier})


def link_round_trip(api, fake, me, *, complete=None):
    """설정 › 계정 › Google 연결: 연결 표 → 브라우저 → 콜백(code) → 앱이 로그인한 채 complete. (콜백 쿼리, complete 응답 | None).
    complete = code 를 내는 사람 (기본 me = 연결을 시작한 본인)."""
    link = me.post("/api/me/google/link").json()["link"]
    browser = api.anon()
    flow = desktop_start(browser, fake, link=link)
    back = callback(browser, flow)
    if "code" not in back:
        return back, None
    body = {"code": back["code"], "code_verifier": flow["verifier"]}
    return back, (complete or me).post("/api/me/google/link/complete", json=body)


def full_login(api, fake, **extra: str):
    """start → 허용 → 콜백 → (handoff 가 오면) 세션. (콜백 쿼리, 토큰 응답 | None)."""
    browser = api.anon()  # 시스템 브라우저 (바인딩 쿠키는 이 브라우저에만)
    flow = desktop_start(browser, fake, **extra)
    back = callback(browser, flow)
    return back, (redeem(api, back, flow["verifier"]) if "code" in back else None)


# ── 흐름 전체 ─────────────────────────────────────────────────────────────────


def test_desktop_google_login_with_invite_then_returning(google) -> None:
    api, fake = google()
    code = api.client.post("/api/admin/invites", json={}).json()["code"]
    browser = api.anon()
    flow = desktop_start(browser, fake, invite=code)
    q = {k: v[0] for k, v in parse_qs(urlsplit(flow["authorize"]).query).items()}
    assert flow["authorize"].startswith(f"{ISSUER}/o/oauth2/v2/auth?")
    assert q | {"response_type": "code", "client_id": CLIENT_ID, "scope": "openid email profile", "code_challenge_method": "S256",
                "redirect_uri": "http://127.0.0.1:8787/api/auth/google/callback"} == q
    assert q["code_challenge"] != tokens.s256(flow["verifier"])  # Google 용 PKCE 는 서버 것 · 데스크톱 verifier 는 handoff 용
    back = callback(browser, flow)
    assert back["code"].startswith("bwh_")
    assert fake.posts[0]["redirect_uri"] == ["http://127.0.0.1:8787/api/auth/google/callback"]
    # handoff 는 PKCE S256 에 묶임 · 60초 · 1회
    assert redeem(api, back, secrets.token_urlsafe(48)).json() == {"detail": "invalid_grant"}
    res = redeem(api, back, flow["verifier"])
    assert res.status_code == 401  # 틀린 verifier 시도에서 이미 썼다 (1회)
    back, res = full_login(api, fake)  # 같은 Google 계정 = identities(issuer, sub) 로 그 사람
    assert res.status_code == 200
    user = res.json()["user"]
    assert (user["email"], user["display_name"], user["has_password"]) == ("minji@gmail.com", "민지", False)
    assert user["google"]["email"] == "minji@gmail.com" and user["orgs"][0]["role"] == "member"
    assert redeem(api, back, "x" * 43).status_code == 401
    rows = api.store.query("SELECT provider, issuer, subject FROM identities WHERE user_id = ?", (user["id"],))
    assert [tuple(r) for r in rows] == [("google", ISSUER, "g-1")]
    assert api.store.query("SELECT uses FROM invites")[0]["uses"] == 1


def test_handoff_expires_after_60_seconds(google) -> None:
    api, fake = google()
    api.add_user("minji@gmail.com")  # gmail = Google 이 권위 → 자동 연결
    browser = api.anon()
    flow = desktop_start(browser, fake)
    back = callback(browser, flow)
    acc = api.app.state.accounts
    base = acc.clock()
    acc.clock = lambda: base + timedelta(seconds=61)
    assert redeem(api, back, flow["verifier"]).json() == {"detail": "invalid_grant"}


# ── claim 검사 ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("bad", "error"),
    [
        ({"nonce": "other-nonce"}, "invalid_id_token"),
        ({"aud": "someone-else.apps.googleusercontent.com"}, "invalid_id_token"),
        ({"aud": [CLIENT_ID, "x"], "azp": "x"}, "invalid_id_token"),
        ({"iss": "https://evil.example"}, "invalid_id_token"),
        ({"exp": 1_000_000}, "invalid_id_token"),
        ({"iat": int(time.time()) + 3600}, "invalid_id_token"),
        ({"sub": ""}, "invalid_id_token"),
        ({"email_verified": False}, "email_unverified"),
        ({"email_verified": "false"}, "email_unverified"),
    ],
)
def test_bad_claims_are_rejected_without_creating_anyone(google, bad: dict[str, Any], error: str) -> None:
    api, fake = google()
    code = api.client.post("/api/admin/invites", json={}).json()["code"]
    fake.bad = bad
    back, res = full_login(api, fake, invite=code)
    assert back.get("error") == error and res is None
    assert api.store.query("SELECT COUNT(*) AS n FROM users")[0]["n"] == 1
    assert api.store.query("SELECT uses FROM invites")[0]["uses"] == 0


def test_check_claims_accepts_google_bare_issuer() -> None:
    now = time.time()
    claims = {"iss": "accounts.google.com", "aud": CLIENT_ID, "iat": now, "exp": now + 60, "nonce": "n", "sub": "1"}
    assert check_claims(claims, issuer=ISSUER, client_id=CLIENT_ID, nonce="n") == claims
    with pytest.raises(OIDCError):
        check_claims(claims | {"iss": "accounts.google.com"}, issuer="https://other.example", client_id=CLIENT_ID, nonce="n")


# ── 사람 결정 규칙 (slice 03 순서표) ─────────────────────────────────────────────────


def test_domain_auto_signup_uses_hd_not_email_suffix(google) -> None:
    api, fake = google()
    org = api.me["orgs"][0]["id"]
    assert api.client.patch(f"/api/admin/orgs/{org}", json={"join_policy": "domain_auto"}).json() == {"detail": "google_hd_required"}
    api.client.patch(f"/api/admin/orgs/{org}", json={"join_policy": "domain_auto", "google_hd": "Corp.Example"})
    # hd 가 다르면 (이메일이 corp.example 이어도) 초대받지 않은 사람
    fake.account = {"sub": "g-2", "email": "lee@corp.example", "email_verified": True, "hd": "other.example"}
    back, _ = full_login(api, fake)
    assert back["error"] == "not_invited"
    fake.account = {"sub": "g-3", "email": "lee@corp.example", "email_verified": True}  # hd 없음 (개인 계정)
    assert full_login(api, fake)[0]["error"] == "not_invited"
    fake.account = {"sub": "g-4", "email": "lee@corp.example", "email_verified": True, "hd": "corp.example", "name": "이"}
    back, res = full_login(api, fake)
    assert res.status_code == 200 and res.json()["user"]["orgs"][0]["role"] == "member"
    assert res.json()["user"]["display_name"] == "이"


def test_same_email_links_only_when_google_is_authoritative(google) -> None:
    api, fake = google()
    gmail = api.add_user("minji@gmail.com")
    corp = api.add_user("park@company.test")
    back, res = full_login(api, fake)  # @gmail.com = 권위 → 자동 연결
    assert res.json()["user"]["id"] == gmail and res.json()["user"]["has_password"] is True
    assert api.store.query("SELECT actor_user_id FROM audit_events WHERE action = 'google_auto_link'")[0][0] == gmail
    fake.account = {"sub": "g-9", "email": "park@company.test", "email_verified": True}  # 개인 Google 에 회사 메일 = 권위 없음
    assert full_login(api, fake)[0]["error"] == "link_required"
    fake.account |= {"hd": "company.test"}  # Workspace = 권위
    back, res = full_login(api, fake)
    assert res.json()["user"]["id"] == corp
    # 이미 다른 Google 이 붙은 계정에 또 다른 Google = link_required (덮어쓰지 않는다)
    fake.account = {"sub": "g-10", "email": "park@company.test", "email_verified": True, "hd": "company.test"}
    assert full_login(api, fake)[0]["error"] == "link_required"
    fake.account = {"sub": "g-11", "email": "nobody@gmail.com", "email_verified": True}
    assert full_login(api, fake)[0]["error"] == "not_invited"
    api.store.query("UPDATE users SET status = 'disabled' WHERE id = ?", (gmail,))
    fake.account = {"sub": "g-1", "email": "minji@gmail.com", "email_verified": True}
    assert full_login(api, fake)[0]["error"] == "account_disabled"


def test_link_and_unlink_from_settings(google, h) -> None:
    api, fake = google()
    b = api.add_user("b@brewai.test")
    me = api.login("b@brewai.test")
    link = me.post("/api/me/google/link").json()
    assert link["link"].startswith("bwl_") and link["expires_in"] == 300
    fake.account = {"sub": "g-b", "email": "b.personal@gmail.com", "email_verified": False}  # 연결은 본인이 시작 = 이메일과 무관
    browser = api.anon()
    flow = desktop_start(browser, fake, link=link["link"])
    back = callback(browser, flow)
    assert back["code"].startswith("bwh_") and "linked" not in back  # 콜백은 아직 붙이지 않는다
    assert me.get("/api/me").json()["google"] is None
    assert redeem(api, back, flow["verifier"]).json() == {"detail": "invalid_grant"}  # 연결 code 로 로그인은 안 된다 (1회 · 태움)
    back, res = link_round_trip(api, fake, me)
    assert res.status_code == 200 and res.json()["google"]["email"] == "b.personal@gmail.com"
    assert me.get("/api/me").json()["google"]["email"] == "b.personal@gmail.com"
    again = api.anon().get("/api/auth/google/start", params={"client": "desktop", "port": PORT, "cc": "a" * 43, "ds": "dsdsdsds",
                                                             "link": link["link"]}, follow_redirects=False)
    assert again.json() == {"detail": "link_expired"}
    # 다른 사람의 Google 을 내 계정에 = identity_in_use
    other = api.login(h.ADMIN_EMAIL, h.ADMIN_PASSWORD)
    back, _ = link_round_trip(api, fake, other)
    assert back["error"] == "identity_in_use"
    # 이제 Google 로 로그인 = b
    fake.account = {"sub": "g-b", "email": "b.personal@gmail.com", "email_verified": True}
    assert full_login(api, fake)[1].json()["user"]["id"] == b
    assert me.delete("/api/me/google").status_code == 204
    assert me.delete("/api/me/google").json() == {"detail": "not_linked"}
    # 비밀번호 없는 계정은 마지막 로그인 수단을 못 뗀다
    code = api.client.post("/api/admin/invites", json={}).json()["code"]
    fake.account = {"sub": "g-new", "email": "solo@gmail.com", "email_verified": True}
    _, res = full_login(api, fake, invite=code)
    solo = h.AuthClient(api.app, base_url="http://127.0.0.1")
    solo.bearer = res.json()["access_token"]
    assert solo.delete("/api/me/google").json() == {"detail": "last_login_method"}


def test_link_started_by_someone_else_cannot_attach_my_google(google, h) -> None:
    """연결 CSRF: eve 가 자기 연결 표로 만든 시작 주소를 남에게 보낸다 → 남의 Google 이 eve 계정에 붙지 않는다."""
    api, fake = google()
    eve_id = api.add_user("eve@brewai.test")
    eve = api.login("eve@brewai.test")
    victim = api.anon()  # 피해자 브라우저 · Google = minji@gmail.com
    flow = desktop_start(victim, fake, link=eve.post("/api/me/google/link").json()["link"])
    back = callback(victim, flow)
    assert "linked" not in back and back["code"].startswith("bwh_")  # code 는 피해자 PC 의 127.0.0.1 로 간다 (eve 는 못 받는다)
    assert api.store.query("SELECT COUNT(*) AS n FROM identities WHERE provider = 'google'")[0]["n"] == 0
    # eve 가 code 를 손에 넣어도 verifier 없이는 · 다른 사람이 내면 · 로그인으로 바꿔도 안 된다
    assert eve.post("/api/me/google/link/complete", json={"code": back["code"], "code_verifier": "x" * 43}).json() == {"detail": "invalid_grant"}
    back, res = link_round_trip(api, fake, eve, complete=api.login(h.ADMIN_EMAIL, h.ADMIN_PASSWORD))
    assert res.status_code == 400 and res.json() == {"detail": "invalid_grant"}
    # 피해자의 다음 'Google로 계속' = eve 계정이 아니다
    back, res = full_login(api, fake)
    assert back.get("error") == "not_invited" and res is None
    assert eve_id not in {r["user_id"] for r in api.store.query("SELECT user_id FROM identities WHERE provider = 'google'")}


def test_google_claims_open_invite_password_account(google, h) -> None:
    """계정 선점: 열린 초대 코드를 가진 사람이 남의 @gmail.com 으로 비밀번호 가입 → 주인이 Google 로 오면
    그 계정의 비밀번호 · 세션이 끊긴다 (먼저 가입한 사람은 더 못 들어온다). 이메일을 정한 초대 · 관리자 계정은 그대로."""
    api, fake = google()
    code = api.client.post("/api/admin/invites", json={"max_uses": 5}).json()["code"]
    attacker = api.anon()
    r = attacker.post("/api/auth/signup", json={"code": code, "email": "minji@gmail.com", "password": "attacker-password-123"})
    assert r.status_code == 201
    squatted, refresh = r.json()["user"]["id"], r.json()["refresh_token"]
    back, res = full_login(api, fake)  # 진짜 minji 가 Google 로
    me = res.json()["user"]
    assert me["id"] == squatted and me["has_password"] is False and me["google"]["email"] == "minji@gmail.com"
    assert api.anon().post("/api/auth/login", json={"email": "minji@gmail.com", "password": "attacker-password-123"}).status_code == 401
    assert api.anon().post("/api/auth/token", json={"grant_type": "refresh_token", "refresh_token": refresh}).status_code == 401
    assert api.store.query("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'google_claim'")[0]["n"] == 1
    # 이메일을 정한 초대로 가입한 사람 = 주인 확인됨 → 자동 연결해도 비밀번호는 그대로
    bound = api.client.post("/api/admin/invites", json={"email": "park@gmail.com"}).json()["code"]
    assert api.anon().post("/api/auth/signup", json={"code": bound, "email": "park@gmail.com", "password": h.PASSWORD}).status_code == 201
    fake.account = {"sub": "g-park", "email": "park@gmail.com", "email_verified": True}
    back, res = full_login(api, fake)
    assert res.json()["user"]["has_password"] is True
    assert api.anon().post("/api/auth/login", json={"email": "park@gmail.com", "password": h.PASSWORD}).status_code == 200


# ── 브라우저 쪽 방어 ──────────────────────────────────────────────────────────────


def test_state_binding_and_cancel(google) -> None:
    api, fake = google()
    flow = desktop_start(api.anon(), fake)
    # 다른 브라우저(바인딩 쿠키 없음)가 콜백 = binding_mismatch (state 를 훔친 피싱 링크)
    assert callback(api.anon(), flow)["error"] == "binding_mismatch"
    # 같은 state 두 번 = 만료 화면
    res = api.anon().get("/api/auth/google/callback", params={"state": flow["state"], "code": "x"}, follow_redirects=False)
    assert res.status_code == 400 and "만료" in res.text
    browser = api.anon()
    flow = desktop_start(browser, fake)
    res = browser.get("/api/auth/google/callback", params={"state": flow["state"], "error": "access_denied"}, follow_redirects=False)
    assert parse_qs(urlsplit(res.headers["location"]).query)["error"] == ["cancelled"]
    assert res.headers["cache-control"] == "no-store" and res.headers["referrer-policy"] == "no-referrer"
    # desktop 은 port · cc · ds 가 필요하다
    bad = api.anon().get("/api/auth/google/start", params={"client": "desktop", "port": PORT, "cc": "short", "ds": "dsdsdsds"})
    assert bad.json() == {"detail": "bad_request"}


def test_admin_console_google_sets_cookie_only_for_instance_admin(google, h) -> None:
    api, fake = google()
    browser = api.anon()
    res = browser.get("/api/auth/google/start", params={"client": "admin"}, follow_redirects=False)
    q = parse_qs(urlsplit(res.headers["location"]).query)
    assert q["redirect_uri"] == ["http://localhost:5174/api/auth/google/callback"]
    state, code = fake.approve(res.headers["location"])
    fake.account = {"sub": "g-a", "email": h.ADMIN_EMAIL, "email_verified": True, "hd": "brewai.test"}  # 관리자 = 같은 이메일 Workspace
    res = browser.get("/api/auth/google/callback", params={"state": state, "code": code}, follow_redirects=False)
    assert res.headers["location"] == "/" and res.headers["set-cookie"].startswith("brewai_admin=bwc_")
    assert browser.get("/api/admin/auth/me").json()["user"]["email"] == h.ADMIN_EMAIL
    # 관리자 아님 = 쿠키 없음 · 가입도 안 함
    api.add_user("b@gmail.com")
    other = api.anon()
    res = other.get("/api/auth/google/start", params={"client": "admin"}, follow_redirects=False)
    state, code = fake.approve(res.headers["location"])
    fake.account = {"sub": "g-b", "email": "b@gmail.com", "email_verified": True}
    res = other.get("/api/auth/google/callback", params={"state": state, "code": code}, follow_redirects=False)
    assert res.headers["location"] == "/?auth_error=not_admin" and "brewai_admin=" not in res.headers.get("set-cookie", "")


# ── 켜고 끄기 ─────────────────────────────────────────────────────────────────


def test_google_hidden_without_keys(make_api) -> None:
    api = make_api(lambda _: TestModel())
    assert api.anon().get("/api/auth/state").json()["providers"] == {"password": True, "google": False}
    assert api.anon().get("/api/auth/google/start", params={"client": "admin"}).json() == {"detail": "google_disabled"}
    assert api.client.post("/api/me/google/link").json() == {"detail": "google_disabled"}


@pytest.mark.parametrize(
    ("issuer", "e2e", "public_url", "enabled"),
    [
        ("https://accounts.google.com", False, "http://127.0.0.1:8787", True),
        ("http://127.0.0.1:4012", False, "http://127.0.0.1:8787", False),  # http mock 은 E2E 에서만
        ("http://127.0.0.1:4012", True, "http://127.0.0.1:8787", True),
        ("http://127.0.0.1:4012", True, "https://brewai.example", False),  # E2E 여도 공개 주소가 loopback 이 아니면
    ],
)
def test_http_issuer_only_for_loopback_e2e(h, issuer: str, e2e: bool, public_url: str, enabled: bool) -> None:
    s = replace(h.SETTINGS, google_client_id=CLIENT_ID, google_client_secret="s", google_issuer=issuer, e2e=e2e, public_url=public_url)
    assert s.google_enabled is enabled
