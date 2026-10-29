"""모델 provider 구분 · 표시 이름 만들기 (순수 함수, 네트워크·DB 없음).

provider id 는 화면이 아이콘을 고르는 키다 (아이콘은 앱 쪽). 여기 목록 = API 계약:
  brewai · anthropic · openai · google · azure · bedrock · mistral · groq · deepseek · xai · ollama · openrouter · other
LiteLLM `/model_group/info` 의 providers (= litellm_provider) 를 이 id 로 줄인다. 예: gemini · vertex_ai → google.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

# 표시 순서 = 관리자 provider 묶음 순서. 이름은 회사·서비스의 공식 표기 (로고·문구 재사용 아님)
PROVIDERS: dict[str, str] = {
    "brewai": "BrewAI",
    "anthropic": "Anthropic",
    "openai": "OpenAI",
    "google": "Google",
    "azure": "Azure OpenAI",
    "bedrock": "Amazon Bedrock",
    "mistral": "Mistral AI",
    "deepseek": "DeepSeek",
    "xai": "xAI",
    "groq": "Groq",
    "ollama": "Ollama",
    "openrouter": "OpenRouter",
    "other": "기타",
}
PROVIDER_ORDER = {p: i for i, p in enumerate(PROVIDERS)}

# LiteLLM provider 문자열 → 우리 id (LiteLLM 1.106.2 의 LlmProviders 값 중 쓰일 만한 것)
_ALIASES: dict[str, str] = {
    "anthropic": "anthropic",
    "anthropic_text": "anthropic",
    "openai": "openai",
    "text-completion-openai": "openai",
    "chatgpt": "openai",
    "gemini": "google",
    "google": "google",
    "google_ai_studio": "google",
    "palm": "google",
    "vertex_ai": "google",
    "vertex_ai_beta": "google",
    "azure": "azure",
    "azure_ai": "azure",
    "azure_text": "azure",
    "bedrock": "bedrock",
    "bedrock_converse": "bedrock",
    "mistral": "mistral",
    "codestral": "mistral",
    "text-completion-codestral": "mistral",
    "groq": "groq",
    "deepseek": "deepseek",
    "xai": "xai",
    "ollama": "ollama",
    "ollama_chat": "ollama",
    "openrouter": "openrouter",
}

# 게이트웨이가 provider 를 안 줄 때만 이름으로 짐작
_ID_HINTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^claude"), "anthropic"),
    (re.compile(r"^(gpt|chatgpt|o\d)(\b|-|$)"), "openai"),
    (re.compile(r"^(gemini|gemma)"), "google"),
    (re.compile(r"^(mistral|mixtral|codestral|magistral|ministral|devstral)"), "mistral"),
    (re.compile(r"^deepseek"), "deepseek"),
    (re.compile(r"^grok"), "xai"),
)

# 키 없이 답하는 우리 mock (infra/litellm/config.yaml 의 brewai-mock). LiteLLM 은 openai 로 알려 주지만 BrewAI 로 보인다
MOCK_PREFIX = "brewai-"


def provider_label(provider: str) -> str:
    return PROVIDERS.get(provider, PROVIDERS["other"])


def normalize_provider(raw: str) -> str:
    key = raw.strip().lower()
    if key in _ALIASES:
        return _ALIASES[key]
    if key.startswith("vertex_ai"):
        return "google"
    if key.startswith("bedrock"):
        return "bedrock"
    return "other"


def _base_name(gateway_id: str) -> str:
    # "anthropic/claude-sonnet-4-5" · "vertex_ai/gemini-2.5-pro@001" → 마지막 조각, 버전 꼬리 빼고
    name = gateway_id.strip().lower().rsplit("/", 1)[-1]
    name = name.split("@", 1)[0]
    return re.sub(r"[-_](\d{8}|\d{4}-\d{2}-\d{2}|latest)$", "", name)


# OpenAI 가 아닌 공개 가중치 계열 — LiteLLM 의 `openai/` (OpenAI 호환: vLLM · LM Studio · 사내 서버) 뒤에 있어도 OpenAI 가 아니다
_OPEN_WEIGHTS = re.compile(r"^(llama|qwen|qwq|phi|gemma|mistral|mixtral|command|yi|glm|kimi|minimax|olmo|falcon|internlm|baichuan|nemotron)")


def _hint(base: str) -> str | None:
    for pattern, provider in _ID_HINTS:
        if pattern.search(base):
            return provider
    return None


def _from_raw(raw: str, base: str) -> str:
    p = normalize_provider(raw)
    if raw.strip().lower() == "openai":
        # LiteLLM `openai/<이름>` + api_base = 아무 OpenAI 호환 서버. 이름이 다른 회사 모델이면 이름을 믿는다
        hint = _hint(base)
        if hint not in (None, "openai"):
            return hint
        if hint is None and _OPEN_WEIGHTS.search(base):
            return "other"
    return p  # 모르는 이름(별칭 등)은 LiteLLM 말대로 openai


def provider_of(gateway_id: str, raw_providers: Sequence[str]) -> str:
    """대표 provider 하나. 여러 개(로드밸런싱)면 첫 번째로 알아본 것."""
    if gateway_id.lower().startswith(MOCK_PREFIX):
        return "brewai"
    base = _base_name(gateway_id)
    for raw in raw_providers:
        if (p := _from_raw(raw, base)) != "other":
            return p
    if raw_providers:
        return "other"
    return _hint(base) or "other"


def providers_of(gateway_id: str, raw_providers: Sequence[str]) -> list[str]:
    """중복 없는 정규화 목록 (관리자 표의 '여러 provider' 표시용). 첫 항목 = provider_of()."""
    first = provider_of(gateway_id, raw_providers)
    base = _base_name(gateway_id)
    out = [first]
    for raw in raw_providers:
        p = _from_raw(raw, base)
        if p not in out:
            out.append(p)
    return out


# 알아보는 모델 이름만 예쁘게 바꾼다. 모르는 이름(예: fake-chat-small)은 게이트웨이 id 그대로.
_FAMILY_WORDS = {
    "claude": "Claude",
    "gpt": "GPT",
    "chatgpt": "ChatGPT",
    "gemini": "Gemini",
    "gemma": "Gemma",
    "mistral": "Mistral",
    "mixtral": "Mixtral",
    "ministral": "Ministral",
    "codestral": "Codestral",
    "magistral": "Magistral",
    "devstral": "Devstral",
    "deepseek": "DeepSeek",
    "grok": "Grok",
    "llama": "Llama",
    "qwen": "Qwen",
    "brewai": "BrewAI",
}
_LOWER_WORDS = {"mini", "nano"}  # OpenAI 표기: "GPT-5 mini", "o4-mini"
_NUM = re.compile(r"^\d+(\.\d+)?$")


def _word(token: str) -> str:
    if token in _FAMILY_WORDS:
        return _FAMILY_WORDS[token]
    if token in _LOWER_WORDS or _NUM.match(token) or re.fullmatch(r"o\d+", token):
        return token
    if re.fullmatch(r"[a-z]\d+", token):  # r1 · v3
        return token.upper()
    if re.fullmatch(r"\d+[a-z]+", token):  # 4o · 70b
        return token if token.endswith("o") else token.upper()
    return token[:1].upper() + token[1:]


def pretty_name(gateway_id: str) -> tuple[str, str | None]:
    """(기본 표시 이름, 계열). 계열 = 버전 앞 이름 (Claude Sonnet · GPT · Gemini). 모르는 이름 = (id, None)."""
    base = _base_name(gateway_id)
    tokens = [t for t in re.split(r"[-_\s]+", base) if t]
    if not tokens:
        return gateway_id, None
    first = tokens[0]
    o_series = re.fullmatch(r"o\d+", first) is not None
    if first not in _FAMILY_WORDS and not o_series:
        return gateway_id, None
    # 숫자 조각 잇기: claude-sonnet-4-5 → 4.5
    merged: list[str] = []
    for t in tokens:
        if merged and t.isdigit() and len(t) <= 2 and merged[-1].isdigit() and len(merged[-1]) <= 2:
            merged[-1] = f"{merged[-1]}.{t}"
        else:
            merged.append(t)
    words = [_word(t) for t in merged]
    family_words: list[str] = []
    for t, w in zip(merged, words, strict=True):
        if _NUM.match(t) or re.fullmatch(r"\d+[a-z]+", t) or (family_words and re.fullmatch(r"[a-z]\d+", t)):
            break
        family_words.append(w)
    family = first if o_series else (" ".join(family_words) or words[0])
    if first in ("gpt", "chatgpt") and len(words) > 1:
        label = f"{words[0]}-{words[1]}" + ("".join(f" {w}" for w in words[2:]))  # GPT-6.1 Sol
    elif o_series:
        label = "-".join(words)  # o4-mini
    else:
        label = " ".join(words)
    return label, family
