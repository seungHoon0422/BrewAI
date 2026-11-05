"""사용량 (usage.py · store v3) — 실행마다 한 줄 기록 · 관리자 집계 · 게이트웨이 상태 요약 · 개수 · v2 → v3 채우기."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
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


def test_usage_trend_per_group_and_others(make_api, h) -> None:
    """개요 '단위별 추이' = 묶음 줄 · 나머지마다 하루별 호출 · 토큰 · 비용 (빈 날 0 · 비용 모름 None) · 합 = 그 묶음 합계."""
    api, *_ = setup(make_api, h)
    body = api.client.get("/api/admin/usage", params={"group": "model", "trend": "true", "series": "false", "limit": 1}).json()
    assert len(body["dates"]) == 7 and body["dates"][-1] == datetime.now(UTC).date().isoformat()
    top = body["groups"][0]
    assert top["key"] == "fake-chat-small" and top["trend"]["runs"] == [0] * 6 + [3]
    assert sum(top["trend"]["tokens"]) == top["tokens"] and top["trend"]["cost_usd"][:6] == [None] * 6
    assert body["others"]["trend"]["runs"] == [0] * 6 + [1] and sum(body["others"]["trend"]["tokens"]) == body["others"]["tokens"]
    assert "trend" not in api.client.get("/api/admin/usage", params={"group": "model"}).json()["groups"][0]  # 기본 = 안 보냄
    for group in ("org", "user", "space"):
        rows = api.client.get("/api/admin/usage", params={"group": group, "trend": "true"}).json()["groups"]
        assert all(sum(g["trend"]["runs"]) == g["runs"] for g in rows), group


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
    assert store.query("PRAGMA user_version")[0][0] == SCHEMA_VERSION
    assert not (tmp_path / "conductor.sqlite3.v3.bak").exists()  # v2 에서 오면 v2.bak 이 원본 (v4 백업을 또 만들지 않는다)
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



# ── 캐시 토큰 · 종류별 비용 (비용 분해) ──

CLAUDE_PRICES = {
    "input_cost_per_token": 3e-6, "output_cost_per_token": 1.5e-5,
    "cache_read_input_token_cost": 3e-7, "cache_creation_input_token_cost": 3.75e-6,
}


def _litellm_client(usage_body: dict) -> object:
    """LiteLLM 스트림 흉내 (OpenAI chunk + 마지막 usage 조각) — 진짜 OpenAIChatModel 이 usage 를 읽는다."""
    import httpx2
    from openai import AsyncOpenAI

    base = {"id": "chatcmpl-litellm", "created": 1761696000, "model": "claude-cache", "object": "chat.completion.chunk"}
    chunks = [
        base | {"choices": [{"index": 0, "delta": {"role": "assistant", "content": "답"}, "finish_reason": None}]},
        base | {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
        base | {"choices": [], "usage": usage_body},
    ]

    def handler(req: httpx2.Request) -> httpx2.Response:
        body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
        return httpx2.Response(200, content=body.encode(), headers={"content-type": "text/event-stream"})

    return AsyncOpenAI(
        base_url="http://gateway.invalid/v1", api_key="sk-test-secret-0000", max_retries=0,
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)),
    )


def test_litellm_cache_tokens_are_recorded_and_priced_per_kind(make_api, h) -> None:
    """LiteLLM usage: prompt_tokens_details.cached_tokens = 캐시 읽기 · cache_creation_input_tokens = 캐시 쓰기 (둘 다 prompt_tokens 안).
    비용 = 캐시 아닌 입력 × 입력가 + 캐시 읽기 × 읽기가 + 캐시 쓰기 × 쓰기가 + (출력 − 생각) × 출력가 + 생각 × 출력가."""
    body = {
        "prompt_tokens": 1000, "completion_tokens": 200, "total_tokens": 1200,
        "prompt_tokens_details": {"cached_tokens": 600}, "cache_creation_input_tokens": 100, "cache_read_input_tokens": 600,
        "completion_tokens_details": {"reasoning_tokens": 50},
    }
    items = [*h.fixture_items(), h.group("claude-cache", ["anthropic"], **CLAUDE_PRICES)]
    api = make_api(None, items, bootstrap_models=("claude-cache",), openai_client=_litellm_client(body))
    events = api.chat("캐시 질문", model="claude-cache")
    summary = next(e for e in events if e["type"] == "CUSTOM" and e["name"] == "brewai.run_summary")
    assert summary["value"]["usage"] | {"cache_read_tokens": 600, "cache_write_tokens": 100} == summary["value"]["usage"]

    row = dict(api.store.query("SELECT * FROM usage_events")[0])
    assert (row["input_tokens"], row["output_tokens"], row["reasoning_tokens"]) == (1000, 200, 50)
    assert (row["cache_read_tokens"], row["cache_write_tokens"], row["cost_estimated"]) == (600, 100, 0)
    want = {"input": 300 * 3e-6, "cache_read": 600 * 3e-7, "cache_write": 100 * 3.75e-6, "output": 150 * 1.5e-5, "reasoning": 50 * 1.5e-5}
    for k, v in want.items():
        assert abs(row[f"cost_{k}_usd"] - v) < 1e-12, k
    assert abs(row["cost_usd"] - sum(want.values())) < 1e-12

    t = api.client.get("/api/admin/usage").json()["totals"]
    assert t["tokens_by_kind"] == {"input": 300, "output": 150, "reasoning": 50, "cache_read": 600, "cache_write": 100}
    assert sum(t["tokens_by_kind"].values()) == t["tokens"] == 1200
    assert t["cache_hit_rate"] == 0.6 and (t["cache_read_tokens"], t["cache_write_tokens"]) == (600, 100)
    assert abs(sum(t["cost_by_kind"].values()) - t["cost_usd"]) < 1e-7 and t["cost_estimated_runs"] == 0
    by_model = api.client.get("/api/admin/usage", params={"group": "model", "model": "claude-cache"}).json()["groups"][0]
    assert by_model["cache_read_tokens"] == 600 and by_model["cost_by_kind"]["cache_write"] == round(100 * 3.75e-6, 8)


def test_cost_parts_math_and_missing_prices() -> None:
    p = usage.cost_parts(CLAUDE_PRICES, 1000, 200, 50, 600, 100)
    assert p is not None and p["estimated"] is False and set(p["parts"]) == set(usage.KINDS)
    assert abs(p["total"] - sum(p["parts"].values())) < 1e-12
    # 캐시 가격 모름 → 입력 가격으로 어림 (estimated) · 캐시 토큰이 없으면 어림 아님
    plain = {"input_cost_per_token": 1e-6, "output_cost_per_token": 2e-6}
    est = usage.cost_parts(plain, 1000, 10, 0, 600, 100)
    assert est is not None and est["estimated"] is True and est["parts"]["cache_read"] == round(600 * 1e-6, 10)
    assert abs(est["total"] - (1000 * 1e-6 + 10 * 2e-6)) < 1e-12  # 어림 = 전부 정가 입력
    only_read = {**plain, "cache_read_input_token_cost": 1e-7}
    assert usage.cost_parts(only_read, 100, 0, 0, 50, 0)["estimated"] is False  # type: ignore[index]
    assert usage.cost_parts(only_read, 100, 0, 0, 50, 5)["estimated"] is True  # type: ignore[index]
    assert usage.cost_parts(plain, 100, 10)["estimated"] is False  # type: ignore[index]
    # 입력 · 출력 가격이나 토큰을 모르면 None · 캐시가 입력보다 크면 캐시 아닌 입력 = 0 · 생각은 출력보다 클 수 없다
    assert usage.cost_parts({"output_cost_per_token": 1e-6}, 1, 1) is None and usage.cost_parts(plain, None, 1) is None
    odd = usage.cost_parts(plain, 10, 5, 99, 30, 0)
    assert odd is not None and odd["parts"]["input"] == 0 and odd["parts"]["output"] == 0 and odd["parts"]["reasoning"] == round(5 * 2e-6, 10)
    assert usage.estimate_cost(plain, 100, 10) == round(100 * 1e-6 + 10 * 2e-6, 10)


V3_OLD_TABLE = """
DROP TABLE usage_events;
CREATE TABLE usage_events (
  run_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL CHECK (status IN ('ok', 'error', 'cancelled')),
  error_code TEXT, user_id TEXT, org_id TEXT, space_id TEXT, model TEXT NOT NULL, model_label TEXT NOT NULL, provider TEXT NOT NULL,
  input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER, requests INTEGER, tool_calls INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL, duration_ms INTEGER
);
INSERT INTO model_exposure (gateway_id, sort_order, gateway_info, first_seen, last_seen)
  VALUES ('fake-chat-small', 1, '{"input_cost_per_token": 1e-06, "output_cost_per_token": 2e-06}', '', '');
