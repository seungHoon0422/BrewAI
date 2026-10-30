// 사용자 = conductor /api/admin/users* (쿠키 + CSRF · instance admin). fetch 와 응답 모양 검사만 한다.
// 비밀번호 · 토큰은 서버도 원문을 갖지 않는다. 재설정 코드는 만들 때 한 번만 온다.
import { callJson, call, expectList, expectObj, num, objs, str, strOrNull, strs } from '../../shared/http';

export type UserStatus = 'active' | 'disabled';
export type InstanceRole = 'admin' | 'user';
export type Membership = { id: string; name: string; role: string }; // 조직 · 조직 역할
export type AdminUserRow = {
  id: string;
  email: string;
  display_name: string; // 닉네임 (겹칠 수 있다 → 이메일과 같이 보인다)
  instance_role: InstanceRole;
  status: UserStatus;
  providers: string[]; // 'google' · 'password'
  orgs: Membership[];
  session_count: number;
  last_login_at: string | null;
  created_at: string;
};
export type UserPatch = { status?: UserStatus; instance_role?: InstanceRole; display_name?: string };
export type ResetCode = { code: string; expires_at: string };

export const toMemberships = (v: unknown): Membership[] => objs(v).map((o) => ({ id: str(o.id), name: str(o.name), role: str(o.role, 'member') }));

function toUser(u: Record<string, unknown>): AdminUserRow {
  return {
    id: str(u.id),
    email: str(u.email),
    display_name: str(u.display_name, str(u.email)),
    instance_role: u.instance_role === 'admin' ? 'admin' : 'user',
    status: u.status === 'disabled' ? 'disabled' : 'active',
    providers: strs(u.providers),
    orgs: toMemberships(u.orgs),
    session_count: num(u.session_count) ?? 0,
    last_login_at: strOrNull(u.last_login_at),
    created_at: str(u.created_at),
  };
}

const userPath = (id: string) => `/api/admin/users/${encodeURIComponent(id)}`;

export async function listUsers(signal?: AbortSignal): Promise<AdminUserRow[]> {
  return expectList(await call('/api/admin/users', { signal })).map(toUser);
}

// 비활성화 = 그 사람 세션 전부 끊김 · 자기 자신을 끄거나 관리자에서 빼기 = 409 cannot_change_self
export async function patchUser(id: string, patch: UserPatch): Promise<AdminUserRow> {
  return toUser(expectObj(await callJson(userPath(id), 'PATCH', patch)));
}

export async function revokeSessions(id: string): Promise<number> {
  return num(expectObj(await callJson(`${userPath(id)}/sessions`, 'DELETE')).revoked) ?? 0;
}

// 비밀번호 재설정 코드 (bwp_… · 30분 · 한 번). 사용자가 데스크톱 로그인 화면 › 비밀번호 재설정에 넣는다
export async function issueResetCode(id: string): Promise<ResetCode> {
  const d = expectObj(await callJson(`${userPath(id)}/reset-code`, 'POST'));
  return { code: str(d.code), expires_at: str(d.expires_at) };
}
