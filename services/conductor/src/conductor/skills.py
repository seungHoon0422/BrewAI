"""제품 스킬 = runtime/skills/<이름>/SKILL.md (AGENTS.md: 개발 루틴 .claude/skills 와 섞지 않는다). 순수 파이썬.

SKILL.md = 머리말(frontmatter) + 본문(지침). 코드를 실행하지 않는다 — 글만 읽어 모델에게 준다.
  ---
  name: compare-table            # 폴더 이름과 같아야 한다 · 소문자·숫자·- (48자까지)
  label: 비교표 만들기             # 화면 이름 (없으면 name)
  description: 여러 후보를 …       # 모델이 언제 쓸지 고르는 한 줄 (300자까지)
  tools: [some_tool]               # 선택. 이 스킬이 기대는 툴 이름 (known_tools 를 주면 모르는 이름 = 거절 · 지금은 내장 툴이 없어 안 본다)
  ---
  본문 …
점진 공개 (slice 08): 시스템 프롬프트엔 '스킬 N개 + 화면 이름 몇 개' 한 줄만 (스킬이 늘어도 거의 그대로 = 프롬프트 캐시) · 도구 인자 = need(할 일)
· 서버가 이름 · 화면 이름 · 설명으로 고른다 (BM25 + 한영 사전 · connectors/rank.py · LLM 없음) → 맞는 스킬 본문 + 다른 후보 이름.
스킬의 tools = 그 스킬을 부르면 도구 배열에 실리는 도구 (make_file 등 · agent._SkillGatedTools · 부르기 전엔 요청에 0).
안전: 허용 폴더(root) 바로 아래 폴더만 · 심볼릭 링크·root 밖으로 나가는 경로 거절 · 파일 16KB · 스킬 50개 · 머리말 키 4개만.
버전 = SKILL.md 의 sha256 앞 12자 (줄바꿈 LF 로 맞춘 뒤 · 관리자 카탈로그). 새 스킬 저장·등록(격리 → 테스트 → 승인)은 P5 — 여기는 읽기만.
"""

from __future__ import annotations

import hashlib
import logging
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .connectors.rank import bm25, tokens
from .tools import USE_SKILL, ToolSpec

log = logging.getLogger("conductor.skills")

SKILL_FILE = "SKILL.md"
MAX_SKILL_BYTES = 16_384
MAX_SKILLS = 50
MAX_DESCRIPTION = 300
MAX_LABEL = 40
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")
_KEYS = ("name", "label", "description", "tools")
_TOOL_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
PROMPT_LABELS = 12  # 프롬프트 한 줄에 보일 화면 이름 수 (넘으면 '외 N개')
OTHERS = 3  # use_skill 결과의 다른 후보 수


def _word(tok: str) -> bool:
    """한 글자 한글 낱말(줘 · 해 · 좀 …)은 빼고 센다 — '… 해 줘' 같은 말끝이 모든 스킬에 점수를 주지 않게."""
    return tok.isascii() or len(tok) > 1


class SkillError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Skill:
    name: str
    label: str
    description: str
    tools: tuple[str, ...]
    body: str
    version: str  # sha256 앞 12자
    source: str = "runtime/skills"
    builtin: bool = True  # 우리가 레포에 넣은 스킬 (P5 = 사용자가 만든 스킬은 False)

    def row(self) -> dict[str, Any]:
        return {
            "name": self.name, "label": self.label, "description": self.description, "tools": list(self.tools),
            "version": self.version, "source": self.source, "builtin": self.builtin, "lines": len(self.body.splitlines()),
        }


def _unquote(value: str) -> str:
    v = value.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        return v[1:-1]
    return v


def _fail(code: str, message: str) -> SkillError:
    return SkillError(code, message)