INSERT INTO usage_events (run_id, started_at, status, model, model_label, provider, input_tokens, output_tokens, reasoning_tokens, cost_usd)
  VALUES ('old-ok', '2026-10-30T00:00:00.000Z', 'ok', 'fake-chat-small', 'Small', 'openai', 100, 30, 10, 0.5);
INSERT INTO model_exposure (gateway_id, sort_order, gateway_info, first_seen, last_seen)
  VALUES ('free-in', 2, '{"input_cost_per_token": 0, "output_cost_per_token": 2e-06}', '', '');
INSERT INTO usage_events (run_id, started_at, status, model, model_label, provider, input_tokens, output_tokens, reasoning_tokens, cost_usd)
  VALUES ('old-free-in', '2026-10-29T00:00:00.000Z', 'ok', 'free-in', 'Free in', 'openai', 1000, 10, 0, 0.00002);
INSERT INTO usage_events (run_id, started_at, status, model, model_label, provider)
  VALUES ('old-err', '2026-10-30T00:00:01.000Z', 'error', 'fake-chat-small', 'Small', 'openai');
"""


def test_existing_v3_table_gets_new_columns_once(tmp_path) -> None:
    """스키마 번호를 올리지 않는다: 옛 v3 표 = 칸이 없으면 더하고 (몇 번이든 같은 결과) · 옛 비용은 합을 지켜 나눈다."""
    path = tmp_path / "conductor.sqlite3"
    Store(path).close()
    db = sqlite3.connect(path)
    db.executescript(V3_OLD_TABLE)
    db.close()
    store = Store(path)  # 켤 때는 칸을 건드리지 않는다 (store.py 그대로) → 처음 읽거나 쓸 때
    assert store.query("PRAGMA user_version")[0][0] == SCHEMA_VERSION  # 칸 더하기는 스키마 번호와 무관
    with store.read() as conn:
        added = usage.ensure_columns(conn)
        assert added == [n for n, _ in usage.ADDED_COLUMNS]
        assert usage.ensure_columns(conn) == []  # 두 번째 = 아무것도 안 함
        out = usage.summary(conn, usage.window("2026-10-30", "2026-10-30"), usage.Filters())
    cols = {r[1] for r in store.query("PRAGMA table_info(usage_events)")}
    assert {n for n, _ in usage.ADDED_COLUMNS} <= cols
    old = dict(store.query("SELECT * FROM usage_events WHERE run_id = 'old-ok'")[0])
    parts = [old[f"cost_{k}_usd"] for k in usage.KINDS]
    assert abs(sum(parts) - 0.5) < 1e-9 and old["cost_cache_read_usd"] == 0 and old["cache_read_tokens"] is None
    # 지금 가격 비율: 입력 100 × 1e-6 : 출력 20 × 2e-6 : 생각 10 × 2e-6 = 100 : 40 : 20
    assert abs(old["cost_input_usd"] - 0.5 * 100 / 160) < 1e-9 and abs(old["cost_reasoning_usd"] - 0.5 * 20 / 160) < 1e-9
    assert old["cost_estimated"] is None  # 캐시를 몰라 정확한지 모른다 (0 = 정확 아님)
    # 입력 가격 0 = 무료 → 옛 비용은 전부 출력 (0 을 1 로 바꿔 입력에 싣지 않는다)
    free = dict(store.query("SELECT * FROM usage_events WHERE run_id = 'old-free-in'")[0])
    assert free["cost_input_usd"] == 0 and abs(free["cost_output_usd"] - 0.00002) < 1e-12
    err = dict(store.query("SELECT * FROM usage_events WHERE run_id = 'old-err'")[0])
    assert err["cost_input_usd"] is None and err["cost_estimated"] is None
    t = out["totals"]
    assert t["runs"] == 2 and t["cost_usd"] == 0.5 and abs(sum(t["cost_by_kind"].values()) - 0.5) < 1e-7
    assert t["cache_read_tokens"] == 0 and t["cache_hit_rate"] == 0.0
    store.close()
    again = Store(path)  # 다시 켜도 그대로
    with again.read() as conn:
        assert usage.ensure_columns(conn) == []
    assert again.query("SELECT COUNT(*) FROM usage_events")[0][0] == 3
    again.close()


def test_usage_sort_by_cost_and_others_carry_cost(make_api, h) -> None:
    api, b_id, *_ = setup(make_api, h)
    by_cost = api.client.get("/api/admin/usage", params={"group": "model", "sort": "cost"}).json()["groups"]
    assert [g["key"] for g in by_cost] == ["fake-chat-small", "fake-chat-large"]  # 큰 모델은 가격 모름 = 0 으로 뒤
    by_tokens = api.client.get("/api/admin/usage", params={"group": "user", "sort": "tokens"}).json()["groups"]
    assert by_tokens[0]["tokens"] >= by_tokens[1]["tokens"]
    one = api.client.get("/api/admin/usage", params={"group": "model", "sort": "cost", "limit": 1}).json()
    assert one["others"]["cost_usd"] is None and one["others"]["count"] == 1  # 나머지 = 큰 모델 (가격 모름)
    assert api.client.get("/api/admin/usage", params={"sort": "nope"}).status_code == 422


@pytest.mark.anyio
async def test_catalog_reads_cache_prices_from_model_info(h) -> None:
    import httpx2

    from conductor.gateway import LiteLLMCatalog

    def handler(req: httpx2.Request) -> httpx2.Response:
        if req.url.path == "/v1/model/info":
            return httpx2.Response(200, json={"data": [
                {"model_name": "fake-chat-small", "model_info": {"db_model": False, "cache_read_input_token_cost": 7.5e-8}},
                {"model_name": "fake-chat-large", "model_info": {"db_model": True, "cache_creation_input_token_cost": None}},
                {"model_name": "fake-chat-large", "model_info": {"db_model": True, "cache_creation_input_token_cost": 3.75e-6}},
                {"model_name": "fake-embed", "model_info": {"cache_read_input_token_cost": -1}},
            ]})
        return httpx2.Response(200, content=h.FIXTURE.read_bytes(), headers={"content-type": "application/json"})

    cat = LiteLLMCatalog("http://gateway.invalid", "sk-test", client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)))
    models = {m.id: m for m in await cat.list_models()}
    assert (models["fake-chat-small"].cache_read_input_token_cost, models["fake-chat-small"].cache_creation_input_token_cost) == (7.5e-8, None)
    assert models["fake-chat-large"].cache_creation_input_token_cost == 3.75e-6
    assert models["fake-embed"].cache_read_input_token_cost is None  # 음수 = 모름
    assert models["fake-chat-small"].row()["cache_read_input_token_cost"] == 7.5e-8  # model_exposure 스냅샷에 들어간다


def test_my_usage_is_only_mine(make_api, h) -> None:
    """설정 › 사용량 (GET /api/me/usage): 로그인한 사람 것만 · 묶음 = 하루 · 모델 · 스페이스 · 남의 실행 · 관리자 묶음은 없다."""
    api, b_id, team, _ = setup(make_api, h)
    b = api.login("b@brewai.test")
    mine = b.get("/api/me/usage", params={"group": "space"}).json()
    assert (mine["totals"]["runs"], mine["totals"]["errors"]) == (2, 1)  # b 의 두 실행 (관리자 2개는 안 셈)
    assert [(g["key"], g["label"]) for g in mine["groups"]] == [(team["id"], "팀")]
    assert mine["filters"] == {} and "active_users" not in mine["totals"] and b_id not in json.dumps(mine)
    admin = api.client.get("/api/me/usage", params={"group": "model"}).json()
    assert admin["totals"]["runs"] == 2 and sorted(g["key"] for g in admin["groups"]) == ["fake-chat-large", "fake-chat-small"]
    assert len(api.client.get("/api/me/usage").json()["series"]) == 7  # 기본 = 7일 하루별
    assert b.get("/api/me/usage", params={"group": "user"}).status_code == 422  # 사람별 · 조직별 묶음은 관리자만
    assert api.anon().get("/api/me/usage").status_code == 401
    assert SECRET_PROMPT not in json.dumps(admin, ensure_ascii=False)


def test_my_usage_by_project_org_and_drill_down_filters(make_api, h) -> None:
    """세부 보기: 묶음 = 프로젝트 · 조직 · 거르개(모델 · 프로젝트 · 스페이스 · 조직)는 늘 '나' 위에 · project=none = 프로젝트 밖."""
    api, _, team, org_id = setup(make_api, h)
    space = api.client.get("/api/spaces").json()["spaces"][0]["id"]
    proj = api.client.post(f"/api/spaces/{space}/projects", json={"name": "주간 보고"}).json()["id"]
    res = api.client.post("/api/chat", json=h.chat_body("프로젝트 안", thread="ap", run="rap", model="fake-chat-small", projectId=proj, spaceId=space))
    assert res.status_code == 200
    me = lambda **q: api.client.get("/api/me/usage", params=q).json()  # noqa: E731
    by_project = {g["key"]: g for g in me(group="project")["groups"]}
    assert by_project[proj]["label"] == "주간 보고" and by_project[proj]["runs"] == 1
    assert by_project["none"]["runs"] == 2 and by_project["none"]["label"] is None  # 프로젝트 밖 = 화면이 이름을 붙인다
    assert [(g["key"], g["runs"]) for g in me(group="org")["groups"]] == [(org_id, 3)]
    only = me(project=proj, group="model")
    assert only["totals"]["runs"] == 1 and only["filters"] == {"project": proj} and [g["key"] for g in only["groups"]] == ["fake-chat-small"]
    assert me(project="none")["totals"]["runs"] == 2
    assert me(model="fake-chat-large")["totals"]["runs"] == 1
    assert me(space=team["id"])["totals"]["runs"] == 0  # 팀 스페이스 실행은 b 의 것 = 나 위에 걸러도 0
    admin = api.client.get("/api/admin/usage", params={"group": "project", "project": proj}).json()
    assert admin["totals"]["runs"] == 1 and admin["groups"][0]["label"] == "주간 보고"
