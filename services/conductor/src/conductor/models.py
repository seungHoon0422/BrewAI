"""모델 노출 관리 (ADR-0006 model_exposure). 모델 등록은 LiteLLM 에서만 — 여기는 노출 · 표시 이름 · 순서 · 기본 모델만.

동기화 규칙 (게이트웨이 `/model_group/info` → model_exposure)
  새 모델        = 후보 (숨김). 관리자가 한 번이라도 손대면 후보 딱지가 떨어진다 (reviewed)
  사라진 모델    = missing + 자동 숨김 + 기본 해제. 돌아와도 숨김 그대로 (관리자가 다시 켠다)
  첫 동기화      = bootstrap 모델(기본 brewai-mock: 키 없이 답함)만 노출 + 기본 → 새 PC 에서 바로 대화가 된다
  기본 모델      = is_default 인 노출 모델. 없으면 노출 순서 첫 모델이 기본 (API 의 is_default 는 이 '실제' 기본)
  순서           = 전체 순서 하나 (sort_order · 제공사로 묶지 않는다). 관리자 표 1 … N = 사용자 앱 모델 메뉴 순서 그대로.
                   기본 모델은 표시(is_default)만 하고 맨 위로 끌어올리지 않는다 (ADR-0006)
"""

from __future__ import annotations

import json
import sqlite3
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from .gateway import GatewayCatalogPort, GatewayModel
from .providers import PROVIDER_ORDER, pretty_name, provider_label, provider_of, providers_of
from .store import Store, now_iso

State = Literal["exposed", "candidate", "hidden", "missing"]
MAX_DISPLAY_NAME = 60
ORDER_META = "model_order"  # 'global' = 전체 순서 하나로 굳힘 (_migrate_order)


