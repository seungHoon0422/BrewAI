"""conductor 테스트 공용 — 네트워크 없음 (FunctionModel · TestModel · 메모리 카탈로그 · SQLite :memory:)."""

from __future__ import annotations

import copy
import json
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.models import Model

from conductor.agent import ChatRuntime
from conductor.app import create_app
from conductor.gateway import GatewayModel, parse_model_group
from conductor.settings import Settings
from conductor.store import Store

FIXTURE = Path(__file__).parent / "fixtures" / "litellm-1.106.2-model_group_info.json"
# 테스트 기본: fixture 의 채팅 모델 둘을 첫 동기화 때 노출 (실제 기본값은 brewai-mock 하나)
SETTINGS = Settings(
    gateway_url="http://gateway.invalid",
    gateway_key="sk-test-secret-0000",
    bootstrap_models=("fake-chat-small", "fake-chat-large"),
)


def fixture_items() -> list[dict[str, Any]]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))["data"]


def group(model_id: str, providers: list[str], **extra: Any) -> dict[str, Any]:
    """fixture 첫 항목 모양을 빌려 다른 모델 하나 (LiteLLM model_group_info 항목)."""
    item = copy.deepcopy(fixture_items()[0])
    item.update(model_group=model_id, providers=providers, **extra)
    return item


class MemoryCatalog:
    def __init__(self, items: list[dict[str, Any]]) -> None:
        self.set(items)
        self.error: Exception | None = None

    def set(self, items: list[dict[str, Any]]) -> None:
        self.models: list[GatewayModel] = [parse_model_group(i) for i in items]  # 새 목록 객체 = '바뀜'

    async def list_models(self, *, fresh: bool = False) -> list[GatewayModel]:
        if self.error:
            raise self.error
        return self.models


def chat_body(text: str = "안녕", *, thread: str = "thread-1", run: str = "run-1", history: list[dict] | None = None, **props: object) -> dict:
    return {
        "threadId": thread,
        "runId": run,
        "state": {},
        "messages": [*(history or []), {"id": f"m-{run}", "role": "user", "content": text}],
        "tools": [],
        "context": [],
        "forwardedProps": props,
    }


def sse_events(text: str) -> list[dict]:
    return [json.loads(line.removeprefix("data: ")) for line in text.split("\n\n") if line.startswith("data: ")]


def types(events: list[dict]) -> list[str]:
    return [e["type"] for e in events]


@dataclass
class Api:
    client: TestClient
    catalog: MemoryCatalog
    store: Store
    runs: list[str] = field(default_factory=list)

    def chat(self, text: str = "안녕", **kw: Any) -> list[dict]:
        kw.setdefault("run", f"run-{len(self.runs) + 1}")
        self.runs.append(kw["run"])
        res = self.client.post("/api/chat", json=chat_body(text, **kw))
        assert res.status_code == 200, res.text
        return sse_events(res.text)


@pytest.fixture
def make_api() -> Callable[..., Api]:
    opened: list[TestClient] = []

    def make(
        model_factory: Callable[[str], Model],
        items: list[dict[str, Any]] | None = None,
        *,
        settings: Settings = SETTINGS,
        store: Store | None = None,
        **overrides: Any,
    ) -> Api:
        settings = replace(settings, **overrides) if overrides else settings
        catalog = MemoryCatalog(items if items is not None else fixture_items())
        store = store or Store(":memory:")
        runtime = ChatRuntime(gateway_url=settings.gateway_url, gateway_key=settings.gateway_key, model_factory=model_factory)
        client = TestClient(create_app(settings, catalog=catalog, runtime=runtime, store=store), base_url="http://127.0.0.1")
        client.__enter__()  # lifespan = 첫 동기화
        opened.append(client)
        return Api(client=client, catalog=catalog, store=store)

    yield make
    for c in opened:
        c.__exit__(None, None, None)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def h() -> Any:
    """테스트 도우미 묶음 (importlib 모드라 conftest 를 import 할 수 없다)."""
    import types as _types

    return _types.SimpleNamespace(
        chat_body=chat_body, sse_events=sse_events, types=types, group=group, fixture_items=fixture_items,
        FIXTURE=FIXTURE, SETTINGS=SETTINGS,
    )
