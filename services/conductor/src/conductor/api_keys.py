"""API 키 관리 (ADR-0017 · 판단 = apikeys.py). 키 값은 만들 때 응답에 한 번만 · 그 뒤엔 hint (앞 4 · 뒤 4).

사용자 (Bearer bwa_ · 데스크톱 설정 › API 키)
  GET    /api/me/keys                {policy: {enabled, default_days, max_days, limits}, scopes, keys: [Key]} (내 키만)
  POST   /api/me/keys                {name, scopes: [models:read|chat|usage:read], days?} → 201 {key: 'bwk_…' (한 번만), item: Key}
                                     거절 = 403 api_keys_off · 409 too_many_keys (20개) · 422 bad_name | bad_scopes | bad_days (정책 max_days)
  PATCH  /api/me/keys/{id}           {name} → Key   ·   DELETE /api/me/keys/{id} → Key (폐기 · 즉시 401) · 남의 키 = 404
관리자 (쿠키 · 콘솔 › 사용자와 조직 › API 키)
  GET    /api/admin/keys?user=       {policy, keys: [Key + user]} (전부 · 폐기 · 만료 포함)
  PATCH  /api/admin/keys/policy      {enabled?, default_days?, max_days?, limits?: {rpm, tokens_per_day, usd_per_month}} → policy
  PATCH  /api/admin/keys/{id}        {limits: {…} | null} → Key (null = 정책 기본값 따름 · 칸 null = 무제한)
  DELETE /api/admin/keys/{id}        → Key (강제 폐기)
Key = {id, name, hint, scopes, status: active|expired|revoked, created_at, expires_at, last_used_at, revoked_at, limits (적용값),
       custom_limits (관리자가 덮어쓴 칸), user {id, name, email}, month {runs, tokens, cost_usd}}
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from .apikeys import SCOPES, ApiKeyError, Keys
from .auth.accounts import Principal
from .auth.http import accounts_of, client_ip, require_admin, require_user
from .auth.policy import Denied


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class KeyIn(_In):
    name: str = Field(max_length=200)
    scopes: list[str] = Field(max_length=10)
    days: int | None = None


class KeyPatch(_In):
    name: str = Field(max_length=200)


class LimitsPatch(_In):
    limits: dict[str, float | None] | None


class PolicyPatch(_In):
    enabled: bool | None = None
    default_days: int | None = None
    max_days: int | None = None
    limits: dict[str, float | None] | None = None


def _public_policy(p: dict[str, Any]) -> dict[str, Any]:
    return {k: p[k] for k in ("enabled", "default_days", "max_days", "limits")}


def register(user: APIRouter, admin: APIRouter, *, keys: Keys) -> None:
    def audit(request: Request, p: Principal, action: str, item: dict[str, Any], **detail: Any) -> None:
        accounts_of(request).audit(action, actor=p.user_id, target_type="api_key", target_id=item["id"], ip=client_ip(request),
                                   detail={"hint": item["hint"], **detail})

    def denied(e: ApiKeyError) -> Denied:
        return Denied(e.status, e.code)

    # ── 사용자 ──
    @user.get("/api/me/keys")
    async def my_keys(p: Principal = Depends(require_user)) -> dict[str, Any]:
        return {"policy": _public_policy(keys.policy()), "scopes": list(SCOPES), "keys": keys.list(user_id=p.user_id)}

    @user.post("/api/me/keys", status_code=201)
    async def create_key(request: Request, body: KeyIn, p: Principal = Depends(require_user)) -> dict[str, Any]:
        try:
            item, raw = keys.create(user_id=p.user_id, name=body.name, scopes=body.scopes, days=body.days)
        except ApiKeyError as e:
            raise denied(e) from e
        audit(request, p, "api_key_create", item, scopes=item["scopes"], expires_at=item["expires_at"])
        return {"key": raw, "item": item}

    @user.patch("/api/me/keys/{key_id}")
    async def rename_key(key_id: str, body: KeyPatch, p: Principal = Depends(require_user)) -> dict[str, Any]:
        try:
            return keys.rename(key_id, body.name, user_id=p.user_id)
        except ApiKeyError as e:
            raise denied(e) from e

    @user.delete("/api/me/keys/{key_id}")
    async def revoke_my_key(request: Request, key_id: str, p: Principal = Depends(require_user)) -> dict[str, Any]:
        try:
            item = keys.revoke(key_id, by=p.user_id, user_id=p.user_id)
        except ApiKeyError as e:
            raise denied(e) from e
        audit(request, p, "api_key_revoke", item)
        return item

    # ── 관리자 ──
    @admin.get("/api/admin/keys")
    async def all_keys(user_id: str | None = Query(None, alias="user", max_length=64)) -> dict[str, Any]:
        return {"policy": _public_policy(keys.policy()), "scopes": list(SCOPES), "keys": keys.list(user_id=user_id)}

    @admin.patch("/api/admin/keys/policy")
    async def patch_policy(request: Request, body: PolicyPatch, p: Principal = Depends(require_admin)) -> dict[str, Any]:
        patch = body.model_dump(include=body.model_fields_set)
        if patch.get("enabled") is None:
            patch.pop("enabled", None)
        try:
            got = _public_policy(keys.set_policy(patch))
        except ValueError as e:
            raise Denied(422, str(e)) from e
        accounts_of(request).audit("api_key_policy", actor=p.user_id, target_type="api_key_policy", ip=client_ip(request), detail=got)
        return got

    @admin.patch("/api/admin/keys/{key_id}")
    async def patch_key_limits(request: Request, key_id: str, body: LimitsPatch, p: Principal = Depends(require_admin)) -> dict[str, Any]:
        try:
            item = keys.set_limits(key_id, body.limits)
        except ValueError as e:
            raise Denied(422, str(e)) from e
        except ApiKeyError as e:
            raise denied(e) from e
        audit(request, p, "api_key_limits", item, limits=body.limits)
        return item

    @admin.delete("/api/admin/keys/{key_id}")
    async def revoke_any_key(request: Request, key_id: str, p: Principal = Depends(require_admin)) -> dict[str, Any]:
        try:
            item = keys.revoke(key_id, by=p.user_id)
        except ApiKeyError as e:
            raise denied(e) from e
        audit(request, p, "api_key_revoke", item, admin=True)
        return item
