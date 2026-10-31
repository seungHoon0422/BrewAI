"""사람마다 보이는 MCP 서버 + 프롬프트 앱 목록 (ADR-0013 · slice 05 '서버가 내 목록에 오는 길 3개').

  install   전체 공통 = auto_include 공유(지금은 관리자 서버의 install 공유) 범위 안 → 바로 내 목록 · [숨기기] 가능
  own       내가 추가 (주인 = 나 · 본인만)
  imported  남이 내 조직 · 스페이스에 공유 → [가져오기] 한 사람만 · 멤버십이 끊기면 share_lost (대화에서 빠짐 · 설정에 '공유가 끊겼어요')
판정은 auth/policy.py (mcp_visible · mcp_importable) — 여기선 DB 사실을 모아 넘기고 결과를 줄로 만든다.
handle = 사람마다 겹치지 않게 (내 별칭 > 서버 handle · 겹치면 _2 …) — 도구 이름 `<handle>__<tool>` 의 앞부분.
  처음 목록에 오를 때 정한 handle 을 내 줄(mcp_user_servers.handle)에 적어 둔다 = 서버를 더하거나 빼도 이미 쓰던 이름이 다른 서버로 옮겨 가지 않는다
  (대화에 고정된 `<handle>__<tool>` 이 남의 서버로 가지 않게 · 대화 기록 쪽 확인은 session.call 의 pinned)
관리자 정책(사용자 서버 허용 · 주소 허용 목록)은 추가할 때만이 아니라 목록 · 대화 · 연결 때마다 본다 (blocked = 막힌 사용자 서버).
프롬프트 블록 = 정렬 고정(handle) 한 줄씩 `- linear (Linear): 이슈, 프로젝트 [연결됨]` · 합계 900토큰 상한
  → 넘으면 이름만 (연결됨 · 최근 쓴 것 먼저) → 그래도 넘으면 '… 외 N개'. 서버 0개 = 빈 문자열 (0토큰).
설명 · 이름은 서버를 추가한 사람이 쓴 데이터 → 한 줄 · 80자 · 대괄호 · 백틱 빼고 싣는다 (지시처럼 보이지 않게).
"""

from __future__ import annotations

import json
import re
import sqlite3
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urlsplit

from .. import scopes
from ..auth import policy
from ..auth.policy import Actor, McpServerFacts, McpShareFacts, SpaceFacts
from ..store import MCP_SHARE_KINDS, Store, StoreConflict, now_iso
from . import ssrf
from .client import clean_text, estimate_tokens

HANDLE_RE = re.compile(r"^[a-z0-9]+(?:_[a-z0-9]+)*$")  # '__' 없음 = 도구 이름 `<handle>__<tool>` 이 다시 나뉜다
HANDLE_MIN, HANDLE_MAX = 2, 20
DESC_MAX = 80
NAME_MAX = 40
ALIASES_MAX = 10
PROMPT_BUDGET = 900
AUTO_AUTH = ("unset", "on", "off")  # users.mcp_auto_auth (unset = 처음 한 번 묻는다 · 꺼짐으로 셈)
TOOL_MODES = ("hidden", "auto", "approval")  # mcp_tool_policy.mode (approval = slice 07 승인 카드 뒤)
META_ALLOW_USER = "mcp.allow_user_servers"
META_ALLOWLIST = "mcp.url_allowlist"
SHARE_KINDS = MCP_SHARE_KINDS  # = scopes.share_kinds() (설치본 + 맨 위 층 ~ 멤버십 층)

Source = Literal["install", "own", "imported"]
Connection = Literal["none", "connected", "expired", "needs_login"]
CONNECTION_LABEL = {"none": "연결됨", "connected": "연결됨", "expired": "다시 로그인 필요", "needs_login": "연결 필요"}


def valid_handle(h: str | None) -> bool:
    return isinstance(h, str) and HANDLE_MIN <= len(h) <= HANDLE_MAX and HANDLE_RE.match(h) is not None