class ModelPatchError(Exception):
    def __init__(self, status: int, code: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code


@dataclass(frozen=True)
class ExposureRow:
    gateway_id: str
    display_name: str | None  # 관리자가 정한 이름 (없으면 default_label)
    default_label: str  # 게이트웨이 id 로 만든 이름 (예: claude-sonnet-5-5 → Claude Sonnet 5.5)
    family: str | None
    provider: str
    providers: tuple[str, ...]  # 정규화 · 중복 없음 (첫 항목 = provider)
    sort_order: int
    exposed: bool
    stored_default: bool
    status: Literal["present", "missing"]
    reviewed: bool
    info: dict[str, Any]  # 게이트웨이 값 스냅샷 (읽기 전용: 컨텍스트 · 가격 · 기능)
    first_seen: str
    last_seen: str

    @property
    def label(self) -> str:
        return self.display_name or self.default_label

    @property
    def is_chat(self) -> bool:
        return self.info.get("mode") in (None, "chat")

    @property
    def state(self) -> State:
        if self.status == "missing":
            return "missing"
        if self.exposed:
            return "exposed"
        return "candidate" if self.is_chat and not self.reviewed else "hidden"

    @property
    def provider_label(self) -> str:
        return provider_label(self.provider)


@dataclass(frozen=True)
class ModelChoice:
    """채팅 한 번에 필요한 것 (agent.py 로 넘긴다)."""

    id: str
    label: str
    provider: str
    provider_label: str
    supports_reasoning: bool
    supports_tools: bool
    max_output_tokens: int | None


@dataclass(frozen=True)
class SyncResult:
    added: list[str]
    missing: list[str]
    restored: list[str]
    first_sync: bool
    synced_at: str


def _row(r: sqlite3.Row) -> ExposureRow:
    info = json.loads(r["gateway_info"] or "{}")
    raw = [str(p) for p in info.get("providers") or ()]
    label, family = pretty_name(r["gateway_id"])
    return ExposureRow(
        gateway_id=r["gateway_id"],
        display_name=r["display_name"],
        default_label=label,
        family=family,
        provider=provider_of(r["gateway_id"], raw),
        providers=tuple(providers_of(r["gateway_id"], raw)),
        sort_order=r["sort_order"],
        exposed=bool(r["exposed"]),
        stored_default=bool(r["is_default"]),
        status=r["status"],
        reviewed=bool(r["reviewed"]),
        info=info,
        first_seen=r["first_seen"],
        last_seen=r["last_seen"],
    )


def _clean_name(value: str) -> str | None:
    name = " ".join(value.split())  # 앞뒤·중복 공백 정리
    if not name:
        return None  # 빈 이름 = 기본 이름으로 되돌림
    if len(name) > MAX_DISPLAY_NAME or any(unicodedata.category(c) in ("Cc", "Cf", "Co", "Cs") for c in name):
        raise ModelPatchError(422, "bad_display_name")
    return name


class ModelRegistry:
    def __init__(
        self, store: Store, catalog: GatewayCatalogPort, *, bootstrap: Sequence[str] = (), default_model: str | None = None
    ) -> None:
        self._store = store
        self._catalog = catalog
        self._bootstrap = tuple(dict.fromkeys([*([default_model] if default_model else []), *bootstrap]))
        self._default_model = default_model
        self._last: list[GatewayModel] | None = None
        self._migrate_order()

    def _migrate_order(self) -> None:
        """한 번만: 예전 관리자 표(처음 나온 제공사끼리 모은 순서)를 전체 순서 1 … N 으로 굳힌다 → 관리자가 보던 순서 그대로.
        게이트웨이에 있는 줄 = (제공사가 처음 나온 순서, sort_order) · 사라진 줄 = 그 뒤 (sort_order). 새 DB 는 표시만 남긴다."""
        if self._store.get_meta(ORDER_META) == "global":
            return
        with self._store.tx() as db:
            rows = [
                _row(r) for r in db.execute("SELECT * FROM model_exposure ORDER BY status = 'missing', sort_order, gateway_id")
            ]
            rank: dict[str, int] = {}
            for r in rows:
                if r.status == "present":
                    rank.setdefault(r.provider, len(rank))
            present = [(i, r) for i, r in enumerate(rows) if r.status == "present"]
            ordered = [r for _, r in sorted(present, key=lambda x: (rank[x[1].provider], x[0]))]
            ordered += [r for r in rows if r.status != "present"]
            db.executemany(
                "UPDATE model_exposure SET sort_order = ? WHERE gateway_id = ?",
                [(i, r.gateway_id) for i, r in enumerate(ordered, 1)],
            )
            Store.set_meta(db, ORDER_META, "global")

    async def refresh(self, *, fresh: bool = False) -> SyncResult | None:
        """카탈로그를 읽고 바뀌었으면 동기화. 캐시(30초)가 같은 목록을 주면 DB 를 건드리지 않는다."""
        models = await self._catalog.list_models(fresh=fresh)
        if not fresh and models is self._last:
            return None
        result = self.sync(models)
        self._last = models
        return result

    def sync(self, models: Sequence[GatewayModel]) -> SyncResult:
        at = now_iso()
        added: list[str] = []
        missing: list[str] = []
        restored: list[str] = []
        unique = list({m.id: m for m in models}.values())  # 같은 id 가 두 번 와도 한 줄
        with self._store.tx() as db:
            first = db.execute("SELECT value FROM meta WHERE key = 'first_sync_at'").fetchone() is None
            existing = {r["gateway_id"]: r for r in db.execute("SELECT gateway_id, status FROM model_exposure")}
            next_order = (db.execute("SELECT COALESCE(MAX(sort_order), 0) FROM model_exposure").fetchone()[0]) + 1
            for m in unique:
                info = json.dumps(m.row(), ensure_ascii=False)
                if m.id in existing:
                    if existing[m.id]["status"] == "missing":
                        restored.append(m.id)
                    db.execute(
                        "UPDATE model_exposure SET gateway_info = ?, status = 'present', last_seen = ? WHERE gateway_id = ?",
                        (info, at, m.id),
                    )
                else:
                    db.execute(
                        "INSERT INTO model_exposure (gateway_id, sort_order, gateway_info, first_seen, last_seen)"
                        " VALUES (?, ?, ?, ?, ?)",
                        (m.id, next_order, info, at, at),
                    )
                    next_order += 1
                    added.append(m.id)
            present = {m.id for m in unique}
            for gid, r in existing.items():
                if gid not in present and r["status"] == "present":
                    db.execute(
                        "UPDATE model_exposure SET status = 'missing', exposed = 0, is_default = 0 WHERE gateway_id = ?", (gid,)
                    )
                    missing.append(gid)
            if first:
                chat = {m.id for m in unique if m.is_chat}
                picked = [gid for gid in self._bootstrap if gid in chat]
                for gid in picked:
                    db.execute("UPDATE model_exposure SET exposed = 1, reviewed = 1 WHERE gateway_id = ?", (gid,))
                if picked:
                    db.execute("UPDATE model_exposure SET is_default = 1 WHERE gateway_id = ?", (picked[0],))
                Store.set_meta(db, "first_sync_at", at)
            Store.set_meta(db, "last_sync_at", at)
        return SyncResult(added=added, missing=missing, restored=restored, first_sync=first, synced_at=at)

    # ── 읽기 ──
    def rows(self) -> list[ExposureRow]:
        """관리자 표 순서: 게이트웨이에 있는 모델(순서대로) → 사라진 모델."""
        rows = [
            _row(r)
            for r in self._store.query(
                "SELECT * FROM model_exposure ORDER BY status = 'missing', sort_order, gateway_id"
            )
        ]
        return rows

    def default_id(self, rows: Sequence[ExposureRow] | None = None) -> str | None:
        shown = [r for r in (rows if rows is not None else self.rows()) if r.state == "exposed" and r.is_chat]
        explicit = next((r.gateway_id for r in shown if r.stored_default), None)
        return explicit or (shown[0].gateway_id if shown else None)

    def exposed(self) -> list[ExposureRow]:
        """데스크톱 목록: 노출 · 채팅 모델만, 관리자 순서 그대로 (기본 모델도 제자리 · 표시는 is_default)."""
        return [r for r in self.rows() if r.state == "exposed" and r.is_chat]

    def choice(self, gateway_id: str) -> ModelChoice:
        r = next(r for r in self.exposed() if r.gateway_id == gateway_id)
        return ModelChoice(
            id=r.gateway_id,
            label=r.label,
            provider=r.provider,
            provider_label=r.provider_label,
            supports_reasoning=bool(r.info.get("supports_reasoning")),
            supports_tools=bool(r.info.get("supports_function_calling")),
            max_output_tokens=r.info.get("max_output_tokens"),
        )

    def resolve(self, requested: str | None) -> ModelChoice | None:
        """요청한 모델 → 노출된 모델. None = 기본. 없거나 숨김이면 None (숨긴 모델이 있는지도 알려 주지 않는다)."""
        shown = self.exposed()
        if requested is None:
            default = self.default_id()
            return self.choice(default) if default else None
        return self.choice(requested) if any(r.gateway_id == requested for r in shown) else None

    def providers(self) -> list[dict[str, Any]]:
        groups: dict[str, dict[str, Any]] = {}
        for r in self.rows():
            g = groups.setdefault(
                r.provider,
                {"id": r.provider, "label": r.provider_label, "total": 0, "exposed": 0, "candidates": 0, "missing": 0},
            )
            g["total"] += 1
            g["exposed"] += r.state == "exposed"
            g["candidates"] += r.state == "candidate"
            g["missing"] += r.state == "missing"
        return sorted(groups.values(), key=lambda g: PROVIDER_ORDER.get(g["id"], len(PROVIDER_ORDER)))

    # ── 쓰기 (관리자) ──
    def patch(self, gateway_id: str, changes: dict[str, Any]) -> ExposureRow:
        """changes 키: exposed(bool) · display_name(str|None) · order(int ≥1, 전체 표 기준 위치) · is_default(bool)."""
        with self._store.tx() as db:
            raw = db.execute("SELECT * FROM model_exposure WHERE gateway_id = ?", (gateway_id,)).fetchone()
            if raw is None:
                raise ModelPatchError(404, "model_not_found")
            row = _row(raw)
            exposed = changes.get("exposed", row.exposed)
            if "exposed" in changes and changes["exposed"] and not row.exposed:
                if row.status == "missing":
                    raise ModelPatchError(409, "model_missing")
                if not row.is_chat:
                    raise ModelPatchError(409, "not_chat_model")
            if changes.get("is_default") and not exposed:
                raise ModelPatchError(409, "default_requires_exposed")
            sets: dict[str, Any] = {"reviewed": 1}
            if "display_name" in changes:
                value = changes["display_name"]
                sets["display_name"] = None if value is None else _clean_name(value)
            if "exposed" in changes:
                sets["exposed"] = int(bool(exposed))
                if not exposed:
                    sets["is_default"] = 0
            if "is_default" in changes:
                if changes["is_default"]:
                    db.execute("UPDATE model_exposure SET is_default = 0 WHERE is_default = 1 AND gateway_id != ?", (gateway_id,))
                    sets["is_default"] = 1
                elif "is_default" not in sets:
                    sets["is_default"] = 0
            db.execute(
                f"UPDATE model_exposure SET {', '.join(f'{k} = ?' for k in sets)} WHERE gateway_id = ?",  # 키는 위 고정 목록
                (*sets.values(), gateway_id),
            )
            if "order" in changes:
                ids = [
                    r["gateway_id"]
                    for r in db.execute("SELECT gateway_id FROM model_exposure ORDER BY status = 'missing', sort_order, gateway_id")
                ]
                ids.remove(gateway_id)
                ids.insert(min(max(int(changes["order"]), 1), len(ids) + 1) - 1, gateway_id)
                db.executemany(
                    "UPDATE model_exposure SET sort_order = ? WHERE gateway_id = ?", [(i, gid) for i, gid in enumerate(ids, 1)]
                )
            return _row(db.execute("SELECT * FROM model_exposure WHERE gateway_id = ?", (gateway_id,)).fetchone())

    def last_sync_at(self) -> str | None:
        return self._store.get_meta("last_sync_at")
