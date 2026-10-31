"""범위 계층 = 이 파일 한 곳 (ADR-0011). 지금: 조직 > 스페이스 > 프로젝트 > 대화.

층 이름을 바꾸거나 층을 끼워 넣을 때 고칠 곳 = 아래 LEVELS 표 + store 마이그레이션 + 화면 문구. 그 밖의 코드는 이 표를 묻는다:
  LEVELS      위 → 아래. parents = (이 표의 칸, 부모 층) 가까운 것 먼저 — 값이 NULL 이면 다음 후보
              (대화는 프로젝트 없이 스페이스에 바로 있을 수 있다 = optional 층)
  MEMBERSHIP  멤버 · 역할이 붙는 층. 그 아래 층은 그대로 물려받는다 (프로젝트 멤버 없음 · 판정 = auth/policy.py)
  TENANT      사람 묶음 (가입 · 초대 · 조직 역할)
  ITEM        사용자가 쓰는 맨 아래 단위 (대화)
API 는 자원마다 `path` = [{kind, id, name}] (위 → 아래, 자기 자신 포함)를 돌려준다 → 화면은 층 수를 모른 채 breadcrumb 를 그린다.
`GET /api/scopes` = 이 표. 화면은 같은 표를 packages/ui/src/scope.ts 에 갖고 있다 (같은지 = tests/test_scopes.py).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, TypedDict

if TYPE_CHECKING:  # store.py 가 이 표(LEVELS)를 읽는다 → 여기선 타입으로만 (순환 import 없음)
    from .store import Store

Kind = Literal["org", "space", "project", "thread"]


@dataclass(frozen=True)
class Level:
    kind: Kind
    table: str
    parents: tuple[tuple[str, Kind], ...] = ()  # (칸, 부모 층) 가까운 것 먼저 · 비면 맨 위
    name_col: str = "name"
    optional: bool = False  # 아래 층이 이 층을 건너뛰고 바로 위에 붙을 수 있다


LEVELS: tuple[Level, ...] = (
    Level("org", "orgs"),
    Level("space", "spaces", parents=(("org_id", "org"),)),
    Level("project", "projects", parents=(("space_id", "space"),), optional=True),
    Level("thread", "threads", parents=(("project_id", "project"), ("space_id", "space")), name_col="title"),
)
TENANT: Kind = "org"
MEMBERSHIP: Kind = "space"
ITEM: Kind = "thread"

_BY_KIND = {lv.kind: lv for lv in LEVELS}
INSTALL = "install"  # 층 위 = 설치본 전체 (관리자 공통 · MCP 공유 범위의 맨 위)


class Crumb(TypedDict):
    kind: str
    id: str
    name: str | None


def level(kind: str) -> Level:
    return _BY_KIND[kind]  # type: ignore[index]


def depth(kind: str) -> int:
    return LEVELS.index(level(kind))


def share_kinds() -> tuple[str, ...]:
    """공유 범위 = 설치본 + 맨 위 층부터 멤버십 층까지 (지금 install · org · space). MCP 서버 공유(store mcp_server_shares)가 쓴다."""
    return (INSTALL, *(lv.kind for lv in LEVELS[: depth(MEMBERSHIP) + 1]))


def describe() -> list[dict[str, Any]]:
    """GET /api/scopes — 층 표 (층 이름 · 부모 · 건너뛸 수 있나 · 멤버십 층). 화면 사본 = packages/ui/src/scope.ts LEVELS."""
    return [
        {
            "kind": lv.kind, "parent": lv.parents[0][1] if lv.parents else None, "optional": lv.optional,
            "membership": lv.kind == MEMBERSHIP, "tenant": lv.kind == TENANT, "item": lv.kind == ITEM,
        }
        for lv in LEVELS
    ]


class Scopes:
    """경로(breadcrumb) · 멤버십 층 찾기. 판정은 하지 않는다 (볼 수 있는지는 부르는 쪽이 먼저 policy 로)."""

    def __init__(self, store: Store) -> None:
        self.store = store

    def _rows(self, lv: Level, ids: Iterable[str]) -> dict[str, tuple[str | None, str | None, Kind | None]]:
        """{id: (이름, 부모 id, 부모 층)} — 한 층 한 번의 SELECT."""
        wanted = sorted({i for i in ids if i})
        if not wanted:
            return {}
        cols = ", ".join(c for c, _ in lv.parents)
        rows = self.store.query(
            f"SELECT id, {lv.name_col} AS name{', ' + cols if cols else ''} FROM {lv.table} WHERE id IN ({','.join('?' * len(wanted))})",
            tuple(wanted),
        )
        out: dict[str, tuple[str | None, str | None, Kind | None]] = {}
        for r in rows:
            parent = next(((r[c], k) for c, k in lv.parents if r[c] is not None), (None, None))
            out[r["id"]] = (r["name"], parent[0], parent[1])
        return out

    def paths(self, kind: str, ids: Iterable[str]) -> dict[str, list[Crumb]]:
        """여러 자원의 경로를 한꺼번에 (층마다 SELECT 한 번 = 목록 API 용). 없는 id 는 결과에 없다."""
        start = list(dict.fromkeys(i for i in ids if i))
        # 아래 → 위로 한 층씩: 지금 층의 id 들 → 그 부모들
        nodes: dict[tuple[str, str], tuple[str | None, str | None, Kind | None]] = {}
        frontier: dict[str, set[str]] = {kind: set(start)}
        while frontier:
            nxt: dict[str, set[str]] = {}
            for k, wanted in frontier.items():
                for node_id, (name, pid, pkind) in self._rows(level(k), (i for i in wanted if (k, i) not in nodes)).items():
                    nodes[(k, node_id)] = (name, pid, pkind)
                    if pid and pkind:
                        nxt.setdefault(pkind, set()).add(pid)
            frontier = nxt
        out: dict[str, list[Crumb]] = {}
        for node_id in start:
            chain: list[Crumb] = []
            key: tuple[str, str] | None = (kind, node_id)
            while key in nodes:
                name, pid, pkind = nodes[key]
                chain.append({"kind": key[0], "id": key[1], "name": name})
                key = (pkind, pid) if pid and pkind else None
            if chain:
                out[node_id] = chain[::-1]
        return out

    def path(self, kind: str, node_id: str | None) -> list[Crumb]:
        return self.paths(kind, [node_id]).get(node_id, []) if node_id else []

    def ancestor(self, kind: str, node_id: str | None, of: str = MEMBERSHIP) -> str | None:
        """그 자원이 속한 `of` 층 id (기본 = 멤버십 층). 자기 자신이 그 층이면 자기 id."""
        return next((c["id"] for c in self.path(kind, node_id) if c["kind"] == of), None)
