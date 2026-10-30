// 범위 API — 스페이스(멤버십 층) · 멤버 · 조직 사람 찾기 + 모든 자원의 `path` 읽기 (conductor/api_spaces.py).
// path = [{kind, id, name}] (위 → 아래, 자기 자신 포함) — 층 수를 모른 채 그대로 읽는다. 없거나 모양이 다르면 빈 경로.
import type { ScopeCrumb, ScopePath } from '@brewai/ui';
import { ApiError, bool, isObj, json, list, num, send, str, strOrNull } from '../../lib/api';

export function toScopePath(v: unknown): ScopePath {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObj)
    .map((c): ScopeCrumb => ({ kind: str(c.kind), id: str(c.id), name: str(c.name) }))
    .filter((c) => c.kind && c.id);
}

export type Visibility = 'open' | 'private';
export type SpaceRole = 'admin' | 'member';
export type Space = {
  id: string;
  org_id: string;
  org_name: string;
  kind: 'personal' | 'shared';
  name: string;
  description: string;
  visibility: Visibility | null; // personal = null
  role: SpaceRole | null; // 내 실효 역할 (참여 안 함 = null)
  joined: boolean;
  implicit: boolean; // 조직 owner · admin 이라 자동 운영
  member_count: number;
  archived_at: string | null;
  created_at: string;
  can_manage: boolean;
  path: ScopePath;
};
export type Org = { id: string; name: string; role: string; can_create_spaces: boolean };
export type Member = { user_id: string; display_name: string; email: string; role: SpaceRole; implicit: boolean };
export type Person = { user_id: string; display_name: string; email: string; role: string };

const role = (v: unknown): SpaceRole | null => (v === 'admin' || v === 'member' ? v : null);

export function toSpace(v: unknown): Space | null {
  if (!isObj(v) || typeof v.id !== 'string') return null;
  return {
    id: v.id,
    org_id: str(v.org_id),
    org_name: str(v.org_name),
    kind: v.kind === 'personal' ? 'personal' : 'shared',
    name: str(v.name),
    description: str(v.description),
    visibility: v.visibility === 'open' || v.visibility === 'private' ? v.visibility : null,
    role: role(v.role),
    joined: bool(v.joined),
    implicit: bool(v.implicit),
    member_count: num(v.member_count) ?? 0,
    archived_at: strOrNull(v.archived_at),
    created_at: str(v.created_at),
    can_manage: bool(v.can_manage),
    path: toScopePath(v.path),
  };
}
const spaces = (v: unknown) => (Array.isArray(v) ? v.map(toSpace).filter((s): s is Space => s !== null) : []);
const must = (s: Space | null) => {
  if (!s) throw new ApiError('server', 'bad_shape');
  return s;
};

export async function listSpaces(signal?: AbortSignal): Promise<{ spaces: Space[]; browse: Space[]; orgs: Org[] }> {
  const data = await json('/api/spaces', signal);
  if (!isObj(data)) throw new ApiError('server', 'bad_shape');
  return {
    spaces: spaces(data.spaces),
    browse: spaces(data.browse),
    orgs: list(data.orgs).map((o) => ({ id: str(o.id), name: str(o.name), role: str(o.role), can_create_spaces: bool(o.can_create_spaces) })),
  };
}

const at = (id: string) => `/api/spaces/${encodeURIComponent(id)}`;

export type SpaceInput = { name: string; description: string; visibility: Visibility; org_id?: string; members?: { user_id: string; role: SpaceRole }[] };
export const createSpace = async (input: SpaceInput) => must(toSpace(await send('/api/spaces', 'POST', input)));
export const patchSpace = async (id: string, patch: Partial<{ name: string; description: string; visibility: Visibility; archived: boolean }>) =>
  must(toSpace(await send(at(id), 'PATCH', patch)));
export const joinSpace = async (id: string) => must(toSpace(await send(`${at(id)}/join`, 'POST')));
export const leaveSpace = async (id: string) => {
  await send(`${at(id)}/leave`, 'POST');
};

export async function listMembers(id: string, signal?: AbortSignal): Promise<Member[]> {
  return list(await json(`${at(id)}/members`, signal)).map((m) => ({
    user_id: str(m.user_id), display_name: str(m.display_name), email: str(m.email), role: role(m.role) ?? 'member', implicit: bool(m.implicit),
  }));
}
export const setMember = async (id: string, userId: string, r: SpaceRole) => {
  await send(`${at(id)}/members/${encodeURIComponent(userId)}`, 'PUT', { role: r });
};
export const removeMember = async (id: string, userId: string) => {
  await send(`${at(id)}/members/${encodeURIComponent(userId)}`, 'DELETE');
};

// 조직 사람 찾기 (20명까지) — 스페이스 멤버로 넣을 때
export async function findPeople(q: string, orgId?: string, signal?: AbortSignal): Promise<Person[]> {
  const params = new URLSearchParams({ q });
  if (orgId) params.set('org_id', orgId);
  return list(await json(`/api/org/members?${params}`, signal)).map((p) => ({
    user_id: str(p.user_id), display_name: str(p.display_name), email: str(p.email), role: str(p.role),
  }));
}

// 마지막으로 연 스페이스 (다음 실행 · 다른 PC 에서 같은 곳으로) — PATCH /api/me {last_space_id}
export const rememberSpace = async (id: string) => {
  await send('/api/me', 'PATCH', { last_space_id: id });
};
