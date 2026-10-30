// 프로젝트 API — 스페이스 안 묶음 + 지침 (conductor/api_spaces.py). 멤버 · 역할은 스페이스 것을 그대로 쓴다.
import type { ScopePath } from '@brewai/ui';
import { ApiError, bool, isObj, json, num, send, str, strOrNull } from '../../lib/api';
import { toScopePath } from '../scope/api';

export type Project = {
  id: string;
  space_id: string;
  name: string;
  description: string;
  instructions: string; // 이 프로젝트 대화의 시스템 프롬프트 뒤에 붙는다 (4000자까지)
  created_by: string | null;
  created_by_name: string | null; // 닉네임
  sort_order: number;
  archived_at: string | null;
  created_at: string;
  can_edit: boolean; // 만든 사람 · 스페이스 운영
  path: ScopePath;
};

export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 500;
export const INSTRUCTIONS_MAX = 4000;

export function toProject(v: unknown): Project | null {
  if (!isObj(v) || typeof v.id !== 'string') return null;
  return {
    id: v.id,
    space_id: str(v.space_id),
    name: str(v.name),
    description: str(v.description),
    instructions: str(v.instructions),
    created_by: strOrNull(v.created_by),
    created_by_name: strOrNull(v.created_by_name),
    sort_order: num(v.sort_order) ?? 0,
    archived_at: strOrNull(v.archived_at),
    created_at: str(v.created_at),
    can_edit: bool(v.can_edit),
    path: toScopePath(v.path),
  };
}
const must = (p: Project | null) => {
  if (!p) throw new ApiError('server', 'bad_shape');
  return p;
};

export async function listProjects(spaceId: string, signal?: AbortSignal): Promise<Project[]> {
  const data = await json(`/api/spaces/${encodeURIComponent(spaceId)}/projects?archived=false`, signal);
  return Array.isArray(data) ? data.map(toProject).filter((p): p is Project => p !== null) : [];
}

export type ProjectInput = { name: string; description: string; instructions: string };
export const createProject = async (spaceId: string, input: ProjectInput) =>
  must(toProject(await send(`/api/spaces/${encodeURIComponent(spaceId)}/projects`, 'POST', input)));
export const patchProject = async (id: string, patch: Partial<ProjectInput & { sort_order: number; archived: boolean }>) =>
  must(toProject(await send(`/api/projects/${encodeURIComponent(id)}`, 'PATCH', patch)));
