"""need(한국어 · 영어) → 도구 순위. LLM 없이 서버 안에서 (use_app 의 도구 고르기 · 앱 이름 없을 때 앱 고르기 · ADR-0013).

문서 하나 = 도구 하나: 이름 낱말(search_issues · issues.search · searchIssues 쪼갬) ×3 · 제목 · 별칭 ×2 · 설명 ×1.
낱말 = 영문 소문자 + 간단한 복수형 정리(issues → issue) · 한글은 이어진 글자를 bigram 으로(이슈검색 → 이슈 · 슈검 · 검색) — 띄어쓰기 · 조사에 덜 흔들린다.
need 에는 작은 한→영 사전을 더한다 (이슈 → issue · 검색 → search …) — 영어로만 쓴 서버 도구도 한국어 요청으로 찾게.
점수 = BM25 (k1 1.2 · b 0.75). 읽기 도구 ×1.15 (기본 우선) · need 가 '만들기 · 고치기 · 지우기' 쪽이면 쓰기 도구 ×1.15 (쓰기도 허용)
· 아니면 쓰기 도구 ×0.5 (찾기 요청에 '이슈 지우기' 가 '이슈' 한 낱말로 끼지 않게).
점수가 모두 0 = 읽기 도구 먼저 원래 순서. 같은 점수 = 원래 순서 (결정적 = 같은 need 면 같은 도구 = 프롬프트 캐시가 산다).
pydantic 기본 검색(search_tools)은 `[a-z0-9]+` 라 한글을 버린다 → 이 파일이 대신한다 (search_tools 는 안 싣는다).
"""

from __future__ import annotations

import math
import re
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from .client import Tool, words

K1 = 1.2
B = 0.75
READ_BOOST = 1.15
WRITE_BOOST = 1.15
WRITE_DAMP = 0.5
_HANGUL = re.compile(r"[가-힣]+")
_ASCII = re.compile(r"[A-Za-z0-9]+")

# 한 → 영 (need 쪽에만 더한다). 짧게 유지 — 별칭(관리자 · 사용자)이 서버마다 나머지를 채운다
KO_EN: dict[str, tuple[str, ...]] = {
    "이슈": ("issue", "ticket"), "티켓": ("ticket", "issue"), "버그": ("bug", "issue"), "작업": ("task", "issue"), "할일": ("task", "todo"),
    "검색": ("search", "find", "query"), "찾": ("search", "find"), "조회": ("get", "list", "search"), "목록": ("list",),
    "보여": ("list", "get"), "읽": ("read", "get"), "가져": ("get", "fetch"), "알려": ("get", "list"),
    "만들": ("create",), "생성": ("create",), "추가": ("add", "create"), "작성": ("create", "write"), "등록": ("create", "add"), "올려": ("create", "upload", "post"),
    "수정": ("update", "edit"), "고쳐": ("update", "edit"), "바꿔": ("update", "set"), "변경": ("update", "set"), "업데이트": ("update",),
    "삭제": ("delete", "remove"), "지워": ("delete", "remove"), "닫": ("close",), "보관": ("archive",),
    "댓글": ("comment",), "답글": ("reply", "comment"), "메시지": ("message",), "보내": ("send", "post"), "채널": ("channel",),
    "프로젝트": ("project",), "팀": ("team",), "사용자": ("user",), "사람": ("user", "member"), "담당": ("assignee", "assign"),
    "문서": ("document", "doc", "page"), "페이지": ("page",), "파일": ("file",), "폴더": ("folder",), "저장소": ("repository", "repo"),
    "일정": ("event", "calendar"), "캘린더": ("calendar",), "회의": ("meeting", "event"), "메일": ("email", "mail"),
    "상태": ("status", "state"), "라벨": ("label",), "태그": ("tag", "label"), "마일스톤": ("milestone",), "사이클": ("cycle",),
    "풀리퀘": ("pull", "request"), "커밋": ("commit",), "브랜치": ("branch",), "데이터베이스": ("database",),
}
_WRITE_INTENT = ("만들", "생성", "추가", "작성", "등록", "올려", "수정", "고쳐", "바꿔", "변경", "삭제", "지워", "닫", "보내", "보관", "업데이트",
                 "create", "add", "update", "edit", "delete", "remove", "send", "post", "close", "write", "set")