def parse_skill(text: str, *, dirname: str, known_tools: Iterable[str] = (), source: str = "runtime/skills") -> Skill:
    """SKILL.md 글 → Skill. 틀리면 SkillError (code: frontmatter · bad_key · bad_name · …)."""
    raw = text.replace("\r\n", "\n").lstrip("﻿")
    if not raw.startswith("---\n"):
        raise _fail("frontmatter", "첫 줄이 --- 가 아니에요")
    end = raw.find("\n---\n", 4)
    if end < 0 and raw.endswith("\n---"):
        end = len(raw) - 4
    if end < 0:
        raise _fail("frontmatter", "머리말을 닫는 --- 가 없어요")
    head, body = raw[4:end], raw[end + 5 :].strip()
    meta: dict[str, Any] = {}
    current_list: list[str] | None = None
    for n, line in enumerate(head.split("\n"), 2):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line.startswith(("  - ", "- ")) and current_list is not None:
            current_list.append(_unquote(line.split("-", 1)[1]))
            continue
        current_list = None
        if ":" not in line or line[0].isspace():
            raise _fail("frontmatter", f"{n}번째 줄을 읽지 못했어요 (key: value)")
        key, value = line.split(":", 1)
        key = key.strip()
        if key not in _KEYS:
            raise _fail("bad_key", f"모르는 머리말 키 '{key[:40]}' (허용: {', '.join(_KEYS)})")
        if key in meta:
            raise _fail("bad_key", f"'{key}' 가 두 번 있어요")
        value = value.strip()
        if key == "tools":
            if value.startswith("[") and value.endswith("]"):
                meta[key] = [_unquote(x) for x in value[1:-1].split(",") if x.strip()]
            elif value == "":
                meta[key] = current_list = []
            else:
                raise _fail("bad_tools", "tools 는 [a, b] 또는 - 목록이에요")
        else:
            meta[key] = _unquote(value)
    name = meta.get("name", "")
    if not NAME_RE.match(name):
        raise _fail("bad_name", "name 은 소문자, 숫자, - 로 48자까지예요")
    if name != dirname:
        raise _fail("bad_name", f"name '{name}' 이 폴더 이름 '{dirname[:48]}' 과 달라요")
    description = " ".join(str(meta.get("description", "")).split())
    if not description:
        raise _fail("bad_description", "description 이 비어 있어요")
    if len(description) > MAX_DESCRIPTION:
        raise _fail("bad_description", f"description 은 {MAX_DESCRIPTION}자까지예요")
    label = " ".join(str(meta.get("label") or name).split())
    if len(label) > MAX_LABEL:
        raise _fail("bad_label", f"label 은 {MAX_LABEL}자까지예요")
    known = set(known_tools)
    tools = tuple(dict.fromkeys(meta.get("tools", [])))
    for t in tools:
        if not _TOOL_RE.match(t) or (known and t not in known):
            raise _fail("bad_tools", f"모르는 툴 '{t[:64]}'")
    if not body:
        raise _fail("empty_body", "본문(지침)이 비어 있어요")
    version = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]  # 줄바꿈을 \n 으로 맞춘 뒤 (윈도우 CRLF 체크아웃도 같은 값)
    return Skill(name=name, label=label, description=description, tools=tools, body=body, version=version, source=source)


