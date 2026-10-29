"""모델 카탈로그 = 게이트웨이가 원본 (ADR-0006). 우리는 읽기만 한다 — 등록·가격 입력 없음.

GatewayCatalogPort.list_models() → GatewayModel 목록. P1 구현 = LiteLLM `GET /model_group/info`.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass
from typing import Any, Protocol

import httpx2


@dataclass(frozen=True)
class GatewayModel:
    id: str  # LiteLLM model_group = 채팅 요청의 model 값
    providers: tuple[str, ...]
    mode: str | None
    max_input_tokens: int | None
    max_output_tokens: int | None
    input_cost_per_token: float | None
    output_cost_per_token: float | None
    supports_function_calling: bool
    supports_vision: bool
    supports_reasoning: bool

    @property
    def is_chat(self) -> bool:
        return self.mode in (None, "chat")  # LiteLLM 은 가격표에 없는 모델의 mode 를 null 로 준다

    def row(self) -> dict[str, Any]:
        return asdict(self) | {"providers": list(self.providers)}


class GatewayError(Exception):
    """게이트웨이 호출 실패. message 에 키·응답 본문을 넣지 않는다."""

    def __init__(self, code: str, status: int | None = None) -> None:
        super().__init__(code if status is None else f"{code} (gateway HTTP {status})")
        self.code = code
        self.status = status


class GatewayCatalogPort(Protocol):
    # fresh = 캐시를 건너뛴다 (관리자 화면은 지금 상태를 보여 줘야 한다)
    async def list_models(self, *, fresh: bool = False) -> list[GatewayModel]: ...


def _int(v: Any) -> int | None:
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _float(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def parse_model_group(item: dict[str, Any]) -> GatewayModel:
    return GatewayModel(
        id=str(item["model_group"]),
        providers=tuple(str(p) for p in item.get("providers") or ()),
        mode=item.get("mode"),
        max_input_tokens=_int(item.get("max_input_tokens")),
        max_output_tokens=_int(item.get("max_output_tokens")),
        input_cost_per_token=_float(item.get("input_cost_per_token")),
        output_cost_per_token=_float(item.get("output_cost_per_token")),
        supports_function_calling=bool(item.get("supports_function_calling")),
        supports_vision=bool(item.get("supports_vision")),
        supports_reasoning=bool(item.get("supports_reasoning")),
    )


def _no_db(res: httpx2.Response) -> bool:
    """LiteLLM config-only 모드(DB 없음)는 틀린 키에 401 대신 400 {"error":{"type":"no_db_connection"}} 을 준다 (1.106.2 확인)."""
    if res.status_code != 400:
        return False
    try:
        return res.json()["error"]["type"] == "no_db_connection"
    except (ValueError, KeyError, TypeError):
        return False


class LiteLLMCatalog:
    """LiteLLM 프록시 `GET /model_group/info` (Bearer = master key · P2 부터 virtual key)."""

    def __init__(self, base_url: str, api_key: str, *, client: httpx2.AsyncClient | None = None, ttl_s: float = 30.0):
        self._url = f"{base_url.rstrip('/')}/model_group/info"
        self._headers = {"Authorization": f"Bearer {api_key}"}
        self._client = client or httpx2.AsyncClient(timeout=httpx2.Timeout(10.0))
        self._ttl_s = ttl_s
        self._cache: tuple[float, list[GatewayModel]] | None = None

    async def list_models(self, *, fresh: bool = False) -> list[GatewayModel]:
        now = time.monotonic()
        if not fresh and self._cache and now - self._cache[0] < self._ttl_s:
            return self._cache[1]
        try:
            res = await self._client.get(self._url, headers=self._headers)
        except httpx2.HTTPError as e:
            raise GatewayError("gateway_unreachable") from e
        if res.status_code in (401, 403) or _no_db(res):
            raise GatewayError("gateway_auth_failed", res.status_code)
        if res.status_code != 200:
            raise GatewayError("gateway_error", res.status_code)
        try:
            models = [parse_model_group(item) for item in res.json()["data"]]
        except (ValueError, KeyError, TypeError) as e:
            raise GatewayError("gateway_bad_response") from e
        self._cache = (now, models)
        return models

    async def aclose(self) -> None:
        await self._client.aclose()
