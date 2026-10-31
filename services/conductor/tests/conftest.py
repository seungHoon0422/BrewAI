"""conductor 테스트 공용 — 네트워크 없음 (FunctionModel · TestModel · 메모리 카탈로그 · SQLite :memory:).

make_api = 첫 관리자(SETTINGS.admin_email)로 진짜 로그인한 클라이언트 (서버 뒷문 없음 · ADR-0010):
  api.client  /api/admin/* = 관리자 쿠키 + X-CSRF-Token · 나머지 /api/* = Bearer 를 알아서 붙인다
  api.anon()  아무것도 안 붙는 클라이언트 · api.login(email, pw) = 그 사람의 클라이언트 · api.add_user(...) = 계정 바로 만들기
"""

from __future__ import annotations

import copy
import json
import sys
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.models import Model

from conductor.agent import ChatRuntime
from conductor.app import create_app
from conductor.auth import passwords
from conductor.gateway import GatewayModel, parse_model_group
from conductor.settings import Settings
from conductor.store import Store

FIXTURE = Path(__file__).parent / "fixtures" / "litellm-1.106.2-model_group_info.json"
SKILLS_DIR = Path(__file__).resolve().parents[3] / "runtime" / "skills"  # 레포의 제품 스킬 (스타터 5개)
# 테스트 기본: fixture 의 채팅 모델 둘을 첫 동기화 때 노출 (실제 기본값은 brewai-mock 하나)
ADMIN_EMAIL = "admin@brewai.test"
ADMIN_PASSWORD = "test-admin-password-0001"
PASSWORD = "member-password-000001"  # add_user 기본 비밀번호 (15자 이상)
LOCAL = ("127.0.0.1", 50000)  # 요청 주소 = 이 PC (데스크톱 · 관리자 Vite proxy 와 같다)
SETTINGS = Settings(
    gateway_url="http://gateway.invalid",
    gateway_key="sk-test-secret-0000",
    bootstrap_models=("fake-chat-small", "fake-chat-large"),
    admin_email=ADMIN_EMAIL,
    admin_password=ADMIN_PASSWORD,
)


class AuthClient(TestClient):
    """경로에 맞는 인증을 붙인다: /api/admin/* = (jar 의 쿠키) + X-CSRF-Token · 나머지 /api/* = Bearer. headers 로 직접 주면 그 값."""

    bearer: str | None = None
    csrf: str | None = None

    def request(self, method: str, url: Any, **kw: Any) -> Any:  # type: ignore[override]
        path = urlsplit(str(url)).path
        headers = dict(kw.pop("headers", None) or {})
        given = {k.lower() for k in headers}
        if path.startswith("/api/admin/"):
            if self.csrf and method.upper() not in ("GET", "HEAD", "OPTIONS") and "x-csrf-token" not in given:
                headers["x-csrf-token"] = self.csrf
        elif path.startswith("/api/") and self.bearer and "authorization" not in given:
            headers["authorization"] = f"Bearer {self.bearer}"
        return super().request(method, url, headers=headers, **kw)


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
    client: AuthClient
    catalog: MemoryCatalog
    store: Store
    me: dict[str, Any] = field(default_factory=dict)  # 첫 관리자 (GET /api/me 모양)
    tokens: dict[str, Any] = field(default_factory=dict)  # 로그인 응답 (access · refresh)
    runs: list[str] = field(default_factory=list)

    @property
    def app(self) -> Any:
        return self.client.app

    def anon(self) -> TestClient:
        return TestClient(self.app, base_url="http://127.0.0.1", client=LOCAL)

    def login(self, email: str = ADMIN_EMAIL, password: str = PASSWORD, *, admin: bool = False) -> AuthClient:
        c = AuthClient(self.app, base_url="http://127.0.0.1", client=LOCAL)
        res = c.post("/api/auth/login", json={"email": email, "password": password})
        assert res.status_code == 200, res.text
        c.bearer = res.json()["access_token"]
        if admin:
            res = c.post("/api/admin/auth/login", json={"email": email, "password": password})
            assert res.status_code == 200, res.text
            c.csrf = res.json()["csrf_token"]
        return c

    def add_user(self, email: str, *, name: str | None = None, org_role: str = "member", password: str | None = PASSWORD,
                 instance_role: str = "user", email_verified: bool = True) -> str:
        """초대 흐름 없이 계정 하나 (첫 관리자의 조직 · 내 스페이스까지 · 기본 = 이메일 주인 확인됨). user id."""
        directory = self.app.state.directory
        org_id = self.me["orgs"][0]["id"]
        with self.store.tx() as db:
            return directory.create_account(
                db, email=email, display_name=name or email.split("@")[0], org_id=org_id, org_role=org_role,
                password_hash=passwords.hash_password(password) if password else None, instance_role=instance_role,
                email_verified=email_verified,
            )

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
        skills: Any = None,  # SkillRegistry (기본 = 스킬 없음)
        openai_client: Any = None,  # 연결 시험용 AsyncOpenAI (httpx2.MockTransport)
        app_kw: dict[str, Any] | None = None,  # create_app 추가 인자 (google=GoogleOIDC …)
        **overrides: Any,
    ) -> Api:
        settings = replace(settings, **overrides) if overrides else settings
        catalog = MemoryCatalog(items if items is not None else fixture_items())
        store = store or Store(":memory:")
        app_kw = app_kw or {}
        runtime = ChatRuntime(
            gateway_url=settings.gateway_url, gateway_key=settings.gateway_key, model_factory=model_factory,
            skills=skills, openai_client=openai_client,
        )
        client = AuthClient(create_app(settings, catalog=catalog, runtime=runtime, store=store, **app_kw), base_url="http://127.0.0.1")
        client.__enter__()  # lifespan = 첫 동기화
        opened.append(client)
        res = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
        assert res.status_code == 200, res.text
        client.bearer = res.json()["access_token"]
        res2 = client.post("/api/admin/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
        assert res2.status_code == 200, res2.text
        client.csrf = res2.json()["csrf_token"]
        return Api(client=client, catalog=catalog, store=store, me=res.json()["user"], tokens=res.json())

    yield make
    for c in opened:
        c.__exit__(None, None, None)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def fake_mcp() -> Any:
    """tests/fake_mcp.py 모듈 (가짜 MCP · OAuth 서버 · importlib 모드라 파일에서 바로 불러온다)."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("brewai_fake_mcp", Path(__file__).parent / "fake_mcp.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # dataclass 가 자기 모듈을 찾는다
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def h() -> Any:
    """테스트 도우미 묶음 (importlib 모드라 conftest 를 import 할 수 없다)."""
    import types as _types

    return _types.SimpleNamespace(
        chat_body=chat_body, sse_events=sse_events, types=types, group=group, fixture_items=fixture_items,
        FIXTURE=FIXTURE, SETTINGS=SETTINGS, SKILLS_DIR=SKILLS_DIR, ADMIN_EMAIL=ADMIN_EMAIL, ADMIN_PASSWORD=ADMIN_PASSWORD,
        PASSWORD=PASSWORD, AuthClient=AuthClient, MemoryCatalog=MemoryCatalog,
    )