def _stem(w: str) -> str:
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def tokens(text: str) -> list[str]:
    """영문 낱말(쪼갬 · 소문자 · 복수형 정리) + 한글 bigram (한 글자 덩어리는 그 글자)."""
    out: list[str] = []
    for chunk in _ASCII.findall(text or ""):
        out.extend(_stem(w) for w in words(chunk))
    for run in _HANGUL.findall(text or ""):
        out.extend([run] if len(run) == 1 else [run[i : i + 2] for i in range(len(run) - 1)])
    return out


def query_tokens(need: str) -> list[str]:
    toks = tokens(need)
    for ko, en in KO_EN.items():
        if ko in need:
            toks.extend(en)
    return toks


def write_intent(need: str) -> bool:
    low = (need or "").lower()
    return any(k in low for k in _WRITE_INTENT)


@dataclass(frozen=True)
class Scored:
    tool: Tool
    score: float


def _doc(tool: Tool, aliases: Iterable[str]) -> list[str]:
    name = [_stem(w) for w in words(tool.name)]
    doc = name * 3
    if tool.title:
        doc += tokens(tool.title) * 2
    for a in aliases:
        doc += tokens(a) * 2
    doc += tokens(tool.description)
    return doc


def score(tools: Sequence[Tool], need: str, *, aliases: Mapping[str, Iterable[str]] | None = None) -> list[Scored]:
    """모든 도구의 점수 (원래 순서). aliases = {원래 이름: [별칭 …]} (관리자 mcp_tool_policy · 서버 별칭)."""
    aliases = aliases or {}
    docs = [_doc(t, aliases.get(t.name, ())) for t in tools]
    q = list(dict.fromkeys(query_tokens(need)))  # 같은 낱말 반복은 한 번
    n = len(docs)
    if not n:
        return []
    avg = sum(len(d) for d in docs) / n or 1.0
    df = Counter(tok for d in docs for tok in set(d))
    wants_write = write_intent(need)
    out: list[Scored] = []
    for tool, d in zip(tools, docs, strict=True):
        tf = Counter(d)
        s = 0.0
        for tok in q:
            f = tf.get(tok, 0)
            if not f:
                continue
            idf = math.log(1 + (n - df[tok] + 0.5) / (df[tok] + 0.5))
            s += idf * f * (K1 + 1) / (f + K1 * (1 - B + B * len(d) / avg))
        if s > 0:
            if tool.write:
                s *= WRITE_BOOST if wants_write else WRITE_DAMP
            elif not wants_write:
                s *= READ_BOOST
        out.append(Scored(tool, s))
    return out


def rank_tools(
    tools: Sequence[Tool], need: str, *, k: int = 4, aliases: Mapping[str, Iterable[str]] | None = None,
    always: Iterable[str] = (), hidden: Iterable[str] = (),
) -> list[Tool]:
    """use_app 이 공개할 도구 = always(관리자 '항상 같이 열기') + 점수 순 k 개. hidden(관리자 숨김)은 빼고."""
    hide = set(hidden)
    pool = [t for t in tools if t.name not in hide]
    pinned = [t for t in pool if t.name in set(always)]
    rest = [t for t in pool if t.name not in set(always)]
    scored = score(rest, need, aliases=aliases)
    if any(s.score > 0 for s in scored):
        order = sorted(range(len(scored)), key=lambda i: (-scored[i].score, i))
        picked = [scored[i].tool for i in order if scored[i].score > 0][:k]
    else:
        picked = sorted(rest, key=lambda t: t.write)[:k]  # 읽기 먼저 · 원래 순서 (sorted 는 안정)
    return pinned + picked


def search(tools: Sequence[Tool], query: str, *, k: int = 8, aliases: Mapping[str, Iterable[str]] | None = None) -> list[Tool]:
    """앱 고르기 (session.pick: app 없이 use_app) — 점수 0 은 안 돌려준다 (못 찾음 = 빈 목록)."""
    scored = score(tools, query, aliases=aliases)
    order = sorted((i for i, s in enumerate(scored) if s.score > 0), key=lambda i: (-scored[i].score, i))
    return [scored[i].tool for i in order[:k]]
