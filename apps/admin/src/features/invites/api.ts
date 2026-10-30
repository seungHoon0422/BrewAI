// 초대 = conductor /api/admin/invites* (쿠키 + CSRF). 가입은 초대 코드로만 (+ 조직의 도메인 자동 가입, ADR-0010).
// 코드(BREW-XXXX-XXXX)는 만들 때 한 번만 온다 — 서버엔 sha256 만 있다.
import { callJson, call, expectList, expectObj, num, objs, str, strOrNull } from '../../shared/http';

export type InviteStatus = 'active' | 'used_up' | 'expired' | 'revoked';
export type InviteRole = 'admin' | 'member';
export type Invite = {
  id: string;
  org_id: string;
  org_name: string;
  email: string | null; // 있으면 이 이메일로만 가입
  org_role: InviteRole;
  spaces: { id: string; name: string }[]; // 가입하면 바로 들어갈 공유 스페이스
  max_uses: number;
  uses: number;
  created_by_name: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  status: InviteStatus;
};
export type InviteIn = { org_id?: string; email?: string; org_role: InviteRole; space_ids: string[]; max_uses: number; days: number };

const STATUSES: readonly InviteStatus[] = ['active', 'used_up', 'expired', 'revoked'];

function toInvite(i: Record<string, unknown>): Invite {
  return {
    id: str(i.id),
    org_id: str(i.org_id),
    org_name: str(i.org_name),
    email: strOrNull(i.email),
    org_role: i.org_role === 'admin' ? 'admin' : 'member',
    spaces: objs(i.spaces).map((s) => ({ id: str(s.id), name: str(s.name) })),
    max_uses: num(i.max_uses) ?? 1,
    uses: num(i.uses) ?? 0,
    created_by_name: strOrNull(i.created_by_name),
    created_at: str(i.created_at),
    expires_at: str(i.expires_at),
    revoked_at: strOrNull(i.revoked_at),
    status: STATUSES.find((s) => s === i.status) ?? 'expired',
  };
}

export async function listInvites(signal?: AbortSignal): Promise<Invite[]> {
  return expectList(await call('/api/admin/invites', { signal })).map(toInvite);
}

export async function createInvite(body: InviteIn): Promise<{ invite: Invite; code: string }> {
  const d = expectObj(await callJson('/api/admin/invites', 'POST', body));
  return { invite: toInvite(expectObj(d.invite)), code: str(d.code) };
}

export async function revokeInvite(id: string): Promise<void> {
  await callJson(`/api/admin/invites/${encodeURIComponent(id)}`, 'DELETE');
}
