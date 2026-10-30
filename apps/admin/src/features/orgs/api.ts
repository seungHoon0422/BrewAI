// 조직 = conductor /api/admin/orgs* (쿠키 + CSRF). 조직 = 범위의 사람 묶음 층 (가입 · 초대 · 조직 역할 · ADR-0011)
import { callJson, call, expectList, expectObj, num, str, strOrNull } from '../../shared/http';
import { parsePath, pathOf, type ScopePath } from '../scope/model';

export type JoinPolicy = 'invite' | 'domain_auto'; // 초대 코드만 · 초대 코드 + Google Workspace 도메인 자동 가입
export type OrgRole = 'owner' | 'admin' | 'member';
export const ORG_ROLES: readonly OrgRole[] = ['owner', 'admin', 'member'];

export type AdminOrg = {
  id: string;
  name: string;
  slug: string;
  join_policy: JoinPolicy;
  google_hd: string | null;
  members_can_create_spaces: boolean;
  member_count: number;
  space_count: number;
  created_at: string;
  path: ScopePath;
};
export type OrgPatch = Partial<Pick<AdminOrg, 'name' | 'join_policy' | 'google_hd' | 'members_can_create_spaces'>>;
export type OrgMember = { user_id: string; email: string; display_name: string; status: string; role: OrgRole; joined_at: string | null };

export const toOrgRole = (v: unknown): OrgRole => (v === 'owner' || v === 'admin' ? v : 'member');

function toOrg(o: Record<string, unknown>): AdminOrg {
  const id = str(o.id);
  const name = str(o.name);
  return {
    id,
    name,
    slug: str(o.slug),
    join_policy: o.join_policy === 'domain_auto' ? 'domain_auto' : 'invite',
    google_hd: strOrNull(o.google_hd),
    members_can_create_spaces: o.members_can_create_spaces === true,
    member_count: num(o.member_count) ?? 0,
    space_count: num(o.space_count) ?? 0,
    created_at: str(o.created_at),
    path: parsePath(o.path) ?? pathOf(['tenant', id, name]),
  };
}

const orgPath = (id: string) => `/api/admin/orgs/${encodeURIComponent(id)}`;

export async function listOrgs(signal?: AbortSignal): Promise<AdminOrg[]> {
  return expectList(await call('/api/admin/orgs', { signal })).map(toOrg);
}

// 만든 관리자가 owner 가 된다. slug 를 비우면 이름에서 만든다 (겹치면 -2 …)
export async function createOrg(name: string, slug?: string): Promise<AdminOrg> {
  return toOrg(expectObj(await callJson('/api/admin/orgs', 'POST', slug ? { name, slug } : { name })));
}

// domain_auto 는 google_hd 가 있어야 한다 (422 google_hd_required · bad_google_hd)
export async function patchOrg(id: string, patch: OrgPatch): Promise<AdminOrg> {
  return toOrg(expectObj(await callJson(orgPath(id), 'PATCH', patch)));
}

export async function listOrgMembers(id: string, signal?: AbortSignal): Promise<OrgMember[]> {
  return expectList(await call(`${orgPath(id)}/members`, { signal })).map((m) => ({
    user_id: str(m.user_id),
    email: str(m.email),
    display_name: str(m.display_name, str(m.email)),
    status: str(m.status, 'active'),
    role: toOrgRole(m.role),
    joined_at: strOrNull(m.joined_at),
  }));
}

// 없는 사람이면 넣고, 있으면 역할만 바꾼다. 마지막 owner 를 내리면 409 last_owner
export async function setOrgMember(orgId: string, userId: string, role: OrgRole): Promise<void> {
  await callJson(`${orgPath(orgId)}/members/${encodeURIComponent(userId)}`, 'PUT', { role });
}

// 조직에서 빼면 그 조직 공유 스페이스 멤버십도 같이 빠진다 (내 스페이스는 그대로)
export async function removeOrgMember(orgId: string, userId: string): Promise<void> {
  await callJson(`${orgPath(orgId)}/members/${encodeURIComponent(userId)}`, 'DELETE');
}
