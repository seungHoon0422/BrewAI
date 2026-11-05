"""API 키 (slice 12 · ADR-0017): 만들기(한 번만) · 해시 저장 · 표면 분리 · /v1 OpenAI 호환 (스트림 포함) · 사용량 키별 ·
정책 · 한도 (분당 · 하루 토큰 · 월 비용) · 폐기 · 만료 · 범위 · 관리자 · 비밀 0."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from conductor import apikeys

ANSWER = "키로 부른 답"


class Gateway:
    """가짜 LiteLLM /v1/chat/completions (스트림 · 한 번에 둘 다). 받은 본문을 남긴다."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def client(self) -> Any:
        import httpx2
        from openai import AsyncOpenAI

        def handler(req: httpx2.Request) -> httpx2.Response:
            body = json.loads(req.content)
            self.sent.append(body)
            usage = {"prompt_tokens": 120, "completion_tokens": 30, "total_tokens": 150}
            if body.get("stream"):
                base = {"id": "c1", "object": "chat.completion.chunk", "created": 1, "model": body["model"]}
                parts = [
                    {**base, "choices": [{"index": 0, "delta": {"role": "assistant", "content": ANSWER}, "finish_reason": None}]},
                    {**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
                    {**base, "choices": [], "usage": usage},
                ]
                text = "".join(f"data: {json.dumps(p, ensure_ascii=False)}\n\n" for p in parts) + "data: [DONE]\n\n"
                return httpx2.Response(200, content=text.encode(), headers={"content-type": "text/event-stream"})
            out = {"id": "c1", "object": "chat.completion", "created": 1, "model": body["model"], "usage": usage,
                   "choices": [{"index": 0, "message": {"role": "assistant", "content": ANSWER}, "finish_reason": "stop"}]}
            return httpx2.Response(200, json=out)

        return AsyncOpenAI(base_url="http://gateway.invalid/v1", api_key="sk-test-secret-0000", max_retries=0,
                           http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)))


@pytest.fixture
def world(make_api, h) -> Any:
    gw = Gateway()
    api = make_api(None, openai_client=gw.client())
    me = api.login(h.ADMIN_EMAIL, h.ADMIN_PASSWORD)
    return api, me, gw


def new_key(c: Any, **body: Any) -> tuple[str, dict[str, Any]]:
    res = c.post("/api/me/keys", json={"name": "내 스크립트", "scopes": ["models:read", "chat"], **body})
    assert res.status_code == 201, res.text
    return res.json()["key"], res.json()["item"]


def v1(api: Any, key: str | None, path: str, body: dict[str, Any] | None = None) -> Any:
    c = api.anon()
    headers = {"authorization": f"Bearer {key}"} if key else {}
    return c.post(path, json=body, headers=headers) if body is not None else c.get(path, headers=headers)


def chat(model: str = "fake-chat-small", **kw: Any) -> dict[str, Any]:
    return {"model": model, "messages": [{"role": "user", "content": "안녕"}], **kw}


def test_create_shows_key_once_and_stores_only_a_hash(world) -> None:
    api, me, _ = world
    raw, item = new_key(me)
    assert raw.startswith("bwk_") and len(raw) == 47
    assert item["hint"] == f"bwk_{raw[4:8]}…{raw[-4:]}" and item["status"] == "active" and item["scopes"] == ["models:read", "chat"]
    assert item["limits"] == {"rpm": 60, "tokens_per_day": 1_000_000, "usd_per_month": 20.0}  # 정책 기본값
    listed = me.get("/api/me/keys").json()
    assert raw not in json.dumps(listed) and listed["keys"][0]["id"] == item["id"] and listed["policy"]["max_days"] == 365
    dump = "\n".join(api.store._db.iterdump())
    assert raw not in dump and raw[4:] not in dump  # DB = sha256 · hint 만 (audit 포함)
    # 만료 = 기본 90일 · 정책 최대 365일 넘으면 거절 · 범위 · 이름 검사
    assert item["expires_at"][:10] == (datetime.now(UTC) + timedelta(days=90)).date().isoformat()
    assert me.post("/api/me/keys", json={"name": "x", "scopes": ["chat"], "days": 400}).json() == {"detail": "bad_days"}
    assert me.post("/api/me/keys", json={"name": "x", "scopes": ["admin"]}).json() == {"detail": "bad_scopes"}
    assert me.post("/api/me/keys", json={"name": " ", "scopes": ["chat"]}).json() == {"detail": "bad_name"}