def domain_of(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower()
    return host.removeprefix("www.").removeprefix("mcp.") or host


def make_handle(name: str, url: str) -> str:
    """이름(영문이면) → 아니면 도메인 첫 낱말. 'Linear' → linear · 'GitHub Issues' → github_issues · '리니어' + mcp.linear.app → linear."""
    base = "_".join(re.findall(r"[a-z0-9]+", (name or "").lower()))
    if len(base) < HANDLE_MIN:
        label = domain_of(url).split(".")[0]
        base = "_".join(re.findall(r"[a-z0-9]+", label.lower()))
    base = base[:HANDLE_MAX].strip("_")
    return base if valid_handle(base) else "app"


def clean_description(raw: Any) -> str:
    """에이전트가 읽는 한 줄 설명: 제어 문자 · 줄바꿈 · 대괄호 · 백틱 · 꺾쇠 빼고 80자."""
    return clean_text(re.sub(r"[\[\]`<>{}]", " ", str(raw or "")), DESC_MAX)


def clean_name(raw: Any) -> str:
    return clean_text(re.sub(r"[\[\]`<>{}()]", " ", str(raw or "")), NAME_MAX)


def clean_aliases(raw: Iterable[Any] | None) -> list[str]:
    out: list[str] = []
    for a in raw or ():
        t = clean_text(re.sub(r"[\[\]`<>{}]", " ", str(a)), 30)
        if t and t not in out:
            out.append(t)
    return out[:ALIASES_MAX]


@dataclass(frozen=True)
class App:
    server_id: str
    handle: str  # 이 사람에게 겹치지 않는 handle
    name: str
    url: str
    resource: str
    domain: str
    description: str
    aliases: tuple[str, ...]
    auth: Literal["oauth", "none"]
    origin: Literal["admin", "user"]
    source: Source
    status: Literal["active", "disabled", "error"]
    connection: Connection
    hidden: bool = False
    share_lost: bool = False  # 가져온 서버인데 공유 범위 멤버십이 끊김
    tool_count: int | None = None
    tool_tokens_est: int | None = None
    owner_user_id: str | None = None
    last_used_at: str | None = None
    issuer: str | None = None
    blocked: str | None = None  # 관리자 정책에 막힌 사용자 서버 (user_servers_disabled · url_not_allowed)

    @property
    def issuer_domain(self) -> str | None:
        return domain_of(self.issuer) if self.issuer else None

    @property
    def usable(self) -> bool:
        """대화에서 꺼낼 수 있는 앱 (연결은 아직 없어도 된다 → use_app 이 인증 흐름으로)."""
        return self.status == "active" and not self.hidden and not self.share_lost and not self.blocked

    @property
    def ready(self) -> bool:
        return self.connection in ("none", "connected")


@dataclass(frozen=True)
class Importable:
    server_id: str
    name: str
    url: str
    domain: str
    description: str
    auth: Literal["oauth", "none"]
    tool_count: int | None
    owner_name: str | None
    via: tuple[dict[str, Any], ...]  # [{scope_kind, scope_id, path: [{kind, id, name}]}] — 화면 Breadcrumb
    issuer_domain: str | None = None  # 로그인 화면이 열릴 곳 (서버 도메인과 다르면 화면에 '로그인 …')


@dataclass
class Memberships:
    org_roles: dict[str, str] = field(default_factory=dict)  # org_id → 내 역할
    spaces: dict[str, SpaceFacts] = field(default_factory=dict)  # 내가 실효 멤버인 shared 스페이스


class _Reads:
    """읽기 (내 목록 · 가져올 수 있는 앱 · 판정용 사실)."""

    def __init__(self, store: Store) -> None:
        self.store = store

    # ── 사실 모으기 ──
    def memberships(self, user_id: str) -> Memberships:
        m = Memberships()
        actor = Actor(user_id)
        with self.store.read() as db:
            for r in db.execute("SELECT org_id, role FROM org_members WHERE user_id = ?", (user_id,)):
                m.org_roles[r["org_id"]] = r["role"]
            rows = db.execute(
                "SELECT s.*, (SELECT role FROM space_members WHERE space_id = s.id AND user_id = ?) AS direct_role,"
                " (SELECT role FROM org_members WHERE org_id = s.org_id AND user_id = ?) AS org_role FROM spaces s"
                " WHERE s.kind = 'shared' AND s.org_id IN (SELECT org_id FROM org_members WHERE user_id = ?)",
                (user_id, user_id, user_id),
            ).fetchall()
        for r in rows:
            facts = SpaceFacts(
                id=r["id"], org_id=r["org_id"], kind=r["kind"], owner_user_id=r["owner_user_id"], visibility=r["visibility"],
                archived=r["archived_at"] is not None, direct_role=r["direct_role"], org_role=r["org_role"],
            )
            if policy.space_role(actor, facts) is not None:
                m.spaces[r["id"]] = facts
        return m

    @staticmethod
    def share_facts(row: sqlite3.Row | dict[str, Any], m: Memberships) -> McpShareFacts:
        kind, sid = row["scope_kind"], row["scope_id"]
        return McpShareFacts(
            scope_kind=kind, scope_id=sid, auto_include=bool(row["auto_include"]),
            space=m.spaces.get(sid) if kind == "space" else None, org_role=m.org_roles.get(sid) if kind == "org" else None,  # type: ignore[arg-type]
        )

    def server_facts(self, server_id: str, user_id: str, m: Memberships | None = None) -> tuple[sqlite3.Row, McpServerFacts] | None:
        """권한 판정용 (guard 처럼: id → 사실). 없는 서버 = None."""
        rows = self.store.query("SELECT * FROM mcp_servers WHERE id = ?", (server_id,))
        if not rows:
            return None
        m = m or self.memberships(user_id)
        shares = self.store.query("SELECT * FROM mcp_server_shares WHERE server_id = ?", (server_id,))
        mine = self.store.query("SELECT * FROM mcp_user_servers WHERE user_id = ? AND server_id = ?", (user_id, server_id))
        return rows[0], self._facts(rows[0], shares, mine[0] if mine else None, m, self.settings())

    def _facts(self, s: sqlite3.Row, shares: Iterable[sqlite3.Row], mine: sqlite3.Row | None, m: Memberships,
               pol: dict[str, Any] | None = None) -> McpServerFacts:
        return McpServerFacts(
            id=s["id"], origin=s["origin"], owner_user_id=s["owner_user_id"], status=s["status"],
            shares=tuple(self.share_facts(sh, m) for sh in shares),
            imported=mine is not None and mine["source"] == "imported", hidden=mine is not None and mine["state"] == "hidden",
            blocked=self.blocked(s, pol) if pol is not None else None,
        )

    @staticmethod
    def blocked(s: sqlite3.Row | dict[str, Any], pol: dict[str, Any]) -> str | None:
        """사용자 서버 + 지금의 관리자 정책 → 막힌 이유 (관리자 서버는 늘 None)."""
        if s["origin"] != "user":
            return None
        if not pol["allow_user_servers"]:
            return "user_servers_disabled"
        if not ssrf.host_allowed(s["url"], pol["url_allowlist"]):
            return "url_not_allowed"
        return None

    def _connections(self, user_id: str) -> dict[str, str]:
        return {r["resource"]: r["status"] for r in self.store.query("SELECT resource, status FROM mcp_credentials WHERE user_id = ?", (user_id,))}

    # ── 내 목록 ──
    def apps(self, user_id: str) -> list[App]:
        """설정 › 연결된 앱 = 숨김 · 공유 끊김까지 전부. 대화 = usable(). 정렬 = handle (고정)."""
        m = self.memberships(user_id)
        actor = Actor(user_id)
        pol = self.settings()
        with self.store.read() as db:
            servers = db.execute("SELECT * FROM mcp_servers ORDER BY created_at, id").fetchall()
            share_rows = db.execute("SELECT * FROM mcp_server_shares").fetchall()
            mine = {r["server_id"]: r for r in db.execute("SELECT * FROM mcp_user_servers WHERE user_id = ?", (user_id,))}
        by_server: dict[str, list[sqlite3.Row]] = {}
        for sh in share_rows:
            by_server.setdefault(sh["server_id"], []).append(sh)
        conns = self._connections(user_id)
        picked: list[tuple[int, sqlite3.Row, McpServerFacts, Source, bool]] = []
        for s in servers:
            row = mine.get(s["id"])
            facts = self._facts(s, by_server.get(s["id"], ()), row, m, pol)
            if policy.mcp_is_owner(actor, facts):
                picked.append((1, s, facts, "own", False))
            elif policy.mcp_auto(actor, facts):
                picked.append((0, s, facts, "install", False))
            elif facts.imported:
                picked.append((2, s, facts, "imported", not policy.mcp_importable(actor, facts)))
        out: list[App] = []
        used: set[str] = {r["handle"] for r in mine.values() if r["handle"]}  # 적어 둔 handle 은 그 서버 몫 (지금 안 보이는 줄도)
        fresh: dict[str, tuple[str, Source]] = {}
        for _, s, facts, source, lost in sorted(picked, key=lambda p: (p[0], p[1]["created_at"], p[1]["id"])):
            row = mine.get(s["id"])
            if row is not None and row["handle"]:
                handle = row["handle"]
            else:
                handle = self._unique(s["handle"], used)
                used.add(handle)
                fresh[s["id"]] = (handle, source)
            if s["auth"] == "none":
                conn: Connection = "none"
            else:
                st = conns.get(s["resource"])
                conn = "connected" if st == "active" else "expired" if st in ("expired", "revoked") else "needs_login"
            out.append(App(
                server_id=s["id"], handle=handle, name=s["name"], url=s["url"], resource=s["resource"], domain=domain_of(s["url"]),
                description=s["description"], aliases=tuple(_json_list(s["aliases"])), auth=s["auth"], origin=s["origin"],
                source=source, status=s["status"], connection=conn, hidden=facts.hidden, share_lost=lost,
                tool_count=s["tool_count"], tool_tokens_est=s["tool_tokens_est"], owner_user_id=s["owner_user_id"],
                last_used_at=row["last_used_at"] if row is not None else None, issuer=s["issuer"], blocked=facts.blocked,
            ))
        if fresh:
            self._pin_handles(user_id, fresh)
        return sorted(out, key=lambda a: a.handle)

    def _pin_handles(self, user_id: str, fresh: dict[str, tuple[str, Source]]) -> None:
        """처음 정한 handle 을 내 줄에 적는다 (이미 적힌 줄은 그대로 · 동시에 다른 요청이 먼저 적었으면 그 값)."""
        at = now_iso()
        for server_id, (handle, source) in fresh.items():
            try:
                with self.store.tx() as db:
                    db.execute(
                        "INSERT INTO mcp_user_servers (user_id, server_id, handle, source, created_at) VALUES (?, ?, ?, ?, ?)"
                        " ON CONFLICT (user_id, server_id) DO UPDATE SET handle = excluded.handle WHERE mcp_user_servers.handle IS NULL",
                        (user_id, server_id, handle, source, at),
                    )
            except sqlite3.IntegrityError:
                continue  # 같은 handle 을 다른 줄이 먼저 가져갔다 → 다음 목록에서 다시 정한다

    @staticmethod
    def _unique(handle: str, used: set[str]) -> str:
        if handle not in used:
            return handle
        n = 2
        while True:
            suffix = f"_{n}"
            candidate = handle[: HANDLE_MAX - len(suffix)].rstrip("_") + suffix
            if candidate not in used:
                return candidate
            n += 1

    def usable(self, user_id: str) -> list[App]:
        return [a for a in self.apps(user_id) if a.usable]

    def find(self, user_id: str, app: str) -> App | None:
        """use_app(app) — handle · 이름 · 도메인 (대소문자 무시). 쓸 수 있는 앱 중에서만."""
        key = (app or "").strip().lower()
        if not key:
            return None
        apps = self.usable(user_id)
        for test in (lambda a: a.handle == key, lambda a: a.name.lower() == key, lambda a: a.domain == key or a.domain.split(".")[0] == key):
            hit = next((a for a in apps if test(a)), None)
            if hit:
                return hit
        return None

    def touch(self, user_id: str, server_id: str, source: Source) -> None:
        """최근 쓴 앱 (프롬프트 목록이 넘칠 때 먼저). 공통 서버는 그때 줄이 생긴다 (source install)."""
        at = now_iso()
        with self.store.tx() as db:
            db.execute(
                "INSERT INTO mcp_user_servers (user_id, server_id, source, last_used_at, created_at) VALUES (?, ?, ?, ?, ?)"
                " ON CONFLICT (user_id, server_id) DO UPDATE SET last_used_at = excluded.last_used_at",
                (user_id, server_id, source, at, at),
            )

    # ── 가져올 수 있는 앱 ──
    def importable(self, user_id: str) -> list[Importable]:
        """내 조직 · 스페이스에 공유됐지만 아직 안 가져온 서버 (auto_include 아님 · 내 것 아님 · 켜짐)."""
        m = self.memberships(user_id)
        actor = Actor(user_id)
        with self.store.read() as db:
            servers = db.execute(
                "SELECT s.*, u.display_name AS owner_name FROM mcp_servers s LEFT JOIN users u ON u.id = s.owner_user_id"
                " WHERE s.status = 'active' AND EXISTS (SELECT 1 FROM mcp_server_shares sh WHERE sh.server_id = s.id AND sh.auto_include = 0)"
                " ORDER BY lower(s.name), s.id"
            ).fetchall()
            shares = db.execute("SELECT * FROM mcp_server_shares WHERE auto_include = 0").fetchall()
            mine = {r["server_id"]: r for r in db.execute("SELECT * FROM mcp_user_servers WHERE user_id = ?", (user_id,))}
        by_server: dict[str, list[sqlite3.Row]] = {}
        for sh in shares:
            by_server.setdefault(sh["server_id"], []).append(sh)
        found: list[tuple[sqlite3.Row, list[McpShareFacts]]] = []
        for s in servers:
            facts = self._facts(s, by_server.get(s["id"], ()), mine.get(s["id"]), m)
            if facts.imported or not policy.mcp_importable(actor, facts):
                continue
            via = [sh for sh in facts.shares if not sh.auto_include and policy.mcp_in_scope(actor, sh)]
            found.append((s, via))
        paths: dict[str, dict[str, list[scopes.Crumb]]] = {}
        sc = scopes.Scopes(self.store)
        for kind in (k for k in SHARE_KINDS if k != scopes.INSTALL):  # 층 공유 (설치본 전체는 경로 없음)
            ids = [v.scope_id for _, via in found for v in via if v.scope_kind == kind]
            paths[kind] = sc.paths(kind, ids)
        return [
            Importable(
                server_id=s["id"], name=s["name"], url=s["url"], domain=domain_of(s["url"]), description=s["description"],
                auth=s["auth"], tool_count=s["tool_count"], owner_name=s["owner_name"],
                issuer_domain=domain_of(s["issuer"]) if s["issuer"] else None,
                via=tuple({"scope_kind": v.scope_kind, "scope_id": v.scope_id, "path": paths.get(v.scope_kind, {}).get(v.scope_id, [])} for v in via),
            )
            for s, via in found
        ]

    def importable_match(self, user_id: str, app: str) -> Importable | None:
        """카드 D: 에이전트가 찾은 앱이 아직 안 가져온 공유 앱인가."""
        key = (app or "").strip().lower()
        return next((i for i in self.importable(user_id) if key and (i.name.lower() == key or i.domain.split(".")[0] == key)), None)


# ── 쓰기 (판정은 부르는 쪽이 먼저 policy.require_mcp_* · 여기는 DB 만) ─────────────────────────


class _Writes:
    """쓰기 (정의 · 공유 · 가져오기 · 숨기기 · 도구 정책 · 관리자 정책 · 자동 인증 알림)."""

    store: Store

    def add_server(
        self, *, name: str, url: str, origin: Literal["admin", "user"], owner_user_id: str | None, handle: str | None = None,
        description: str = "", aliases: Iterable[str] = (), auth: Literal["oauth", "none"] = "none", resource: str | None = None,
        issuer: str | None = None, install: bool = True,
    ) -> str:
        """url = ssrf.canonical_url 을 통과한 값. 관리자 서버 + install = 전체 공통(install 공유 · auto_include). 사용자 = 내 목록(own).
        같은 주인 · 같은 주소 = StoreConflict('server_exists') · handle 모양이 틀리면 StoreConflict('bad_handle')."""
        h = handle or make_handle(name, url)
        if not valid_handle(h):
            raise StoreConflict("bad_handle")
        at = now_iso()
        server_id = str(uuid.uuid4())
        with self.store.tx() as db:
            if db.execute("SELECT 1 FROM mcp_servers WHERE url = ? AND owner_user_id IS ?", (url, owner_user_id)).fetchone():
                raise StoreConflict("server_exists")
            if origin == "admin":
                taken = {r[0] for r in db.execute("SELECT handle FROM mcp_servers WHERE origin = 'admin'")}
                h = _Reads._unique(h, taken)
            db.execute(
                "INSERT INTO mcp_servers (id, handle, name, url, resource, origin, owner_user_id, description, aliases, auth, issuer, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (server_id, h, clean_name(name) or h, url, resource or url, origin, owner_user_id, clean_description(description),
                 json.dumps(clean_aliases(aliases), ensure_ascii=False), auth, issuer, at, at),
            )
            if origin == "admin" and install:
                db.execute(
                    "INSERT INTO mcp_server_shares (server_id, scope_kind, scope_id, auto_include, shared_by, created_at) VALUES (?, ?, '*', 1, NULL, ?)",
                    (server_id, scopes.INSTALL, at),
                )
            if origin == "user" and owner_user_id:
                db.execute(
                    "INSERT INTO mcp_user_servers (user_id, server_id, state, source, created_at) VALUES (?, ?, 'added', 'own', ?)",
                    (owner_user_id, server_id, at),
                )
        return server_id

    def server(self, server_id: str) -> sqlite3.Row | None:
        rows = self.store.query("SELECT * FROM mcp_servers WHERE id = ?", (server_id,))
        return rows[0] if rows else None

    def update_server(self, server_id: str, changes: dict[str, Any]) -> None:
        """name · description · aliases · status · handle(관리자 서버) · auth · resource · issuer. url 은 못 바꾼다."""
        sets: dict[str, Any] = {}
        if "name" in changes:
            sets["name"] = clean_name(changes["name"])
        if "description" in changes:
            sets["description"] = clean_description(changes["description"])
        if "aliases" in changes:
            sets["aliases"] = json.dumps(clean_aliases(changes["aliases"]), ensure_ascii=False)
        if "handle" in changes:
            if not valid_handle(changes["handle"]):
                raise StoreConflict("bad_handle")
            sets["handle"] = changes["handle"]
        for k in ("status", "auth", "resource", "issuer", "last_error"):
            if k in changes:
                sets[k] = changes[k]
        if not sets:
            return
        sets["updated_at"] = now_iso()
        try:
            with self.store.tx() as db:
                db.execute(f"UPDATE mcp_servers SET {', '.join(f'{k} = ?' for k in sets)} WHERE id = ?", (*sets.values(), server_id))
        except sqlite3.IntegrityError:
            raise StoreConflict("handle_taken") from None

    def delete_server(self, server_id: str) -> bool:
        """정의 · 공유 · 내 목록 줄 · 도구 정책 · 캐시가 같이 지워진다 (FK CASCADE). 사람들의 인증정보(resource)는 남는다 — 다른 항목이 같은 주소를 쓸 수 있다."""
        with self.store.tx() as db:
            return db.execute("DELETE FROM mcp_servers WHERE id = ?", (server_id,)).rowcount > 0

    def shares(self, server_id: str) -> list[sqlite3.Row]:
        return self.store.query("SELECT * FROM mcp_server_shares WHERE server_id = ? ORDER BY created_at", (server_id,))

    def share(self, server_id: str, scope_kind: str, scope_id: str, *, shared_by: str | None, auto_include: bool = False) -> None:
        if scope_kind not in SHARE_KINDS:
            raise StoreConflict("bad_scope")
        with self.store.tx() as db:
            db.execute(
                "INSERT INTO mcp_server_shares (server_id, scope_kind, scope_id, auto_include, shared_by, created_at) VALUES (?, ?, ?, ?, ?, ?)"
                " ON CONFLICT (server_id, scope_kind, scope_id) DO UPDATE SET auto_include = excluded.auto_include",
                (server_id, scope_kind, scope_id, int(auto_include), shared_by, now_iso()),
            )

    def unshare(self, server_id: str, scope_kind: str, scope_id: str) -> bool:
        """공유를 끊으면 그 범위로 가져온 사람들은 목록에서 '공유가 끊겼어요' (줄은 남는다 · 다른 범위로도 공유돼 있으면 그대로)."""
        with self.store.tx() as db:
            return db.execute(
                "DELETE FROM mcp_server_shares WHERE server_id = ? AND scope_kind = ? AND scope_id = ?", (server_id, scope_kind, scope_id)
            ).rowcount > 0

    def import_server(self, user_id: str, server_id: str, *, handle: str | None = None) -> None:
        if handle is not None and not valid_handle(handle):
            raise StoreConflict("bad_handle")
        try:
            with self.store.tx() as db:
                db.execute(
                    "INSERT INTO mcp_user_servers (user_id, server_id, handle, state, source, created_at) VALUES (?, ?, ?, 'added', 'imported', ?)"
                    " ON CONFLICT (user_id, server_id) DO UPDATE SET source = 'imported', state = 'added', handle = COALESCE(excluded.handle, handle)",
                    (user_id, server_id, handle, now_iso()),
                )
        except sqlite3.IntegrityError:
            raise StoreConflict("handle_taken") from None

    def remove_from_list(self, user_id: str, server_id: str) -> bool:
        """가져온 앱 [빼기] = 내 줄만 지운다 (정의 · 남의 줄은 그대로)."""
        with self.store.tx() as db:
            return db.execute(
                "DELETE FROM mcp_user_servers WHERE user_id = ? AND server_id = ? AND source = 'imported'", (user_id, server_id)
            ).rowcount > 0

    def set_hidden(self, user_id: str, server_id: str, hidden: bool, *, source: Source = "install") -> None:
        """전체 공통 [숨기기] · 다시 보이기 (줄이 없으면 source install 로 만든다)."""
        with self.store.tx() as db:
            db.execute(
                "INSERT INTO mcp_user_servers (user_id, server_id, state, source, created_at) VALUES (?, ?, ?, ?, ?)"
                " ON CONFLICT (user_id, server_id) DO UPDATE SET state = excluded.state",
                (user_id, server_id, "hidden" if hidden else "added", source, now_iso()),
            )

    def set_my_handle(self, user_id: str, server_id: str, handle: str | None, *, source: Source = "install") -> None:
        if handle is not None and not valid_handle(handle):
            raise StoreConflict("bad_handle")
        try:
            with self.store.tx() as db:
                db.execute(
                    "INSERT INTO mcp_user_servers (user_id, server_id, handle, source, created_at) VALUES (?, ?, ?, ?, ?)"
                    " ON CONFLICT (user_id, server_id) DO UPDATE SET handle = excluded.handle",
                    (user_id, server_id, handle, source, now_iso()),
                )
        except sqlite3.IntegrityError:
            raise StoreConflict("handle_taken") from None

    # ── 도구 정책 (관리자) ──
    def tool_policy(self, server_id: str) -> dict[str, dict[str, Any]]:
        return {
            r["tool"]: {"mode": r["mode"], "always_reveal": bool(r["always_reveal"]), "aliases": _json_list(r["aliases"])}
            for r in self.store.query("SELECT * FROM mcp_tool_policy WHERE server_id = ?", (server_id,))
        }

    def set_tool_policy(self, server_id: str, tool: str, *, mode: str | None = None, always_reveal: bool | None = None,
                        aliases: Iterable[str] | None = None) -> None:
        if mode is not None and mode not in TOOL_MODES:
            raise StoreConflict("bad_mode")
        current = self.tool_policy(server_id).get(tool, {"mode": "auto", "always_reveal": False, "aliases": []})
        row = (
            server_id, tool, mode or current["mode"], int(current["always_reveal"] if always_reveal is None else always_reveal),
            json.dumps(clean_aliases(current["aliases"] if aliases is None else aliases), ensure_ascii=False), now_iso(),
        )
        with self.store.tx() as db:
            db.execute(
                "INSERT INTO mcp_tool_policy (server_id, tool, mode, always_reveal, aliases, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
                " ON CONFLICT (server_id, tool) DO UPDATE SET mode = excluded.mode, always_reveal = excluded.always_reveal,"
                " aliases = excluded.aliases, updated_at = excluded.updated_at",
                row,
            )

    def connected_count(self, resource: str) -> int:
        """관리자 표 '연결한 사람 수' (인증정보는 개수만)."""
        return self.store.query("SELECT COUNT(*) AS n FROM mcp_credentials WHERE resource = ? AND status = 'active'", (resource,))[0]["n"]

    # ── 설정 ──
    def settings(self) -> dict[str, Any]:
        """관리자 정책 (meta): 사용자 추가 허용(기본 켜짐) · 주소 허용 목록(빈 = 모두)."""
        allow = self.store.get_meta(META_ALLOW_USER)
        return {"allow_user_servers": allow != "0", "url_allowlist": _json_list(self.store.get_meta(META_ALLOWLIST))}

    def set_settings(self, *, allow_user_servers: bool | None = None, url_allowlist: Iterable[str] | None = None) -> None:
        with self.store.tx() as db:
            if allow_user_servers is not None:
                Store.set_meta(db, META_ALLOW_USER, "1" if allow_user_servers else "0")
            if url_allowlist is not None:
                pats = [p.strip().lower() for p in url_allowlist if p and p.strip()][:100]
                Store.set_meta(db, META_ALLOWLIST, json.dumps(pats))

    def auto_auth(self, user_id: str) -> str:
        rows = self.store.query("SELECT mcp_auto_auth FROM users WHERE id = ?", (user_id,))
        return rows[0]["mcp_auto_auth"] if rows else "unset"

    def set_auto_auth(self, user_id: str, value: str) -> None:
        if value not in AUTO_AUTH:
            raise StoreConflict("bad_value")
        with self.store.tx() as db:
            db.execute("UPDATE users SET mcp_auto_auth = ? WHERE id = ?", (value, user_id))