@dataclass
class SkillRegistry:
    skills: dict[str, Skill] = field(default_factory=dict)
    errors: list[dict[str, str]] = field(default_factory=list)  # [{dir, code, message}] — 관리자 화면 · 로그
    source: str = "runtime/skills"

    def list(self) -> list[Skill]:
        return list(self.skills.values())

    def get(self, name: str) -> Skill | None:
        return self.skills.get(name) if isinstance(name, str) and NAME_RE.match(name) else None

    def labels(self) -> dict[str, str]:
        return {s.name: s.label for s in self.skills.values()}

    def prompt(self) -> str:
        """시스템 프롬프트에 붙는 한 줄 (스킬 수 + 화면 이름 PROMPT_LABELS 개 · 이름 순 고정 = 프롬프트 캐시). 본문은 use_skill 로."""
        if not self.skills:
            return ""
        ordered = sorted(self.skills.values(), key=lambda s: s.name)
        labels = ", ".join(s.label for s in ordered[:PROMPT_LABELS]) + (f" 외 {len(ordered) - PROMPT_LABELS}개" if len(ordered) > PROMPT_LABELS else "")
        return f"\n스킬 {len(ordered)}개 ({labels}): 맞을 것 같으면 먼저 use_skill {{need}}"

    def find(self, need: str, name: str = "") -> tuple[Skill | None, list[Skill]]:
        """need → (가장 맞는 스킬, 다른 후보). name 이 정확하면 그 스킬. 점수 0 = (None, [])."""
        exact = self.get(name.strip()) if name else None
        if exact is not None:
            return exact, []
        pool = sorted(self.skills.values(), key=lambda s: s.name)
        docs = [[t for t in (*tokens(s.name.replace("-", " ")) * 3, *tokens(s.label) * 2, *tokens(s.description)) if _word(t)] for s in pool]
        scores = bm25(docs, need or name)
        order = [i for i in sorted(range(len(pool)), key=lambda i: (-scores[i], i)) if scores[i] > 0]
        if not order:
            return None, []
        return pool[order[0]], [pool[i] for i in order[1 : 1 + OTHERS]]

    def tool(self) -> ToolSpec | None:
        """use_skill 툴 (스킬이 없으면 None). 인자 = need (할 일 · 스킬이 늘어도 스키마가 그대로) · name (예전 기록 · 이름을 알 때)."""
        if not self.skills:
            return None
        registry = self

        def use_skill(need: str = "", name: str = "") -> dict[str, Any]:
            need, name = str(need or "")[:300], str(name or "")[:48]
            skill, others = registry.find(need, name)
            if skill is None:
                return {
                    "error": "no_skill",
                    "message": "맞는 스킬이 없다. 스킬 없이 바로 하거나 아래 이름으로 다시 부른다.",
                    "available": [f"{s.name} {s.label}" for s in sorted(registry.skills.values(), key=lambda s: s.name)],
                }
            out: dict[str, Any] = {"name": skill.name, "label": skill.label, "tools": list(skill.tools), "instructions": skill.body}
            if others:
                out["others"] = [f"{s.name} {s.label}" for s in others]  # 더 맞는 게 있으면 name 으로 다시
            return out

        schema = {
            "type": "object",
            "properties": {
                "need": {"type": "string", "description": "할 일 한 줄"},
                "name": {"type": "string", "description": "이름을 알 때만"},
            },
            "required": ["need"],
        }
        return ToolSpec(name=USE_SKILL, label="스킬 사용", description="할 일에 맞는 스킬 지침을 찾아 부른다.", function=use_skill, schema=schema)


def load_skills(root: str | Path | None, *, known_tools: Iterable[str] = (), source: str = "runtime/skills") -> SkillRegistry:
    """root 바로 아래 <이름>/SKILL.md 를 읽는다. 틀린 스킬은 건너뛰고 errors 에 남긴다 (기동은 막지 않는다)."""
    registry = SkillRegistry(source=source)
    if root is None:
        return registry
    base = Path(root)
    if not base.is_dir():
        log.info("skills dir not found: %s (no skills)", base)
        return registry
    base_real = base.resolve()
    known = tuple(known_tools)
    for entry in sorted(base.iterdir(), key=lambda p: p.name):
        if entry.name.startswith((".", "_")):
            continue

        def skip(code: str, message: str, entry: Path = entry) -> None:
            registry.errors.append({"dir": entry.name[:64], "code": code, "message": message})
            log.warning("skill %r skipped: %s (%s)", entry.name[:64], code, message)

        if entry.is_symlink() or not entry.is_dir():
            skip("not_a_dir", "스킬은 폴더여야 하고 링크는 안 돼요")
            continue
        if not NAME_RE.match(entry.name):
            skip("bad_name", "폴더 이름은 소문자, 숫자, - 로 48자까지예요")
            continue
        file = entry / SKILL_FILE
        try:
            real = file.resolve(strict=True)
        except (FileNotFoundError, OSError):
            skip("missing_file", f"{SKILL_FILE} 이 없어요")
            continue
        if file.is_symlink() or not real.is_file() or real.parent != entry.resolve() or base_real not in real.parents:
            skip("outside_root", "허용 폴더 밖을 가리키는 파일이에요")
            continue
        if len(registry.skills) >= MAX_SKILLS:
            skip("too_many", f"스킬은 {MAX_SKILLS}개까지예요")
            continue
        size = real.stat().st_size
        if size > MAX_SKILL_BYTES:
            skip("too_large", f"{SKILL_FILE} 은 {MAX_SKILL_BYTES // 1024}KB 까지예요")
            continue
        try:
            text = real.read_bytes()[: MAX_SKILL_BYTES + 1].decode("utf-8")
            skill = parse_skill(text, dirname=entry.name, known_tools=known, source=source)
        except UnicodeDecodeError:
            skip("not_utf8", "UTF-8 글이 아니에요")
            continue
        except SkillError as e:
            skip(e.code, e.message)
            continue
        registry.skills[skill.name] = skill
    if registry.skills:
        log.info("skills loaded: %s", ", ".join(registry.skills))
    return registry
