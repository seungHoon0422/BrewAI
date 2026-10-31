"""사용량 (usage.py · store v3) — 실행마다 한 줄 기록 · 관리자 집계 · 게이트웨이 상태 요약 · 개수 · v2 → v3 채우기."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models.function import AgentInfo, FunctionModel

from conductor import usage
from conductor.gateway import GatewayError
from conductor.store import SCHEMA_VERSION, Store

SECRET_PROMPT = "비밀 질문 내용 7781"


def model(fail_on: str = "[fail]") -> FunctionModel:
    """질문에 [fail] 이 있으면 게이트웨이 500 · 아니면 짧은 답."""

    async def stream(messages: list[ModelMessage], info: AgentInfo) -> AsyncIterator[str]:
        text = json.dumps([str(m) for m in messages], ensure_ascii=False)
        if fail_on in text:
            raise ModelHTTPError(500, "fake-chat-small", {"message": "fake upstream failure"})
        for piece in ["답", "이에요"]:
            yield piece

    return FunctionModel(stream_function=stream)


def setup(make_api, h):
    """관리자(기본 조직 owner) · 멤버 b · 공유 스페이스 '팀' (b 가 만든다). 실행: 관리자 2(작은 1 · 큰 1) · b 2(성공 1 · 실패 1)."""
    api = make_api(lambda _: model())
    b_id = api.add_user("b@brewai.test", name="비")
    b = api.login("b@brewai.test")
    team = b.post("/api/spaces", json={"name": "팀", "visibility": "open"}).json()
    org_id = api.me["orgs"][0]["id"]

    def chat(client, text, *, thread, run, **props):
        res = client.post("/api/chat", json=h.chat_body(text, thread=thread, run=run, **props))
        assert res.status_code == 200, res.text
        return h.sse_events(res.text)

    chat(api.client, SECRET_PROMPT, thread="a1", run="ra1", model="fake-chat-small")
    chat(api.client, "두 번째", thread="a2", run="ra2", model="fake-chat-large")
    chat(b, "팀 질문", thread="b1", run="rb1", model="fake-chat-small", spaceId=team["id"])
    assert chat(b, "[fail] 실패", thread="b2", run="rb2", model="fake-chat-small", spaceId=team["id"])[-1]["type"] == "RUN_ERROR"
    return api, b_id, team, org_id


def test_every_closed_run_is_one_usage_row_without_chat_content(make_api, h) -> None:
    api, b_id, team, org_id = setup(make_api, h)
    rows = {r["run_id"]: dict(r) for r in api.store.query("SELECT * FROM usage_events")}
    assert set(rows) == {"ra1", "ra2", "rb1", "rb2"}
    ok, large, fail = rows["ra1"], rows["ra2"], rows["rb2"]
    assert (ok["status"], ok["user_id"], ok["org_id"], ok["model"], ok["provider"]) == ("ok", api.me["id"], org_id, "fake-chat-small", "openai")
    assert ok["input_tokens"] > 0 and ok["output_tokens"] > 0 and ok["requests"] == 1 and ok["tool_calls"] == 0
    # 비용 = 토큰 × 게이트웨이 가격 (fixture: small = 1.5e-7 · 6e-7) · 가격 없는 모델 = NULL (0 이 아니다)
    assert abs(ok["cost_usd"] - (ok["input_tokens"] * 1.5e-7 + ok["output_tokens"] * 6e-7)) < 1e-12
    assert large["cost_usd"] is None and large["input_tokens"] > 0
    assert (fail["status"], fail["error_code"], fail["input_tokens"], fail["cost_usd"]) == ("error", "model_error", None, None)
    assert rows["rb1"]["space_id"] == team["id"] and rows["rb1"]["user_id"] == b_id
    assert ok["duration_ms"] is not None and ok["started_at"].endswith("Z")
    # 표에 대화 내용이 들어갈 칸이 없다
    assert not {"prompt", "messages", "title", "steps"} & set(ok)
    # 대화를 지워도 사용량은 남는다
    assert api.client.delete("/api/threads/a1").status_code == 204
    assert api.store.query("SELECT COUNT(*) FROM runs WHERE id = 'ra1'")[0][0] == 0
    assert api.store.query("SELECT COUNT(*) FROM usage_events WHERE run_id = 'ra1'")[0][0] == 1


def test_admin_usage_totals_series_groups_and_filters(make_api, h) -> None:
    api, b_id, team, org_id = setup(make_api, h)
    res = api.client.get("/api/admin/usage")
    assert res.status_code == 200
    body = res.json()
    assert SECRET_PROMPT not in res.text and "팀 질문" not in res.text  # 숫자만
    t = body["totals"]
    assert (t["runs"], t["ok"], t["errors"], t["cancelled"], t["active_users"]) == (4, 3, 1, 0, 2)
    assert t["error_rate"] == 0.25 and t["tokens"] == t["input_tokens"] + t["output_tokens"] > 0
    assert t["cost_runs"] == 2 and t["cost_usd"] > 0  # 작은 모델 성공 둘만 값이 있다
    assert body["days"] == 7 and len(body["series"]) == 7 and body["series"][-1]["runs"] == 4 and body["series"][0]["runs"] == 0
    assert body["previous"]["runs"] == 0 and body["groups"] == []

    by_user = api.client.get("/api/admin/usage", params={"group": "user"}).json()["groups"]
    assert {(g["key"], g["label"], g["runs"], g["errors"]) for g in by_user} == {(api.me["id"], "admin", 2, 0), (b_id, "비", 2, 1)}
    by_model = api.client.get("/api/admin/usage", params={"group": "model"}).json()["groups"]
    assert [(g["key"], g["runs"]) for g in by_model] == [("fake-chat-small", 3), ("fake-chat-large", 1)]
    assert by_model[0]["share"] == 0.75 and by_model[0]["label"] and by_model[0]["provider"] == "openai"
    by_org = api.client.get("/api/admin/usage", params={"group": "org"}).json()["groups"]
    assert [(g["key"], g["label"], g["runs"]) for g in by_org] == [(org_id, "우리 팀", 4)]
    # 스페이스: 공유 스페이스는 이름 · 내 스페이스는 사람마다 나누지 않고 한 줄 (personal)
    by_space = api.client.get("/api/admin/usage", params={"group": "space"}).json()["groups"]
    assert {(g["key"], g["label"], g["runs"]) for g in by_space} == {(team["id"], "팀", 2), ("personal", None, 2)}

    def runs(**params: str) -> int:
        return api.client.get("/api/admin/usage", params=params).json()["totals"]["runs"]

    assert runs(user=b_id) == 2 and runs(space=team["id"]) == 2 and runs(space="personal") == 2
    assert runs(org=org_id) == 4 and runs(org="nope") == 0 and runs(model="fake-chat-large") == 1
    # 묶음 수 제한 = 나머지는 others 하나로
    limited = api.client.get("/api/admin/usage", params={"group": "model", "limit": 1}).json()
    assert len(limited["groups"]) == 1 and limited["others"] == limited["others"] | {"count": 1, "runs": 1}


def test_usage_window_timezone_and_bad_ranges(make_api, h) -> None:
    api, *_ = setup(make_api, h)
    today = datetime.now(UTC).date()
    old = (today - timedelta(days=40)).isoformat()
    assert api.client.get("/api/admin/usage", params={"from": old, "to": (today - timedelta(days=30)).isoformat()}).json()["totals"]["runs"] == 0
    month = api.client.get("/api/admin/usage", params={"from": (today - timedelta(days=29)).isoformat(), "to": today.isoformat()}).json()
    assert month["days"] == 30 and month["totals"]["runs"] == 4
    for params in ({"from": "2026-13-01"}, {"from": "2026-11-02", "to": "2026-11-01"}, {"from": "2020-01-01", "to": "2026-01-01"}):
        assert api.client.get("/api/admin/usage", params=params).status_code == 422, params
    assert api.client.get("/api/admin/usage", params={"tz": 9999}).status_code == 422
    assert api.client.get("/api/admin/usage", params={"group": "thread"}).status_code == 422
    # 하루 경계 = tz (UTC 23:30 의 실행 = 한국 다음 날)
    w = usage.window("2026-11-01", "2026-11-02", tz=540)
    assert w.bounds == ("2026-10-31T15:00:00.000Z", "2026-11-02T15:00:00.000Z") and w.previous.start.isoformat() == "2026-10-30"


def test_member_cannot_read_usage(make_api, h) -> None:
    api, b_id, *_ = setup(make_api, h)
    member = api.login("b@brewai.test")
    # 관리자 쿠키를 가진 채 강등된 사람 = 쿠키 세션은 살아 있지만 관리자가 아니다 → 403
    api.store.query("UPDATE users SET instance_role = 'admin' WHERE id = ?", (b_id,))
    demoted = api.login("b@brewai.test", admin=True)
    api.store.query("UPDATE users SET instance_role = 'user' WHERE id = ?", (b_id,))
    for path in ("/api/admin/usage", "/api/admin/usage/gateway", "/api/admin/stats"):
        assert member.get(path).status_code == 401  # Bearer 는 관리자 표면이 아니다 (쿠키 없음)
        assert api.anon().get(path).status_code == 401
        res = demoted.get(path)
        assert (res.status_code, res.json()) == (403, {"detail": "forbidden"})


def test_usage_groups_without_series_skip_previous_and_days(make_api, h) -> None:
    """개요의 조직 · 모델 카드 = 묶음 줄만 (series=false → 지난 기간 · 하루별 흐름 없음). 모델 이름 = 가장 최근 실행의 이름."""
    api, *_ = setup(make_api, h)
    full = api.client.get("/api/admin/usage?group=model").json()
    lite = api.client.get("/api/admin/usage?group=model&series=false").json()
    assert lite["previous"] is None and lite["series"] == [] and full["series"]
    assert lite["groups"] == full["groups"] and lite["totals"] == full["totals"]
    assert {g["key"]: g["provider"] for g in lite["groups"]} == {"fake-chat-small": "openai", "fake-chat-large": "openai"}


def test_gateway_status_summary_and_counts(make_api, h) -> None:
    api, *_ = setup(make_api, h)
    g = api.client.get("/api/admin/usage/gateway").json()
    assert g["status"] == "ok" and g["code"] is None and g["last_sync_at"]
    assert g["models"] | {} == g["models"] and g["models"]["exposed"] == 2 and g["models"]["missing"] == 0
    small = next(m for m in g["by_model"] if m["id"] == "fake-chat-small")
    assert (small["runs"], small["errors"], small["error_rate"]) == (3, 1, 0.3333)
    assert small["health"] == "error" and small["health_source"] == "chat"  # 마지막 실행이 게이트웨이 500
    assert g["models"]["failing"] == 1
    assert g["by_model"][0]["id"] == "fake-chat-small"  # 실패가 많은 모델이 위
    assert all(m["id"] != "fake-embed" for m in g["by_model"])  # 채팅에 안 쓰는 모델은 빼고
    # 게이트웨이가 꺼져도 200 = 마지막으로 본 목록 + down
    api.catalog.error = GatewayError("gateway_unreachable")
    api.app.state.registry._last = None  # 캐시 비우기
    down = api.client.get("/api/admin/usage/gateway").json()
    assert down["status"] == "down" and down["code"] == "gateway_unreachable" and len(down["by_model"]) == len(g["by_model"])

    s = api.client.get("/api/admin/stats").json()
    assert s["users"] == {"total": 2, "active": 2, "disabled": 0, "admins": 1}
    assert s["orgs"] == 1 and s["spaces"] == {"shared": 1, "archived": 0, "personal": 2}
    assert s["active_users"] == {"d7": 2, "d30": 2} and s["invites_active"] == 0


def test_cost_and_event_helpers() -> None:
    info = {"input_cost_per_token": 1e-6, "output_cost_per_token": 2e-6}
    assert usage.estimate_cost(info, 100, 10) == 0.00012
    assert usage.estimate_cost({}, 100, 10) is None and usage.estimate_cost(info, None, 10) is None
    assert usage.estimate_cost({"input_cost_per_token": True, "output_cost_per_token": 1}, 1, 1) is None
    run = {
        "id": "r", "status": "cancelled", "usage": None, "steps": json.dumps([{"name": "tool:calculator"}, {"name": "skill:x"}, {"name": "writing"}]),
        "started_at": "2026-11-01T00:00:00.000Z", "finished_at": None, "error_code": "client_disconnected", "user_id": "u", "org_id": "o",
        "space_id": "s", "model": "m", "model_label": "M", "provider": "openai", "duration_ms": 5,
    }
    ev = usage.usage_event(run, info)
    assert ev is not None and (ev["status"], ev["tool_calls"], ev["input_tokens"], ev["cost_usd"]) == ("cancelled", 2, None, None)
    assert usage.usage_event(run | {"status": "running"}, info) is None


V2_RUN = (
    "INSERT INTO threads (id, title, created_at, updated_at) VALUES ('t', '옛', '2026-10-30T00:00:00.000Z', '2026-10-30T00:00:00.000Z');"
    "INSERT INTO runs (id, thread_id, status, model, model_label, provider, reasoning, prompt, usage, started_at, finished_at, duration_ms)"
    " VALUES ('old', 't', 'done', 'fake-chat-small', 'Small', 'openai', 'off', '옛 질문',"
    " '{\"input_tokens\": 10, \"output_tokens\": 5, \"requests\": 1, \"tool_calls\": 0}', '2026-10-30T00:00:00.000Z', '2026-10-30T00:00:01.000Z', 1000);"
    "INSERT INTO runs (id, thread_id, status, model, model_label, provider, reasoning, prompt, started_at)"
    " VALUES ('stuck', 't', 'running', 'fake-chat-small', 'Small', 'openai', 'off', '멈춘 질문', '2026-10-30T00:01:00.000Z');"
)


def test_v2_database_is_backed_up_and_backfilled(tmp_path) -> None:
    path = tmp_path / "conductor.sqlite3"
    Store(path).close()  # 지금 모양으로 만든 뒤 v2 로 되돌린다 (사용량 표 없음)
    db = sqlite3.connect(path)
    db.executescript("DROP TABLE usage_events; PRAGMA user_version = 2;" + V2_RUN)
    db.close()
    store = Store(path)
    bak = sqlite3.connect(tmp_path / "conductor.sqlite3.v2.bak")
    assert bak.execute("PRAGMA user_version").fetchone()[0] == 2
    assert bak.execute("SELECT name FROM sqlite_master WHERE name = 'usage_events'").fetchone() is None
    bak.close()
    assert store.query("PRAGMA user_version")[0][0] == SCHEMA_VERSION == 3
    rows = {r["run_id"]: dict(r) for r in store.query("SELECT * FROM usage_events")}
    assert (rows["old"]["status"], rows["old"]["input_tokens"], rows["old"]["output_tokens"]) == ("ok", 10, 5)
    assert rows["stuck"]["status"] == "cancelled" and rows["stuck"]["error_code"] == "interrupted"  # 꺼진 뒤 닫은 실행도 한 줄
    store.close()
    again = Store(path)  # 다시 켜도 두 번 넣지 않는다
    assert again.query("SELECT COUNT(*) FROM usage_events")[0][0] == 2


def test_record_is_idempotent(make_api, h) -> None:
    api, *_ = setup(make_api, h)
    with api.store.tx() as db:
        assert usage.record(db, "ra1") is False  # 이미 있음
        assert usage.record(db, "nope") is False
    assert api.store.query("SELECT COUNT(*) FROM usage_events")[0][0] == 4