def test_surfaces_are_separate(world) -> None:
    api, me, _ = world
    raw, _ = new_key(me)
    assert v1(api, raw, "/v1/models").status_code == 200
    assert api.anon().get("/api/me", headers={"authorization": f"Bearer {raw}"}).status_code == 401  # 키 = /api 거절
    assert v1(api, me.bearer, "/v1/models").json()["error"]["code"] == "invalid_api_key"  # 데스크톱 토큰 = /v1 거절
    assert v1(api, None, "/v1/models").status_code == 401
    assert v1(api, "bwk_" + "A" * 43, "/v1/models").json()["error"]["code"] == "invalid_api_key"


def test_models_and_chat_non_stream_and_stream_record_usage_per_key(world) -> None:
    api, me, gw = world
    raw, item = new_key(me)
    models = v1(api, raw, "/v1/models").json()
    assert models["object"] == "list" and [m["id"] for m in models["data"]] == [m["id"] for m in me.get("/api/models").json()]
    res = v1(api, raw, "/v1/chat/completions", chat(temperature=0.2, foo="dropped"))
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["choices"][0]["message"]["content"] == ANSWER and out["usage"]["total_tokens"] == 150
    sent = gw.sent[-1]
    assert sent["user"] == me.get("/api/me").json()["id"] and sent["metadata"] == {"brewai_key_id": item["id"]}
    assert "foo" not in sent and sent["temperature"] == 0.2
    # 스트림 = 조각 그대로 + [DONE] · 마지막 usage 조각
    res = v1(api, raw, "/v1/chat/completions", chat(stream=True))
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/event-stream")
    lines = [ln.removeprefix("data: ") for ln in res.text.split("\n\n") if ln.startswith("data: ")]
    assert lines[-1] == "[DONE]" and ANSWER in lines[0] and json.loads(lines[-2])["usage"]["prompt_tokens"] == 120
    assert gw.sent[-1]["stream_options"] == {"include_usage": True}
    # 사용량: 키별 두 줄 · 앱 대화와 갈린다
    by_key = {g["key"]: g for g in me.get("/api/me/usage", params={"group": "key"}).json()["groups"]}
    assert by_key[item["id"]]["runs"] == 2 and by_key[item["id"]]["tokens"] == 300 and by_key[item["id"]]["label"] == "내 스크립트"
    assert me.get("/api/me/keys").json()["keys"][0]["month"]["runs"] == 2
    assert me.get("/api/me/keys").json()["keys"][0]["last_used_at"] is not None


def test_model_scope_and_bad_body(world) -> None:
    api, me, _ = world
    models_only, _ = new_key(me, scopes=["models:read"])
    assert v1(api, models_only, "/v1/chat/completions", chat()).json()["error"]["code"] == "scope_missing"
    raw, _ = new_key(me)
    res = v1(api, raw, "/v1/chat/completions", chat(model="text-embed"))  # 대화 모델 아님 · 숨김 = 없는 것과 같다
    assert (res.status_code, res.json()["error"]["code"]) == (404, "model_not_found")
    assert v1(api, raw, "/v1/chat/completions", {"model": "fake-chat-small"}).json()["error"]["code"] == "bad_request"


def test_revoke_expire_and_disabled_user(world, h) -> None:
    api, me, _ = world
    raw, item = new_key(me)
    assert me.delete(f"/api/me/keys/{item['id']}").json()["status"] == "revoked"
    assert v1(api, raw, "/v1/models").json()["error"]["code"] == "key_revoked"
    # 남의 키 = 404 (있는지 숨김)
    api.add_user("bob@brewai.test")
    bob = api.login("bob@brewai.test")
    other, oitem = new_key(bob)
    assert me.delete(f"/api/me/keys/{oitem['id']}").status_code == 404
    # 만료 = 시계를 넘기면
    api.app.state.accounts.clock = lambda: datetime.now(UTC) + timedelta(days=91)
    assert v1(api, other, "/v1/models").json()["error"]["code"] == "key_expired"
    assert api.app.state.keys.get(oitem["id"])["status"] == "expired"  # (91일 뒤엔 데스크톱 로그인도 끝나 있다 → 판단 모듈로 본다)


