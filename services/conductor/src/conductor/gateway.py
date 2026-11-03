"""모델 카탈로그 = 게이트웨이가 원본 (ADR-0006). 우리는 읽기만 한다 — 등록·가격 입력 없음.

GatewayCatalogPort.list_models() → GatewayModel 목록. P1 구현 = LiteLLM `GET /model_group/info`.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, replace
from typing import Any, Protocol

import httpx2


# 대화 모델로 보는 LiteLLM mode. null = 가격표에 없는 모델 · responses = /chat/completions 를 LiteLLM 이 Responses API 로 바꿔 보내는 모델
# (Azure 사용자 지정 배포는 model_info.mode = responses 로 켠다 · docs.litellm.ai/docs/reasoning_content)
CHAT_MODES: tuple[str | None, ...] = (None, "chat", "responses")


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
    # 어디서 등록했나 (LiteLLM `/v1/model/info` model_info.db_model): config = config.yaml · ui = 관리 화면(DB) · mixed · None = 모름
    source: str | None = None
    # 캐시 가격 (USD/토큰). `/model_group/info` 에는 없다 (1.106.2 ModelGroupInfo) → `/v1/model/info` model_info 에서 읽는다.
    # None = 모름 → 사용량 비용은 입력 가격으로 어림하고 '어림' 표시 (usage.py cost_parts)
    cache_read_input_token_cost: float | None = None
    cache_creation_input_token_cost: float | None = None

    @property
    def is_chat(self) -> bool:
        return self.mode in CHAT_MODES

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
        cache_read_input_token_cost=_price(item.get("cache_read_input_token_cost")),
        cache_creation_input_token_cost=_price(item.get("cache_creation_input_token_cost")),
    )


def _price(v: Any) -> float | None:
    f = _float(v)
    return f if f is not None and f >= 0 else None


def sources_from_model_info(data: Any) -> dict[str, str]:
    """LiteLLM `/v1/model/info` → {model_name: config | ui | mixed}. 배포(deployment)마다 model_info.db_model 이 있다
    (1.106.2 proxy_server.get_model_info_with_id: DB 에서 읽은 모델 = True, config.yaml = False).
    model_name · db_model 만 읽는다 — litellm_params(키 · api_base)는 쳐다보지도 않는다."""
    seen: dict[str, set[bool]] = {}
    items = data.get("data") if isinstance(data, dict) else None
    for d in items if isinstance(items, list) else ():
        if not isinstance(d, dict) or not isinstance(d.get("model_name"), str):
            continue
        info = d.get("model_info") if isinstance(d.get("model_info"), dict) else {}
        seen.setdefault(d["model_name"], set()).add(info.get("db_model") is True)
    return {name: ("mixed" if len(v) > 1 else "ui" if True in v else "config") for name, v in seen.items()}


CachePrices = tuple[float | None, float | None]  # (캐시 읽기, 캐시 쓰기) USD/토큰


def cache_prices_from_model_info(data: Any) -> dict[str, CachePrices]:
    """LiteLLM `/v1/model/info` → {model_name: (cache_read_input_token_cost, cache_creation_input_token_cost)}.
    model_info 는 LiteLLM 가격표(get_model_info)를 합친 값이다. 배포가 여럿이면 처음 아는 값. 가격 칸만 읽는다 (litellm_params 안 봄)."""
    out: dict[str, CachePrices] = {}
    items = data.get("data") if isinstance(data, dict) else None
    for d in items if isinstance(items, list) else ():
        if not isinstance(d, dict) or not isinstance(d.get("model_name"), str):
            continue
        info = d.get("model_info") if isinstance(d.get("model_info"), dict) else {}
        read, write = _price(info.get("cache_read_input_token_cost")), _price(info.get("cache_creation_input_token_cost"))
        old = out.get(d["model_name"], (None, None))
        out[d["model_name"]] = (old[0] if old[0] is not None else read, old[1] if old[1] is not None else write)
    return out


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
        self._info_url = f"{base_url.rstrip('/')}/v1/model/info"
        self._headers = {"Authorization": f"Bearer {api_key}"}
        self._client = client or httpx2.AsyncClient(timeout=httpx2.Timeout(10.0))
        self._ttl_s = ttl_s
        self._cache: tuple[float, list[GatewayModel]] | None = None
        self._sources_ok: dict[str, str] = {}  # 마지막으로 읽은 출처 — 한 번 못 읽어도 '알 수 없음'으로 깜빡이지 않게
        self._cache_ok: dict[str, CachePrices] = {}  # 마지막으로 읽은 캐시 가격 (같은 이유)

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
        info = await self._model_info()
        if info is None:
            sources, cache = self._sources_ok, self._cache_ok  # 일시 오류 = 지난 값 그대로
        else:
            sources, cache = sources_from_model_info(info), cache_prices_from_model_info(info)
            self._sources_ok, self._cache_ok = sources, cache
        if sources or cache:
            models = [self._with_info(m, sources, cache) for m in models]
        self._cache = (now, models)
        return models

    @staticmethod
    def _with_info(m: GatewayModel, sources: dict[str, str], cache: dict[str, CachePrices]) -> GatewayModel:
        read, write = cache.get(m.id, (None, None))
        return replace(
            m, source=sources.get(m.id),
            cache_read_input_token_cost=m.cache_read_input_token_cost if m.cache_read_input_token_cost is not None else read,
            cache_creation_input_token_cost=m.cache_creation_input_token_cost if m.cache_creation_input_token_cost is not None else write,
        )

    async def _model_info(self) -> Any:
        """등록 출처 · 캐시 가격은 덤: 못 읽으면(옛 LiteLLM · 권한 · 오류) None → 지난 값 (처음이면 빈 값 = 화면은 '알 수 없음').
        목록 읽기는 막지 않는다."""
        try:
            res = await self._client.get(self._info_url, headers=self._headers)
            return res.json() if res.status_code == 200 else None
        except (httpx2.HTTPError, ValueError):
            return None

    async def aclose(self) -> None:
        await self._client.aclose()
