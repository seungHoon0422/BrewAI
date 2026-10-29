"""모델 노출 관리 (ADR-0006 model_exposure) · provider 구분 — 등록은 LiteLLM, 우리는 노출·이름·순서·기본값만."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.test import TestModel

from conductor.providers import pretty_name, provider_of, providers_of


async def _ok(messages: list[ModelMessage], info: AgentInfo) -> AsyncIterator[str]:
    yield "ok"


def _gateway(h, *extra: dict) -> list[dict]:
    """LiteLLM 에 등록된 모델 = brewai-mock(키 없음) + Claude + GPT + 임베딩 (+ 추가)."""
    return [
        h.group("brewai-mock", ["openai"], max_output_tokens=8192),
        h.group("claude-sonnet-5-5", ["anthropic"], supports_reasoning=True, max_output_tokens=64000),
        h.group("gpt-6.1-sol", ["openai"]),
        h.group("text-embed", ["openai"], mode="embedding"),
        *extra,
    ]


def ids(rows: list[dict]) -> list[str]:
    return [r["id"] for r in rows]


def test_first_sync_exposes_only_the_keyless_mock(make_api, h) -> None:
    api = make_api(lambda _: TestModel(), _gateway(h), settings=h.SETTINGS, bootstrap_models=("brewai-mock",))
    models = api.client.get("/api/models").json()
    assert models == [
        {
            "id": "brewai-mock", "label": "BrewAI Mock", "provider": "brewai", "provider_label": "BrewAI", "family": "BrewAI Mock",
            "is_default": True, "supports_reasoning": False, "supports_tools": True, "supports_vision": True, "max_input_tokens": 128000,
        }
    ]
    rows = {r["id"]: r for r in api.client.get("/api/admin/models").json()}
    assert {k: r["state"] for k, r in rows.items()} == {
        "brewai-mock": "exposed",
        "claude-sonnet-5-5": "candidate",  # 새 채팅 모델 = 후보 (숨김)
        "gpt-6.1-sol": "candidate",
        "text-embed": "hidden",  # 채팅 모델 아님 = 후보도 아님
    }
    claude = rows["claude-sonnet-5-5"]
    assert claude | {"label": "Claude Sonnet 5.5", "display_name": None, "family": "Claude Sonnet", "provider": "anthropic",
                     "provider_label": "Anthropic", "providers": ["anthropic"], "provider_ids": ["anthropic"], "exposed": False,
                     "is_default": False, "status": "present", "order": 2} == claude
    assert rows["gpt-6.1-sol"]["label"] == "GPT-6.1 Sol" and rows["gpt-6.1-sol"]["provider"] == "openai"
    assert api.client.get("/api/admin/providers").json() == [
        {"id": "brewai", "label": "BrewAI", "total": 1, "exposed": 1, "candidates": 0, "missing": 0},
        {"id": "anthropic", "label": "Anthropic", "total": 1, "exposed": 0, "candidates": 1, "missing": 0},
        {"id": "openai", "label": "OpenAI", "total": 2, "exposed": 0, "candidates": 1, "missing": 0},
    ]


def test_chat_rejects_hidden_and_candidate_models(make_api, h) -> None:
    api = make_api(lambda _: FunctionModel(stream_function=_ok), _gateway(h), bootstrap_models=("brewai-mock",))
    for model in ("claude-sonnet-5-5", "text-embed", "nope"):
        assert api.client.post("/api/chat", json=h.chat_body(model=model)).json() == {"detail": "unknown_model"}
    assert api.client.patch("/api/admin/models/claude-sonnet-5-5", json={"exposed": True}).status_code == 200
    events = api.chat("안녕", model="claude-sonnet-5-5")
    assert events[1]["value"] | {"model": "claude-sonnet-5-5", "model_label": "Claude Sonnet 5.5", "provider": "anthropic"} == events[1]["value"]


def test_no_exposed_models_means_no_models(make_api, h) -> None:
    api = make_api(lambda _: TestModel(), _gateway(h), bootstrap_models=())
    assert api.client.get("/api/models").json() == []
    res = api.client.post("/api/chat", json=h.chat_body())
    assert (res.status_code, res.json()) == (503, {"detail": "no_models"})


def test_new_model_appears_later_as_candidate_and_missing_is_auto_hidden(make_api, h) -> None:
    api = make_api(lambda _: TestModel(), _gateway(h), bootstrap_models=("brewai-mock", "gpt-6.1-sol"))
    c = api.client
    assert ids(c.get("/api/models").json()) == ["brewai-mock", "gpt-6.1-sol"]
    assert c.patch("/api/admin/models/gpt-6.1-sol", json={"is_default": True}).json()["is_default"] is True
    assert ids(c.get("/api/models").json()) == ["gpt-6.1-sol", "brewai-mock"]  # 기본 먼저

    # LiteLLM 에서 gemini 를 추가하고 gpt 를 지웠다
    brewai, claude, _gpt, embed = _gateway(h)
    api.catalog.set([brewai, claude, embed, h.group("gemini-3-pro", ["vertex_ai"])])
    sync = c.post("/api/admin/models/sync").json()
    assert (sync["added"], sync["missing"], sync["restored"], sync["first_sync"]) == (["gemini-3-pro"], ["gpt-6.1-sol"], [], False)
    rows = {r["id"]: r for r in sync["models"]}
    assert rows["gemini-3-pro"] | {"state": "candidate", "provider": "google", "label": "Gemini 3 Pro", "order": 4} == rows["gemini-3-pro"]
    assert rows["gpt-6.1-sol"] | {"state": "missing", "status": "missing", "exposed": False, "is_default": False, "order": 5} == rows["gpt-6.1-sol"]
    assert ids(sync["models"]) == ["brewai-mock", "claude-sonnet-5-5", "text-embed", "gemini-3-pro", "gpt-6.1-sol"]  # 사라진 모델은 끝
    models = c.get("/api/models").json()
    assert [(m["id"], m["is_default"]) for m in models] == [("brewai-mock", True)]  # 기본이 사라지면 다음 노출 모델이 기본
    assert c.patch("/api/admin/models/gpt-6.1-sol", json={"exposed": True}).json() == {"detail": "model_missing"}

    api.catalog.set(_gateway(h))  # gpt 가 돌아왔다 → 숨김 그대로 (관리자가 다시 켠다) · gemini 는 사라짐
    sync = c.post("/api/admin/models/sync").json()
    assert (sync["restored"], sync["missing"]) == (["gpt-6.1-sol"], ["gemini-3-pro"])
    rows = {r["id"]: r for r in sync["models"]}
    assert rows["gpt-6.1-sol"]["state"] == "hidden" and rows["gemini-3-pro"]["state"] == "missing"
    assert c.get("/api/admin/gateway").json()["last_sync_at"] == sync["synced_at"]


def test_catalog_cache_hit_does_not_rewrite_the_db(make_api, h) -> None:
    api = make_api(lambda _: TestModel(), _gateway(h), bootstrap_models=("brewai-mock",))
    first = api.store.get_meta("last_sync_at")
    api.client.get("/api/models")
    api.client.get("/api/models")
    assert api.store.get_meta("last_sync_at") == first  # 같은 목록 객체(캐시) = 동기화 안 함
    api.catalog.set(_gateway(h))  # 캐시가 바뀜
    api.client.get("/api/models")
    assert api.store.get_meta("last_sync_at") != first


def test_patch_rename_reorder_default_and_hide(make_api, h) -> None:
    api = make_api(lambda _: TestModel(), _gateway(h), bootstrap_models=("brewai-mock", "claude-sonnet-5-5", "gpt-6.1-sol"))
    c = api.client
    row = c.patch("/api/admin/models/claude-sonnet-5-5", json={"display_name": "  Claude   추천  "}).json()
    assert (row["label"], row["display_name"], row["default_label"]) == ("Claude 추천", "Claude 추천", "Claude Sonnet 5.5")
    assert c.patch("/api/admin/models/claude-sonnet-5-5", json={"display_name": None}).json()["label"] == "Claude Sonnet 5.5"
    assert c.patch("/api/admin/models/claude-sonnet-5-5", json={"display_name": "   "}).json()["display_name"] is None

    row = c.patch("/api/admin/models/gpt-6.1-sol", json={"order": 1}).json()
    assert row["order"] == 1
    assert ids(c.get("/api/admin/models").json()) == ["gpt-6.1-sol", "brewai-mock", "claude-sonnet-5-5", "text-embed"]
    assert c.patch("/api/admin/models/gpt-6.1-sol", json={"order": 99}).json()["order"] == 4  # 끝으로 (넘치면 끝)
    assert ids(c.get("/api/models").json()) == ["brewai-mock", "claude-sonnet-5-5", "gpt-6.1-sol"]  # 기본 brewai-mock 먼저

    assert c.patch("/api/admin/models/claude-sonnet-5-5", json={"is_default": True}).json()["is_default"] is True
    assert [m["id"] for m in c.get("/api/models").json() if m["is_default"]] == ["claude-sonnet-5-5"]  # 기본은 하나
    hidden = c.patch("/api/admin/models/claude-sonnet-5-5", json={"exposed": False}).json()
    assert (hidden["state"], hidden["is_default"]) == ("hidden", False)  # 숨기면 기본도 풀린다
    assert c.get("/api/models").json()[0] | {"id": "brewai-mock", "is_default": True} == c.get("/api/models").json()[0]
    both = c.patch("/api/admin/models/claude-sonnet-5-5", json={"exposed": True, "is_default": True}).json()
    assert (both["state"], both["is_default"]) == ("exposed", True)
    # 후보에 손대면 후보 딱지가 떨어진다 (숨김 유지)
    assert c.patch("/api/admin/models/text-embed", json={"display_name": "임베딩"}).json()["state"] == "hidden"


@pytest.mark.parametrize(
    ("gateway_id", "body", "status", "detail"),
    [
        ("nope", {"exposed": True}, 404, "model_not_found"),
        ("text-embed", {"exposed": True}, 409, "not_chat_model"),
        ("gpt-6.1-sol", {"is_default": True}, 409, "default_requires_exposed"),  # 후보를 기본으로 = 먼저 노출
        ("gpt-6.1-sol", {}, 422, "empty_patch"),
        ("gpt-6.1-sol", {"exposed": None}, 422, "bad_exposed"),
        ("gpt-6.1-sol", {"order": None}, 422, "bad_order"),
        ("gpt-6.1-sol", {"display_name": "가" * 61}, 422, "bad_display_name"),
        ("gpt-6.1-sol", {"display_name": "줄\n바꿈"}, 200, None),  # 공백 정리 = '줄 바꿈'
        ("gpt-6.1-sol", {"display_name": "zero​width"}, 422, "bad_display_name"),
        # 타입·범위 오류도 같은 코드 (FastAPI 기본 목록이 아니라)
        ("gpt-6.1-sol", {"display_name": "a" * 201}, 422, "bad_display_name"),
        ("gpt-6.1-sol", {"display_name": 123}, 422, "bad_display_name"),
        ("gpt-6.1-sol", {"order": 0}, 422, "bad_order"),
        ("gpt-6.1-sol", {"order": 1.5}, 422, "bad_order"),
        ("gpt-6.1-sol", {"exposed": "yes"}, 422, "bad_exposed"),
        ("gpt-6.1-sol", {"is_default": 1}, 422, "bad_is_default"),
    ],
)
def test_patch_validation(make_api, h, gateway_id: str, body: dict, status: int, detail: str | None) -> None:
    api = make_api(lambda _: TestModel(), _gateway(h), bootstrap_models=("brewai-mock",))
    res = api.client.patch(f"/api/admin/models/{gateway_id}", json=body)
    assert res.status_code == status
    if detail:
        assert res.json() == {"detail": detail}


@pytest.mark.parametrize(
    "body",
    [
        {"exposed": "yes"},  # StrictBool
        {"order": 0},
        {"order": 1.5},
        {"price": 1},  # 가격·컨텍스트·provider 는 게이트웨이 값 — 여기서 못 바꾼다 (ADR-0006)
        {"provider": "openai"},
        {"max_input_tokens": 1},
    ],
)
def test_patch_rejects_registration_fields_and_bad_types(make_api, h, body: dict) -> None:
    api = make_api(lambda _: TestModel(), _gateway(h), bootstrap_models=("brewai-mock",))
    res = api.client.patch("/api/admin/models/gpt-6.1-sol", json=body)
    assert res.status_code == 422
    if not {"exposed", "order"} & body.keys():  # 모르는 칸 = 기본 422 목록 (bad_<칸> 아님)
        assert isinstance(res.json()["detail"], list)


def test_model_ids_with_slashes_and_no_register_route(make_api, h) -> None:
    api = make_api(lambda _: TestModel(), [h.group("openai/gpt-5-mini", ["openai"])], bootstrap_models=())
    row = api.client.patch("/api/admin/models/openai/gpt-5-mini", json={"exposed": True}).json()
    assert (row["id"], row["label"], row["state"]) == ("openai/gpt-5-mini", "GPT-5 mini", "exposed")
    assert api.client.post("/api/admin/models", json={"id": "x"}).status_code == 405  # 등록 API 없음
    assert api.client.put("/api/admin/models/openai/gpt-5-mini", json={}).status_code == 405


def test_gateway_info_and_ui_link(make_api, h) -> None:
    api = make_api(lambda _: TestModel())
    assert api.client.get("/api/admin/gateway").json() | {"kind": "litellm", "url": "http://gateway.invalid", "ui_url": "http://gateway.invalid/ui"} == api.client.get("/api/admin/gateway").json()
    api2 = make_api(lambda _: TestModel(), gateway_ui_url="http://127.0.0.1:4000/ui/?page=models")
    assert api2.client.get("/api/admin/gateway").json()["ui_url"] == "http://127.0.0.1:4000/ui/?page=models"


def test_exposure_survives_restart(make_api, h, tmp_path) -> None:
    from conductor.store import Store

    path = tmp_path / "c.sqlite3"
    api = make_api(lambda _: TestModel(), _gateway(h), store=Store(path), bootstrap_models=("brewai-mock",))
    api.client.patch("/api/admin/models/claude-sonnet-5-5", json={"exposed": True, "display_name": "클로드"})
    api.client.__exit__(None, None, None)
    api.store.close()
    again = make_api(lambda _: TestModel(), _gateway(h), store=Store(path), bootstrap_models=("gpt-6.1-sol",))
    assert [(m["id"], m["label"]) for m in again.client.get("/api/models").json()] == [("brewai-mock", "BrewAI Mock"), ("claude-sonnet-5-5", "클로드")]
    # 두 번째 시작은 첫 동기화가 아니다 → bootstrap 이 바뀌어도 관리자 결정을 덮지 않는다


# ── provider 구분 · 이름 (순수 함수) ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("gateway_id", "raw", "provider"),
    [
        ("claude-haiku-5-5", ["anthropic"], "anthropic"),
        ("gpt-6.1-sol", ["openai"], "openai"),
        ("gemini-3-pro", ["gemini"], "google"),
        ("gemini-3-pro", ["vertex_ai"], "google"),
        ("claude-on-vertex", ["vertex_ai-anthropic_models"], "google"),
        ("my-claude", ["bedrock_converse"], "bedrock"),
        ("gpt-azure", ["azure"], "azure"),
        ("mistral-large", ["mistral"], "mistral"),
        ("llama-groq", ["groq"], "groq"),
        ("deepseek-r1", ["deepseek"], "deepseek"),
        ("grok-4", ["xai"], "xai"),
        ("local", ["ollama_chat"], "ollama"),
        ("router", ["openrouter"], "openrouter"),
        ("brewai-mock", ["openai"], "brewai"),  # 우리 mock 은 openai 로 와도 BrewAI
        ("hf-model", ["huggingface"], "other"),
        ("claude-sonnet-5-5", [], "anthropic"),  # provider 가 비면 이름으로 짐작
        ("o4-mini", [], "openai"),
        ("mystery", [], "other"),
        # LiteLLM `openai/` = OpenAI 호환 서버 (vLLM · 사내). 이름이 다른 회사·공개 가중치면 OpenAI 아이콘을 쓰지 않는다
        ("openai/qwen3-32b", ["openai"], "other"),
        ("llama-3.3-70b-vllm", ["openai"], "other"),
        ("deepseek-chat", ["openai"], "deepseek"),
        ("hosted/claude-sonnet-5-5", ["openai"], "anthropic"),
        ("smart", ["openai"], "openai"),  # 모르는 별칭 = LiteLLM 말대로
        ("text-embedding-3-small", ["openai"], "openai"),
        ("mistral-large", ["openai"], "mistral"),
    ],
)
def test_provider_normalization(gateway_id: str, raw: list[str], provider: str) -> None:
    assert provider_of(gateway_id, raw) == provider


def test_providers_of_load_balanced_group() -> None:
    assert providers_of("gpt-6", ["azure", "openai", "azure"]) == ["azure", "openai"]
    assert providers_of("qwen3-32b", ["openai", "ollama"]) == ["ollama", "other"]  # OpenAI 호환 vLLM + Ollama


@pytest.mark.parametrize(
    ("gateway_id", "label", "family"),
    [
        ("claude-sonnet-5-5", "Claude Sonnet 5.5", "Claude Sonnet"),
        ("claude-3-5-sonnet-20241022", "Claude 3.5 Sonnet", "Claude"),
        ("anthropic/claude-haiku-5-5", "Claude Haiku 5.5", "Claude Haiku"),
        ("gpt-6.1-sol", "GPT-6.1 Sol", "GPT"),
        ("gpt-4o-mini", "GPT-4o mini", "GPT"),
        ("o4-mini", "o4-mini", "o4"),
        ("gemini-2.5-pro", "Gemini 2.5 Pro", "Gemini"),
        ("vertex_ai/gemini-2.0-flash@001", "Gemini 2.0 Flash", "Gemini"),
        ("deepseek-r1", "DeepSeek R1", "DeepSeek"),
        ("llama-3.3-70b", "Llama 3.3 70B", "Llama"),
        ("mistral-large-latest", "Mistral Large", "Mistral Large"),
        ("brewai-mock", "BrewAI Mock", "BrewAI Mock"),
        ("fake-chat-small", "fake-chat-small", None),  # 모르는 이름은 건드리지 않는다
        ("My_Team_Model", "My_Team_Model", None),
    ],
)
def test_pretty_name(gateway_id: str, label: str, family: str | None) -> None:
    assert pretty_name(gateway_id) == (label, family)


def test_periodic_sync_picks_up_models_added_in_litellm(make_api, h) -> None:
    # LiteLLM 관리 화면에서 모델을 추가하면 주기 동기화가 후보(숨김)로 가져온다 — 이름에 공백 · 마침표가 있어도
    import time

    api = make_api(lambda _id: TestModel(), _gateway(h), model_sync_interval_s=0.05)
    api.catalog.set(_gateway(h, h.group("Claude Sonnet 5.5", ["anthropic"])))
    deadline = time.monotonic() + 3
    row = None
    while time.monotonic() < deadline:
        rows = api.client.get("/api/admin/models").json()
        row = next((r for r in rows if r["id"] == "Claude Sonnet 5.5"), None)
        if row:
            break
        time.sleep(0.05)
    assert row is not None and row["provider"] == "anthropic"
    assert "Claude Sonnet 5.5" not in [m["id"] for m in api.client.get("/api/models").json()]  # 후보 = 숨김


def test_sync_interval_env() -> None:
    from conductor.settings import load_settings

    base = {"LITELLM_MASTER_KEY": "sk-" + "a" * 40}
    assert load_settings(base).model_sync_interval_s == 60.0
    assert load_settings({**base, "MODEL_SYNC_INTERVAL_S": "0"}).model_sync_interval_s == 0.0
    assert load_settings({**base, "MODEL_SYNC_INTERVAL_S": "3"}).model_sync_interval_s == 10.0
    assert load_settings({**base, "MODEL_SYNC_INTERVAL_S": "x"}).model_sync_interval_s == 60.0