def test_admin_policy_limits_and_force_revoke(world) -> None:
    api, me, _ = world
    raw, item = new_key(me)
    admin = api.client  # 관리자 쿠키 + CSRF
    listed = admin.get("/api/admin/keys").json()
    assert "keys" in listed, listed
    assert listed["keys"][0]["user"]["email"] == "admin@brewai.test" and raw not in json.dumps(listed)
    # 키마다 한도: 분당 2 → 세 번째 = 429 + Retry-After
    assert admin.patch(f"/api/admin/keys/{item['id']}", json={"limits": {"rpm": 2}}).json()["limits"]["rpm"] == 2
    assert v1(api, raw, "/v1/models").status_code == 200  # 모델 목록은 한도에 안 센다
    for _ in range(2):
        assert v1(api, raw, "/v1/chat/completions", chat()).status_code == 200
    res = v1(api, raw, "/v1/chat/completions", chat())
    assert (res.status_code, res.json()["error"]["code"]) == (429, "key_limit_rpm") and int(res.headers["retry-after"]) >= 1
    # 하루 토큰 한도 = 이미 쓴 300 토큰 ≥ 200 → 429 (분당은 무제한으로)
    admin.patch(f"/api/admin/keys/{item['id']}", json={"limits": {"rpm": None, "tokens_per_day": 200}})
    assert v1(api, raw, "/v1/chat/completions", chat()).json()["error"]["code"] == "key_limit_tokens"
    # 되돌리기 = 정책 기본값 · 정책 끄기 = 만들기 · 부르기 둘 다 거절
    assert admin.patch(f"/api/admin/keys/{item['id']}", json={"limits": None}).json()["custom_limits"] == []
    assert admin.patch("/api/admin/keys/policy", json={"enabled": False}).json()["enabled"] is False
    assert v1(api, raw, "/v1/models").json()["error"]["code"] == "api_keys_off"
    assert me.post("/api/me/keys", json={"name": "x", "scopes": ["chat"]}).json() == {"detail": "api_keys_off"}
    admin.patch("/api/admin/keys/policy", json={"enabled": True, "max_days": 30, "default_days": 30, "limits": {"usd_per_month": 5}})
    assert me.get("/api/me/keys").json()["policy"] == {
        "enabled": True, "default_days": 30, "max_days": 30, "limits": {"rpm": 60, "tokens_per_day": 1_000_000, "usd_per_month": 5}}
    assert admin.patch("/api/admin/keys/policy", json={"default_days": 40}).json() == {"detail": "bad_default_days"}
    assert admin.patch("/api/admin/keys/policy", json={"limits": {"rpm": -1}}).json() == {"detail": "bad_limits"}
    assert admin.delete(f"/api/admin/keys/{item['id']}").json()["status"] == "revoked"
    assert v1(api, raw, "/v1/models").json()["error"]["code"] == "key_revoked"
    # 사용자 표면은 관리자 경로를 못 쓴다
    assert me.get("/api/admin/keys").status_code == 401
    audit = json.dumps([dict(r) for r in api.store.query("SELECT * FROM audit_events WHERE action LIKE 'api_key%'")], ensure_ascii=False)
    assert "api_key_create" in audit and "api_key_limits" in audit and "api_key_policy" in audit and raw not in audit


def test_too_many_keys(world, monkeypatch) -> None:
    _, me, _ = world
    monkeypatch.setattr(apikeys, "MAX_ACTIVE_PER_USER", 2)
    new_key(me)
    new_key(me)
    assert me.post("/api/me/keys", json={"name": "x", "scopes": ["chat"]}).json() == {"detail": "too_many_keys"}
