"""모델 호출 실패 → (공개 code, 자세한 detail) + 로그용 짧은 provider 문구. 순수 파이썬 (Pydantic AI · OpenAI SDK import 없음).

LiteLLM 1.106.2 (infra/litellm/.venv 의 소스로 확인한 모양):
  게이트웨이 키 틀림   DB 모드 = 401 type token_not_found_in_db · "Authentication Error, Invalid proxy server token passed…"
                       (그 밖의 프록시 인증 실패 = 401 type auth_error) · config-only 모드 = 400 type no_db_connection
  키가 모델 허용 안 함  403 type key_/team_/user_…_model_access_denied · "The requested model '…' is not available for this API key…"
                       (JWT 경로 = type auth_error + 같은 문구) · 예산 초과 = 422 type budget_exceeded (litellm.budget_exceeded_status_code)
  provider 키 없음     401 type authentication_error · "litellm.AuthenticationError: Missing Anthropic API Key - …"
                       OpenAI 는 500 "litellm.InternalServerError: OpenAIException - Missing credentials…"
  provider 키 틀림     401/403 type authentication_error|permission_error · "…AnthropicException - …invalid x-api-key…"
  provider 모델 없음   404 · "litellm.NotFoundError: AnthropicException - …not_found_error…model: …"
  게이트웨이에 모델 없음 400 · "Invalid model name passed in model=…"
  생각 파라미터 거절   400 · "litellm.UnsupportedParamsError: … reasoning_effort" 또는 provider 의 thinking 오류
                       /v1/responses = "Unsupported parameter: 'reasoning.summary' …" · "Unsupported value: 'reasoning.effort' …" (error.param = reasoning.…)
                       = 이번 요청에 생각 파라미터를 실었을 때만 (reasoning=True). 끔이면 생각 칸을 안 보냈다 = 다른 까닭 → provider_bad_request
                       (UnsupportedParams 만으로는 안 본다 · 다른 칸(parallel_tool_calls …) 거절도 같은 오류 이름)
  Responses 200 실패    status failed + error {code, message} · incomplete (max_output_tokens 말고 다른 까닭) → classify_response
provider 오류는 type 이 OpenAI 식(authentication_error · permission_error · invalid_request_error …)이고 프록시 자체 오류는
ProxyErrorTypes(auth_error · token_not_found_in_db · no_db_connection …) 라서 type 으로 둘을 가른다.

provider 문구는 로그에만 쓴다 (키처럼 보이는 것을 가리고 300자까지). 요청 본문은 어디에도 남기지 않는다.
화면(RUN_ERROR)에는 code · detail 만 간다 — 문구는 화면이 code/detail 로 만든다 (eval 제약: 비밀 노출 0).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

MAX_PROVIDER_MESSAGE = 300

# 공개 code (RUN_ERROR.code) — 데스크톱 api.ts kindOf 와 같은 목록
GATEWAY_AUTH = "gateway_auth_failed"
PROVIDER_AUTH = "provider_auth_failed"
PROVIDER_REJECTED = "provider_rejected"  # 설정 문제로 provider·게이트웨이가 요청을 거절 (다시 해도 같다)
MODEL_ERROR = "model_error"

# 관리자 모델 표 '연결' 칸에 남길 실패 (단계 초과 · 끊김 · 서버 오류는 모델 탓이 아니다)
MODEL_HEALTH_CODES = frozenset({GATEWAY_AUTH, PROVIDER_AUTH, PROVIDER_REJECTED, MODEL_ERROR, "gateway_unreachable"})

# detail (RUN_ERROR.detail · model_health.last_error_code). 화면 문구 = 데스크톱 chat/text.ts DETAIL · 관리자 Models.tsx
DETAILS = (
    "gateway_key_invalid",
    "gateway_model_denied",
    "gateway_model_missing",
    "provider_key_missing",
    "provider_key_invalid",
    "provider_model_not_found",
    "reasoning_unsupported",
    "provider_bad_request",
    "image_rejected",
    "file_rejected",
    "provider_rate_limited",
    "provider_unavailable",
    "gateway_budget_exceeded",
)

# LiteLLM 프록시 자체 인증 오류 type (ProxyErrorTypes). provider 오류는 이 type 을 쓰지 않는다
_PROXY_AUTH_TYPES = frozenset({"auth_error", "token_not_found_in_db", "no_db_connection", "expired_key", "invalid_key"})
_MODEL_DENIED = re.compile(
    r"_model_access_denied$|not allowed to access model|key not allowed|not available for this API key|not in the allowed models", re.I
)
_MISSING_KEY = re.compile(
    r"missing [a-z ]*api[ _-]?key|missing credentials|api[ _-]?key (?:is )?(?:not set|required|missing)"
    r"|x-api-key header is required|no api key",
    re.I,
)
_NOT_FOUND = re.compile(r"not_found_error|model_not_found|does not exist|NotFoundError|unknown model|model not found", re.I)
_GATEWAY_MODEL = re.compile(r"Invalid model name passed", re.I)
# 첨부 (slice 07): 이미지 크기 · 형식 거절 (Anthropic = 가로 · 세로 8,000px 넘음 · 5MB · 그림을 못 읽음) · 문서(PDF) 거절
_IMAGE = re.compile(r"image[^.]{0,60}(dimension|exceed|too large|too big|pixels|could not|invalid|unsupported|size)"
                    r"|exceeds? (?:the )?max(?:imum)? allowed (?:size|dimension)|image_parse|Could not process image", re.I)
_DOCUMENT = re.compile(r"(pdf|document)[^.]{0,60}(exceed|too large|too many pages|could not|invalid|unsupported|not supported)", re.I)
# 생각 파라미터 이름이 문구에 있다 (reasoning_effort · reasoning.effort|summary|… · thinking · budget_tokens · output_config = LiteLLM 이 effort 를 옮긴 칸)
_REASONING = re.compile(
    r"reasoning_effort|budget_tokens|output_config|reasoning\.(?:effort|summary|context|mode)"
    r"|\bthinking(?:\.\w+|`?\s*:|`?\s+(?:is\s+)?(?:not supported|unsupported))|['\"`]thinking['\"`]"
    r"|\breasoning\b[^.]*\bnot supported",
    re.I,
)

# 키처럼 보이는 것: Bearer 값 · 이름이 키/토큰/비밀인 값 (JSON "api_key": "…" 포함) · 알려진 키 모양 (sk- · AKIA · AIza · ya29. · JWT …)
# · 긴 16진수(해시) · 긴 난수 토큰. 가린 뒤에 자른다 (잘린 키 조각이 남지 않게)
_SECRET_NAME = r"[\w-]*(?:api[_-]?key|token|secret|password|passwd|credential|authorization|signature)"
_SECRETS = (
    (re.compile(r"(?i)\bbearer\s+[^\s\"',;}]+"), "Bearer ***"),
    (re.compile(rf"(?i)\b({_SECRET_NAME}|key hash \(token\)|received api key|key)([\"']?\s*[:=]\s*)[\"']?[^\s\"',;}}&]+"), r"\1\2***"),
    (re.compile(r"\bsk-[A-Za-z0-9_\-*.]{2,}"), "sk-***"),
    (re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), "***"),
    (re.compile(r"\bAIza[0-9A-Za-z_\-]{20,}"), "***"),
    (re.compile(r"\bya29\.[0-9A-Za-z_\-.]+"), "***"),
    (re.compile(r"\beyJ[0-9A-Za-z_\-]+\.[0-9A-Za-z_\-]+\.[0-9A-Za-z_\-]*"), "***"),
    (re.compile(r"\b(?:xai|gsk|hf|ghp|gho|ghs|github_pat|glpat|pplx|nvapi|r8)[-_][0-9A-Za-z_\-]{8,}"), "***"),
    (re.compile(r"\b[0-9a-fA-F]{24,}\b"), "***"),
    (re.compile(r"\b[A-Za-z0-9_\-]{32,}\b"), "***"),
)


def sanitize(text: str | None, limit: int = MAX_PROVIDER_MESSAGE) -> str:
    """로그에 남길 provider 문구: 키처럼 보이는 것을 가리고, 줄바꿈을 한 칸으로, limit 자까지."""
    out = " ".join(str(text or "").split())
    for pattern, repl in _SECRETS:
        out = pattern.sub(repl, out)
    return out if len(out) <= limit else out[: limit - 1] + "…"


def _message_of(body: Any) -> str:
    """LiteLLM 오류 본문 {"error": {"message"}} 또는 OpenAI SDK 가 꺼낸 {"message"} 또는 글."""
    if isinstance(body, dict):
        inner = body.get("error", body)
        if isinstance(inner, dict):
            msg = inner.get("message")
            return msg if isinstance(msg, str) else json.dumps(inner, ensure_ascii=False)[:2000]
        return str(inner)
    return "" if body is None else str(body)


def _param_of(body: Any) -> str:
    """OpenAI 식 오류의 param (Responses 400 = 'reasoning.summary' 처럼 거절한 칸 이름)."""
    if isinstance(body, dict):
        inner = body.get("error", body)
        if isinstance(inner, dict) and isinstance(inner.get("param"), str):
            return inner["param"]
    return ""


def _type_of(body: Any) -> str | None:
    if isinstance(body, dict):
        inner = body.get("error", body)
        if isinstance(inner, dict) and isinstance(inner.get("type"), str):
            return inner["type"]
    return None


@dataclass(frozen=True)
class Diagnosis:
    code: str  # 공개 code
    detail: str | None  # DETAILS 중 하나 (모르면 None)
    status: int | None = None
    error_type: str | None = None
    provider_message: str = ""  # sanitize 한 문구 (로그 전용)

    def log_fields(self) -> str:
        return (
            f"code={self.code} detail={self.detail or '-'} status={self.status if self.status is not None else '-'} "
            f"type={self.error_type or '-'} provider_message={self.provider_message!r}"
        )


def classify_http(status: int, error_type: str | None, body: Any, *, reasoning: bool = False) -> Diagnosis:
    """게이트웨이가 준 HTTP 오류 하나 → Diagnosis. body = LiteLLM 오류 본문 (응답 본문 · 요청 본문 아님).
    reasoning = 이번 요청에 생각 파라미터를 실었다 (끔 · 생각 못 하는 모델 · 연결 시험 = False → reasoning_unsupported 로 보지 않는다)."""
    message = _message_of(body)
    etype = error_type or _type_of(body)
    clean = sanitize(message)

    def d(code: str, detail: str | None) -> Diagnosis:
        return Diagnosis(code=code, detail=detail, status=status, error_type=etype, provider_message=clean)

    # ① 게이트웨이(LiteLLM 프록시) 자신의 인증 — provider 이름(…Exception)이 없다
    if etype in _PROXY_AUTH_TYPES or _MODEL_DENIED.search(etype or "") or "proxy server token" in message.lower():
        if _MODEL_DENIED.search(etype or "") or _MODEL_DENIED.search(message):
            return d(GATEWAY_AUTH, "gateway_model_denied")
        return d(GATEWAY_AUTH, "gateway_key_invalid")
    if etype == "budget_exceeded":  # 게이트웨이 키·팀 예산 (provider 탓 아님 · 다시 해도 같다)
        return d(PROVIDER_REJECTED, "gateway_budget_exceeded")
    if status == 400 and _GATEWAY_MODEL.search(message):
        return d(PROVIDER_REJECTED, "gateway_model_missing")
    # ② provider 키 (LiteLLM 1.106.2: OpenAI 키 없음은 500 Missing credentials)
    if status in (401, 403) or (status in (400, 500) and _MISSING_KEY.search(message)):
        return d(PROVIDER_AUTH, "provider_key_missing" if _MISSING_KEY.search(message) else "provider_key_invalid")
    # ③ provider 가 요청을 거절 (설정 문제 — 다시 해도 같다)
    if status == 404 or (status == 400 and _NOT_FOUND.search(message)):
        return d(PROVIDER_REJECTED, "provider_model_not_found")
    if status in (400, 413, 422) and _IMAGE.search(message):
        return d(PROVIDER_REJECTED, "image_rejected")
    if status in (400, 413, 422) and _DOCUMENT.search(message):
        return d(PROVIDER_REJECTED, "file_rejected")
    if status in (400, 422):
        about = bool(_REASONING.search(message)) or _param_of(body).startswith("reasoning")
        return d(PROVIDER_REJECTED, "reasoning_unsupported" if reasoning and about else "provider_bad_request")
    # ④ 잠시 뒤 다시
    if status == 429:
        return d(MODEL_ERROR, "provider_rate_limited")
    if status >= 500:
        return d(MODEL_ERROR, "provider_unavailable")
    return d(MODEL_ERROR, None)


# Responses 200 본문 error.code → 같은 오류가 HTTP 로 왔을 때의 status (OpenAI 문서 · Pydantic AI _response_error 와 같은 갈래)
_RESPONSE_STATUS = {"rate_limit_exceeded": 429, "server_error": 500, "vector_store_timeout": 500}


def classify_response(status: str | None, code: str | None, message: str | None, incomplete: str | None) -> Diagnosis | None:
    """/v1/responses 가 HTTP 200 으로 준 응답 하나 (연결 시험). 성공 = None.
    failed = error.code 를 HTTP status 로 바꿔 classify_http (모르는 code = 400 = 요청 거절) · status 칸 = 200 (실제 HTTP) · type 칸 = code.
    incomplete: max_output_tokens (짧은 한도 · 생각 모델) = 성공 · 다른 까닭 (content_filter …) = model_error."""
    if status == "failed" or (code and status != "incomplete"):
        d = classify_http(_RESPONSE_STATUS.get(code or "", 400 if code else 500), None, {"error": {"message": message or "", "code": code}})
        return Diagnosis(code=d.code, detail=d.detail, status=200, error_type=code, provider_message=d.provider_message)
    if status == "incomplete" and incomplete not in (None, "max_output_tokens"):
        return Diagnosis(code=MODEL_ERROR, detail=None, status=200, error_type=f"incomplete:{incomplete}")
    return None


def unreachable() -> Diagnosis:
    return Diagnosis(code="gateway_unreachable", detail=None)