class Catalog(_Reads, _Writes):
    """MCP 서버 목록 한 곳 (store 하나). API · 에이전트 · 관리자 콘솔이 같이 쓴다."""


def _json_list(raw: str | None) -> list[str]:
    try:
        v = json.loads(raw or "[]")
    except ValueError:
        return []
    return [str(x) for x in v] if isinstance(v, list) else []


# ── 프롬프트 블록 ─────────────────────────────────────────────────────────────────


def app_line(a: App, *, compact: bool = False) -> str:
    state = CONNECTION_LABEL[a.connection]
    name = clean_name(a.name)
    if compact:
        return f"- {a.handle} ({name}) [{state}]"
    desc = clean_description(a.description)
    return f"- {a.handle} ({name}): {desc} [{state}]" if desc else f"- {a.handle} ({name}) [{state}]"


def prompt_block(apps: Iterable[App], *, budget: int = PROMPT_BUDGET) -> str:
    """대화 요청에 싣는 앱 목록 (지침 뒤 · 순서 고정 = 프롬프트 캐시). 쓸 수 있는 앱만. 0개 = ''."""
    live = sorted((a for a in apps if a.usable), key=lambda a: a.handle)
    if not live:
        return ""
    full = [app_line(a) for a in live]
    if sum(estimate_tokens(line) + 1 for line in full) <= budget:
        return "\n".join(full)
    # 넘침: 이름만 · 연결된 것 · 최근 쓴 것 먼저 (같으면 handle)
    ordered = sorted(live, key=lambda a: a.handle)
    ordered.sort(key=lambda a: a.last_used_at or "", reverse=True)  # 안정 정렬 세 번 = (연결됨, 최근 쓴 순, handle)
    ordered.sort(key=lambda a: not a.ready)
    tail = lambda n: f"- … 외 {n}개 (이름으로 use_app 을 부르면 찾아요)"  # noqa: E731
    reserve = estimate_tokens(tail(len(ordered))) + 1
    lines: list[str] = []
    used = 0
    for i, a in enumerate(ordered):
        line = app_line(a, compact=True)
        cost = estimate_tokens(line) + 1
        last = i == len(ordered) - 1
        if used + cost > (budget if last else budget - reserve):
            lines.append(tail(len(ordered) - i))
            break
        lines.append(line)
        used += cost
    return "\n".join(lines)

