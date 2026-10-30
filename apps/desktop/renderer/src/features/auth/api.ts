// 로그인 API — 공개 경로(상태 · 초대 미리보기 · 재설정)는 renderer 가 바로 부르고, 토큰이 나오는 것(로그인 · 가입 · Google)은
// main 이 부른다 (lib/bridge.ts). 여기 모양 = conductor 계약 (JSON snake_case · 오류 {detail: code}).
import { ApiError, apiBase, isObj, json, list, num, send, str, strOrNull } from '../../lib/api';

export type OrgRole = 'owner' | 'admin' | 'member';
export type Me = {
  id: string;
  email: string; // 로그인 ID (읽기 전용)
  display_name: string; // 닉네임 — 사람이 보이는 곳은 모두 이것
  instance_role: 'admin' | 'user';
  created_at: string;
  has_password: boolean;
  google: { email: string | null; hd: string | null; linked_at: string } | null;
  orgs: { id: string; name: string; role: OrgRole }[];
  personal_space_id: string | null;
  last_space_id: string | null;
};

const orgRole = (v: unknown): OrgRole => (v === 'owner' || v === 'admin' ? v : 'member');

export function toMe(v: unknown): Me | null {
  if (!isObj(v) || typeof v.id !== 'string') return null;
  const g = isObj(v.google) ? v.google : null;
  return {
    id: v.id,
    email: str(v.email),
    display_name: str(v.display_name).trim() || str(v.email).split('@')[0] || '?',
    instance_role: v.instance_role === 'admin' ? 'admin' : 'user',
    created_at: str(v.created_at),
    has_password: v.has_password === true,
    google: g ? { email: strOrNull(g.email), hd: strOrNull(g.hd), linked_at: str(g.linked_at) } : null,
    orgs: list(v.orgs).map((o) => ({ id: str(o.id), name: str(o.name), role: orgRole(o.role) })),
    personal_space_id: strOrNull(v.personal_space_id),
    last_space_id: strOrNull(v.last_space_id),
  };
}

// GET /api/auth/state — 로그인 화면이 먼저 읽는다 (Google 버튼 · 비밀번호 최소 길이 · 첫 계정 여부 · 아직 아무도 로그인 안 함)
// testAdmin = 테스트 계정 admin / admin 이 켜져 있음 (npm run dev · 이 PC 에서만)
export type ServerInfo = { google: boolean; passwordMin: number; needsBootstrap: boolean; firstLogin: boolean; testAdmin: boolean };
export const DEFAULT_PASSWORD_MIN = 15; // 서버 값(password_min)을 못 읽었을 때만

export async function getServerInfo(signal?: AbortSignal): Promise<ServerInfo> {
  const data = await json('/api/auth/state', signal);
  if (!isObj(data)) throw new ApiError('server', 'bad_shape');
  const providers = isObj(data.providers) ? data.providers : {};
  return {
    google: providers.google === true, passwordMin: num(data.password_min) ?? DEFAULT_PASSWORD_MIN,
    needsBootstrap: data.needs_bootstrap === true, firstLogin: data.first_login === true, testAdmin: data.test_admin === true,
  };
}

// 화면에 보일 서버 주소 (예: 127.0.0.1:8787)
export const serverHost = async () => {
  const b = await apiBase();
  return b ? new URL(b).host : null;
};

export type InvitePreview = {
  org: { id: string; name: string };
  inviter_name: string | null;
  org_role: OrgRole;
  spaces: { id: string; name: string }[];
  email_hint: string | null; // 가린 이메일 (이메일 지정 초대만)
  expires_at: string;
  google: boolean;
};

export async function previewInvite(code: string): Promise<InvitePreview> {
  const data = await send('/api/auth/invite/preview', 'POST', { code });
  if (!isObj(data)) throw new ApiError('server', 'bad_shape');
  const org = isObj(data.org) ? data.org : {};
  return {
    org: { id: str(org.id), name: str(org.name) },
    inviter_name: strOrNull(data.inviter_name),
    org_role: orgRole(data.org_role),
    spaces: list(data.spaces).map((s) => ({ id: str(s.id), name: str(s.name) })),
    email_hint: strOrNull(data.email_hint),
    expires_at: str(data.expires_at),
    google: data.google === true,
  };
}

export async function resetPassword(code: string, password: string): Promise<void> {
  await send('/api/auth/reset', 'POST', { code: code.trim(), password });
}

// 초대 코드 입력 정리 — 대소문자 · 공백 · 하이픈 위치는 서버가 너그럽게 받는다. 화면은 보기 좋게만
export const tidyInvite = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, '');
