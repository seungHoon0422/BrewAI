"""MCP 추천 서버 = presets.json (벤더가 직접 운영하는 원격 MCP · 2026-11-01 실제 확인 · docs/slices/05-mcp.md '실제 서버 확인').

관리자 '서버 추가' · 데스크톱 '앱 추가' 대화상자 위의 빠른 선택. 누르면 주소 · 이름 · 설명 · 부르는 이름만 채운다 — 추가는 사람이 누른다
(ADR-0013: 에이전트가 설치하는 MCP = 허용 목록 + 사람 승인 · 주소 검사 · SSRF 는 추가 때 그대로).
available false = 제공자 쪽 이유로 지금은 못 씀 (사전 등록 client 만 · API 키만 · 자동 등록 거절) → 화면은 회색 + reason.
파일 = 읽기 전용 데이터 (비밀값 없음). 시험 · E2E 는 CONDUCTOR_MCP_PRESETS 로 다른 파일 (가짜 MCP 주소).
분류 (Kinds) = 연결된 앱 화면의 묶음 (문서 · 검색 · 개발 · 업무 …). 추천 서버와 같은 주소 → 같은 호스트(분류가 하나일 때) → 이름 · 도메인 · 부르는 이름의
낱말 → 도구 이름의 낱말 → 기타. 화면 안내용 (권한 · 프롬프트와 상관없음).
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

from .catalog import valid_handle

log = logging.getLogger("conductor.mcp.presets")

DEFAULT_PATH = Path(__file__).with_name("presets.json")
CATEGORIES = ("dev", "docs", "search", "data", "work", "pay", "design")
AUTHS = ("none", "oauth", "api_key")  # api_key = 지금은 못 씀 (정적 헤더 인증 없음)
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
_URL_PREFIXES = ("https://", "http://127.0.0.1", "http://localhost")

Auth = Literal["none", "oauth", "api_key"]


@dataclass(frozen=True)
class Preset:
    id: str
    handle: str
    name: str
    vendor: str
    url: str
    auth: Auth
    category: str
    description: str
    docs_url: str
    verified_on: str
    available: bool = True
    reason: str | None = None  # available false 일 때 이유 (한 줄)
    note: str | None = None  # 쓸 수는 있지만 알아 둘 것 (예: 제공자가 검토한 앱만 로그인)
    admin_only: bool = False  # 로그인 서버가 다른 사이트 = 사용자 서버로는 issuer_foreign → 관리자 콘솔에서만

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id, "handle": self.handle, "name": self.name, "vendor": self.vendor, "url": self.url, "auth": self.auth,
            "category": self.category, "description": self.description, "docs_url": self.docs_url, "verified_on": self.verified_on,
            "available": self.available, "reason": self.reason, "note": self.note, "admin_only": self.admin_only,
        }


class PresetError(ValueError):
    pass


def _text(d: dict[str, Any], key: str, limit: int, *, required: bool = True) -> str | None:
    v = d.get(key)
    if v is None and not required:
        return None
    if not isinstance(v, str) or not v.strip() or len(v) > limit or "\n" in v or "·" in v:  # 화면 문구 = 가운뎃점 없음 (AGENTS.md)
        raise PresetError(f"{d.get('id')}: bad {key}")
    return v


def parse(doc: Any) -> list[Preset]:
    """presets.json 모양 검사 (틀리면 PresetError · 서버를 띄우지 않는 게 아니라 목록을 비운다 = load)."""
    rows = doc.get("presets") if isinstance(doc, dict) else None
    if not isinstance(rows, list):
        raise PresetError("presets missing")
    out: list[Preset] = []
    seen_id: set[str] = set()
    seen_handle: set[str] = set()
    for d in rows:
        if not isinstance(d, dict):
            raise PresetError("preset not an object")
        pid = d.get("id")
        if not isinstance(pid, str) or not _ID_RE.match(pid) or pid in seen_id:
            raise PresetError(f"bad id {pid!r}")
        handle = d.get("handle")
        if not valid_handle(handle) or handle in seen_handle:
            raise PresetError(f"{pid}: bad handle")
        url = _text(d, "url", 2048)
        if not (url or "").startswith(_URL_PREFIXES):  # 실제 목록은 https 만 (http = 시험 파일)
            raise PresetError(f"{pid}: bad url")
        docs_url = _text(d, "docs_url", 2048)
        if not (docs_url or "").startswith(_URL_PREFIXES):  # 화면이 링크(href)로 그린다 = javascript: 등 금지
            raise PresetError(f"{pid}: bad docs_url")
        auth = d.get("auth")
        category = d.get("category")
        if auth not in AUTHS or category not in CATEGORIES:
            raise PresetError(f"{pid}: bad auth or category")
        available = d.get("available", True) is True
        reason = _text(d, "reason", 120, required=not available)
        out.append(Preset(
            id=pid, handle=handle, name=_text(d, "name", 40) or "", vendor=_text(d, "vendor", 40) or "", url=url or "",
            auth=auth, category=category, description=_text(d, "description", 80) or "", docs_url=docs_url or "",
            verified_on=_text(d, "verified_on", 10) or "", available=available, reason=reason if not available else None,
            note=_text(d, "note", 120, required=False), admin_only=d.get("admin_only") is True,
        ))
        seen_id.add(pid)
        seen_handle.add(handle)
    return out


def load(path: str | Path | None = None) -> list[Preset]:
    """파일을 읽어 검사. 없거나 틀리면 빈 목록 + 경고 (추천 목록이 없어도 주소 직접 넣기는 된다)."""
    p = Path(path) if path else DEFAULT_PATH
    try:
        return parse(json.loads(p.read_text(encoding="utf-8")))
    except (OSError, ValueError) as e:
        log.warning("mcp presets unavailable (%s): %s", p.name, e)
        return []


# ── 분류 (연결된 앱 묶음) ─────────────────────────────────────────────────────────────
APP_CATEGORIES = ("docs", "search", "dev", "work", "data", "design", "pay", "other")
# 낱말 (영문 = 낱말 하나와 같을 때 · 한글 = 들어 있으면). 앞 분류가 먼저 (검색 앱의 '문서 검색' 설명보다 이름 · 도메인을 본다)
_WORDS: dict[str, tuple[str, ...]] = {
    "search": ("search", "tavily", "exa", "brave", "serp", "serpapi", "serper", "perplexity", "kagi", "bing", "duckduckgo", "searxng", "검색"),
    "docs": ("docs", "doc", "documentation", "learn", "wiki", "deepwiki", "notion", "confluence", "context7", "mintlify", "gitbook", "readme",
             "knowledge", "notes", "note", "drive", "dropbox", "box", "문서", "메모", "위키", "노트"),
    "dev": ("github", "gitlab", "git", "sentry", "vercel", "netlify", "cloudflare", "railway", "render", "buildkite", "circleci", "postman",
            "npm", "code", "deploy", "repo", "개발", "코드", "배포"),
    "work": ("linear", "jira", "atlassian", "asana", "slack", "trello", "monday", "clickup", "calendar", "gmail", "mail", "hubspot", "intercom",
             "zapier", "todoist", "tracker", "issue", "issues", "task", "tasks", "업무", "이슈", "일정", "트래커", "캘린더", "메일", "할일"),
    "data": ("data", "database", "db", "sql", "postgres", "supabase", "neon", "prisma", "bigquery", "snowflake", "analytics", "grafana",
             "datadog", "posthog", "airtable", "huggingface", "데이터", "통계"),
    "design": ("figma", "canva", "miro", "webflow", "design", "디자인"),
    "pay": ("stripe", "paypal", "square", "squareup", "plaid", "toss", "payment", "payments", "pay", "결제"),
}
_TOKEN = re.compile(r"[a-z0-9]+|[가-힣]+")


def _hits(text: str) -> dict[str, int]:
    """글 → 분류마다 맞은 낱말 수."""
    out: dict[str, int] = {}
    for tok in _TOKEN.findall(text.lower()):
        hangul = not tok.isascii()
        for cat, words in _WORDS.items():
            if any((w in tok) if hangul else (w == tok) for w in words if w.isascii() != hangul):
                out[cat] = out.get(cat, 0) + 1
    return out


def _best(hits: dict[str, int]) -> str | None:
    if not hits:
        return None
    top = max(hits.values())
    return next(c for c in APP_CATEGORIES if hits.get(c) == top)


class Kinds:
    """앱 → 분류 하나. presets 주소는 한 번만 정규화 (canon = 정규 주소 | None · 이 환경에서 막힌 주소는 건너뜀)."""

    def __init__(self, presets: list[Preset], canon: Any) -> None:
        self.by_url: dict[str, str] = {}
        hosts: dict[str, set[str]] = {}
        for p in presets:
            url = canon(p.url)
            if not url:
                continue
            self.by_url.setdefault(url, p.category)
            hosts.setdefault(urlsplit(url).netloc, set()).add(p.category)
        self.by_host = {h: next(iter(c)) for h, c in hosts.items() if len(c) == 1}

    def of(self, url: str, words: list[str], tools: Any = None) -> str:
        """url = 정규 주소 · words = 이름 · 부르는 이름 · 별칭 · 도메인 · tools = 도구 이름 목록을 돌려주는 함수 (필요할 때만 부른다)."""
        cat = self.by_url.get(url) or self.by_host.get(urlsplit(url).netloc)
        if cat:
            return cat
        cat = _best(_hits(" ".join(words)))
        if cat is None and tools is not None:
            cat = _best(_hits(" ".join(n.replace("_", " ") for n in tools())))
        return cat or "other"
