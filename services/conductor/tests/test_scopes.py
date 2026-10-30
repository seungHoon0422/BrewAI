"""범위 계층은 scopes.py 한 곳 — 표가 DB 와 맞는지 · 다른 파일이 층 순서를 따로 갖고 있지 않은지 · 경로(path) 모양."""

from __future__ import annotations

import json
import re
from pathlib import Path

from pydantic_ai.models.test import TestModel

from conductor import scopes
from conductor.store import Store

SRC = Path(scopes.__file__).parent
KINDS = "|".join(lv.kind for lv in scopes.LEVELS)
# 층 이름 두 개 이상이 나란히 = 계층을 따로 적은 것 (예: ("org", "space", ...) · ['space', 'project'])
SEQUENCE = re.compile(rf"""["']({KINDS})["']\s*,\s*["']({KINDS})["']""")


def test_levels_match_the_database() -> None:
    store = Store(":memory:")
    tables = {r["name"] for r in store.query("SELECT name FROM sqlite_master WHERE type = 'table'")}
    for lv in scopes.LEVELS:
        assert lv.table in tables, lv
        cols = {r["name"] for r in store.query(f"PRAGMA table_info({lv.table})")}
        assert lv.name_col in cols
        fks = {(r["from"], r["table"]) for r in store.query(f"PRAGMA foreign_key_list({lv.table})")}
        for col, parent in lv.parents:
            assert (col, scopes.level(parent).table) in fks, (lv.kind, col)  # 부모 칸 = 진짜 외래 키
            assert scopes.depth(parent) < scopes.depth(lv.kind)  # 위 → 아래 순서
    assert [lv.kind for lv in scopes.LEVELS if not lv.parents] == [scopes.TENANT]  # 맨 위는 하나
    kinds = [lv.kind for lv in scopes.LEVELS]
    assert scopes.TENANT in kinds and scopes.MEMBERSHIP in kinds and scopes.ITEM == kinds[-1]


def test_no_other_module_spells_out_the_hierarchy() -> None:
    offenders = []
    for path in SRC.rglob("*.py"):
        if path.name == "scopes.py":
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if SEQUENCE.search(line):
                offenders.append(f"{path.relative_to(SRC)}:{n}: {line.strip()}")
    assert offenders == []


def test_describe_is_what_the_ui_reads(make_api) -> None:
    api = make_api(lambda _: TestModel())
    levels = api.client.get("/api/scopes").json()["levels"]
    assert levels == scopes.describe()
    assert [(lv["kind"], lv["parent"]) for lv in levels] == [(lv.kind, lv.parents[0][1] if lv.parents else None) for lv in scopes.LEVELS]
    assert [lv["kind"] for lv in levels if lv["membership"]] == [scopes.MEMBERSHIP]


def test_ui_scope_table_is_the_server_table() -> None:
    """화면의 층 표(packages/ui/src/scope.ts LEVELS) = describe(). 층을 넣거나 이름을 바꾸면 둘 다 (+ 마이그레이션)."""
    ui = Path(__file__).resolve().parents[3] / "packages" / "ui" / "src" / "scope.ts"
    rows = re.findall(r"^\s*(\{ kind: '[^']+'.*\}),$", ui.read_text(encoding="utf-8"), re.M)
    as_json = [json.loads(re.sub(r"(\w+):", r'"\1":', r.replace("'", '"'))) for r in rows]
    assert as_json == scopes.describe()


def test_paths_walk_up_skipping_optional_levels(make_api, h) -> None:
    api = make_api(lambda _: TestModel())
    space = api.me["personal_space_id"]
    project = api.client.post(f"/api/spaces/{space}/projects", json={"name": "P"}).json()
    api.client.post("/api/chat", json=h.chat_body("묶인 대화", thread="t-in", run="r1", projectId=project["id"]))
    api.client.post("/api/chat", json=h.chat_body("그냥 대화", thread="t-out", run="r2"))
    s = api.app.state.scopes
    paths = s.paths("thread", ["t-in", "t-out", "missing"])
    assert [c["kind"] for c in paths["t-in"]] == ["org", "space", "project", "thread"]
    assert [c["kind"] for c in paths["t-out"]] == ["org", "space", "thread"]  # 프로젝트 없음 = 스페이스에 바로
    assert "missing" not in paths
    assert paths["t-in"][-1] == {"kind": "thread", "id": "t-in", "name": "묶인 대화"}
    assert s.ancestor("thread", "t-in") == space == s.ancestor("project", project["id"]) == s.ancestor("space", space)
    assert s.ancestor("thread", "t-in", of=scopes.TENANT) == api.me["orgs"][0]["id"]
    assert s.path("thread", None) == [] and s.ancestor("project", "nope") is None
