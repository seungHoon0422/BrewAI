"""파일 (데스크톱 · Bearer · slice 07 · ADR-0015). 저장 · 뽑기 · 전달 계획 = files.py · 판정 = guard (대화 · 프로젝트 · 스페이스 규칙 그대로).

  PUT    /api/files?space=&project=&name=   본문 = 파일 바이트 그대로 (multipart 없음 · 25MB) → 201 File
                                            project 있음 = 프로젝트 파일 · 없음 = 첨부 준비 (보낸 첫 턴에 그 대화에 묶인다 · 그때까지 올린 사람만)
  GET    /api/files?space=&project=&thread=  [File + where] (볼 수 있는 것만 · space 만 = 스페이스 '파일' 화면)
  GET    /api/files/{id}                    File + labels (쪽 · 시트 · 슬라이드 이름)
  GET    /api/files/{id}/content            원본 (이미지 = 미리보기 · 그 밖 = 내려받기)
  DELETE /api/files/{id}                    204 (올린 사람 · 프로젝트 파일 = 프로젝트 편집 권한)
  POST   /api/files/plan                    {model, files: [id]} → [{id, mode, tokens, reason}] (입력창 칩의 전달 배지)
File  = {id, name, kind, mime, size, pages, text_tokens, space_id, project_id, thread_id, run_id, owner_user_id, created_at, owner_name?}
where = {kind: thread|project|draft, id, title}
없거나 못 보는 파일 = 404 (있는지 숨김).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from .auth.accounts import Principal
from .auth.http import accounts_of, directory_of, guard_of, require_user
from .auth.policy import Denied
from .files import MAX_BYTES, MAX_FILES_PER_MESSAGE, Caps, FileError, FileRow, Files, plan
from .models import ModelRegistry


class PlanIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str | None = Field(default=None, max_length=200)
    files: list[str] = Field(max_length=MAX_FILES_PER_MESSAGE)


def caps_of(registry: ModelRegistry, model: str | None) -> Caps:
    choice = registry.resolve(model)
    return Caps(vision=bool(choice and choice.supports_vision), pdf=bool(choice and choice.supports_pdf))


def can_view(request: Request, p: Principal, f: FileRow) -> bool:
    guard = guard_of(request)
    try:
        if f.thread_id:
            guard.thread(p.actor, f.thread_id, "view")
            return True
        if f.project_id:
            guard.project(p.actor, f.project_id, "view")
            return True
        guard.space(p.actor, f.space_id, "member")
        return f.owner_user_id == p.user_id  # 아직 안 보낸 첨부 = 올린 사람만
    except Denied:
        return False


def can_delete(request: Request, p: Principal, f: FileRow) -> bool:
    if not can_view(request, p, f):
        return False
    if f.owner_user_id == p.user_id:
        return True
    if f.project_id:
        try:
            guard_of(request).project(p.actor, f.project_id, "edit")
            return True
        except Denied:
            return False
    return False


def visible(request: Request, p: Principal, files: Files, file_id: str) -> FileRow:
    f = files.get(file_id)
    if f is None or not can_view(request, p, f):
        raise Denied(404, "file_not_found")
    return f


def register(user: APIRouter, *, files: Files, registry: ModelRegistry) -> None:
    def where(request: Request, f: FileRow) -> dict[str, Any]:
        directory = directory_of(request)
        if f.thread_id:
            row = request.app.state.store.thread_row(f.thread_id)
            return {"kind": "thread", "id": f.thread_id, "title": (row["title"] if row is not None else None) or None}
        if f.project_id:
            pr = directory.project(f.project_id)
            return {"kind": "project", "id": f.project_id, "title": pr["name"] if pr is not None else None}
        return {"kind": "draft", "id": None, "title": None}

    def out(request: Request, f: FileRow, *, with_where: bool = False) -> dict[str, Any]:
        o = f.out()
        owner = accounts_of(request).user(f.owner_user_id)
        o["owner_name"] = owner["display_name"] if owner is not None else None
        if with_where:
            o["where"] = where(request, f)
        return o

    @user.put("/api/files", status_code=201)
    async def upload(
        request: Request, space: str | None = Query(default=None, max_length=64), project: str | None = Query(default=None, max_length=64),
        name: str = Query(default="파일", max_length=400), p: Principal = Depends(require_user),
    ) -> Any:
        guard = guard_of(request)
        facts = guard.space(p.actor, space, "writable")
        if project:
            row = guard.project_in(p.actor, project, facts)  # 그 스페이스의 프로젝트 · 보관 안 됨
            project = row["id"]
        size = int(request.headers.get("content-length") or 0)
        if size > MAX_BYTES:
            raise FileError("file_too_large", 413)
        body = bytearray()
        async for part in request.stream():  # 상한을 넘으면 더 읽지 않는다
            body += part
            if len(body) > MAX_BYTES:
                raise FileError("file_too_large", 413)
        f = files.add(user_id=p.user_id, space_id=facts.id, project_id=project, name=name, data=bytes(body))
        return out(request, f, with_where=True)

    @user.get("/api/files")
    async def list_files(
        request: Request, space: str | None = Query(default=None, max_length=64), project: str | None = Query(default=None, max_length=64),
        thread: str | None = Query(default=None, max_length=64), p: Principal = Depends(require_user),
    ) -> list[dict[str, Any]]:
        guard = guard_of(request)
        if thread:
            guard.thread(p.actor, thread, "view")
            rows = files.list(thread_id=thread)
        elif project:
            guard.project(p.actor, project, "view")
            rows = files.list(project_id=project)
        else:
            facts = guard.space(p.actor, space, "member")
            rows = files.list(space_id=facts.id)
        return [out(request, f, with_where=True) for f in rows if can_view(request, p, f)]

    @user.get("/api/files/{file_id}")
    async def get_file(request: Request, file_id: str, p: Principal = Depends(require_user)) -> dict[str, Any]:
        f = visible(request, p, files, file_id)
        return out(request, f, with_where=True) | {"labels": list(f.chunk_labels)}

    @user.get("/api/files/{file_id}/content")
    async def file_content(request: Request, file_id: str, p: Principal = Depends(require_user)) -> Response:
        f = visible(request, p, files, file_id)
        disposition = "inline" if f.kind == "image" else "attachment"
        quoted = f.name.encode("utf-8").hex()  # 이름은 헤더에 그대로 넣지 않는다 (줄바꿈 · 따옴표) · 화면이 이름을 따로 안다
        return Response(files.data(f), media_type=f.mime, headers={
            "Content-Disposition": f'{disposition}; filename="file-{quoted[:16]}"', "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=3600", "Content-Security-Policy": "default-src 'none'",
        })

    @user.delete("/api/files/{file_id}", status_code=204)
    async def delete_file(request: Request, file_id: str, p: Principal = Depends(require_user)) -> Response:
        f = visible(request, p, files, file_id)
        if not can_delete(request, p, f):
            raise Denied(403, "not_allowed")
        files.delete(f.id)
        return Response(status_code=204)

    @user.post("/api/files/plan")
    async def plan_files(request: Request, body: PlanIn, p: Principal = Depends(require_user)) -> list[dict[str, Any]]:
        await registry.refresh()
        caps = caps_of(registry, body.model)
        return [{"id": f.id} | plan(f, caps).row() for f in (visible(request, p, files, fid) for fid in body.files)]


def file_error_response(e: FileError) -> JSONResponse:
    return JSONResponse({"detail": e.code}, status_code=e.status)
