"""로컬 폴더 연결 (slice 09 · ADR-0016 · 판단 = localfs.py). 사람마다 프로젝트 하나에 이 PC 폴더 하나 · 경로는 본인만 본다.

  GET    /api/projects/{id}/folder   {enabled, folder: {name, path, ok} | null}  (enabled = conductor 가 이 PC 에서 돌고 요청도 이 PC 에서)
  PUT    /api/projects/{id}/folder   {path} → {enabled, folder} · 거절 = 403 local_folders_off · 422 <check_root code>
  DELETE /api/projects/{id}/folder   204
권한 = 그 프로젝트를 볼 수 있는 사람 (스페이스 멤버). 기록 = audit (경로는 안 남긴다 · 폴더 이름만).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from .auth.accounts import Principal
from .auth.http import accounts_of, client_ip, from_this_pc, guard_of, require_user
from .auth.policy import Denied
from .localfs import FolderError, FolderLinks, check_root, open_folder
from .settings import Settings
from .store import now_iso


class FolderIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str = Field(min_length=1, max_length=4096)


def folders_enabled(settings: Settings, request: Request) -> bool:
    return settings.local_folders_ok and from_this_pc(request)


def register(user: APIRouter, *, settings: Settings, links: FolderLinks) -> None:
    def view(request: Request, project_id: str, p: Principal) -> dict[str, Any]:
        enabled = folders_enabled(settings, request)
        path = links.get(project_id, p.user_id)
        if path is None:
            return {"enabled": enabled, "folder": None}
        opened = open_folder(path, settings.local_home_path) if enabled else None
        name = opened.name if opened else path.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]
        return {"enabled": enabled, "folder": {"name": name, "path": path, "ok": opened is not None}}

    @user.get("/api/projects/{project_id}/folder")
    async def get_folder(request: Request, project_id: str, p: Principal = Depends(require_user)) -> dict[str, Any]:
        guard_of(request).project(p.actor, project_id)
        return view(request, project_id, p)

    @user.put("/api/projects/{project_id}/folder")
    async def put_folder(request: Request, project_id: str, body: FolderIn, p: Principal = Depends(require_user)) -> dict[str, Any]:
        guard_of(request).project(p.actor, project_id)
        if not folders_enabled(settings, request):
            raise Denied(403, "local_folders_off")
        try:
            real = check_root(body.path, settings.local_home_path)
        except FolderError as e:
            raise Denied(422, e.code) from e
        links.set(project_id, p.user_id, str(real), now_iso())
        accounts_of(request).audit("project_folder_set", actor=p.user_id, target_type="project", target_id=project_id,
                                   ip=client_ip(request), detail={"name": real.name})
        return view(request, project_id, p)

    @user.delete("/api/projects/{project_id}/folder", status_code=204)
    async def delete_folder(request: Request, project_id: str, p: Principal = Depends(require_user)) -> Response:
        guard_of(request).project(p.actor, project_id)
        if links.delete(project_id, p.user_id):
            accounts_of(request).audit("project_folder_delete", actor=p.user_id, target_type="project", target_id=project_id,
                                       ip=client_ip(request))
        return Response(status_code=204)
