// 관리자 세션 = conductor /api/admin/auth/* (쿠키 + CSRF, ADR-0010) · 로그인 화면이 쓰는 공개 /api/auth/state.
// 쿠키는 HttpOnly 라 여기서 못 본다. 받은 csrf_token 은 shared/http 에 넣어 안전하지 않은 요청마다 붙인다.
import { API_URL, call, callJson, expectObj, isObj, num, str, strOrNull } from '../../shared/http';

export type AdminMe = { id: string; email: string; display_name: string; instance_role: 'admin' | 'user' };
export type AdminSession = { user: AdminMe; csrf_token: string; expires_at: string | null };
// test_admin = 테스트 관리자 admin / admin 이 켜져 있음 (npm run dev · 이 PC 에서만)
export type AuthState = { google: boolean; password_min: number; needs_bootstrap: boolean; first_login: boolean; test_admin: boolean };

// 관리자 Google 로그인 = 브라우저가 이 주소로 간다 → Google → 같은 출처 콜백이 쿠키를 심고 '/' (실패 = '/?auth_error=<code>')
export const GOOGLE_START = `${API_URL}/api/auth/google/start?client=admin`;

function toSession(data: unknown): AdminSession {
  const d = expectObj(data);
  const u = isObj(d.user) ? d.user : {};
  return {
    user: {
      id: str(u.id), email: str(u.email), display_name: str(u.display_name, str(u.email)),
      instance_role: u.instance_role === 'admin' ? 'admin' : 'user',
    },
    csrf_token: str(d.csrf_token),
    expires_at: strOrNull(d.expires_at),
  };
}

// 새로고침한 화면: 쿠키가 살아 있으면 지금 세션 (401 = 로그인 화면)
export async function getAdminSession(signal?: AbortSignal): Promise<AdminSession> {
  return toSession(await call('/api/admin/auth/me', { signal }));
}

export async function adminLogin(email: string, password: string): Promise<AdminSession> {
  return toSession(await callJson('/api/admin/auth/login', 'POST', { email, password }));
}

export async function adminLogout(): Promise<void> {
  await callJson('/api/admin/auth/logout', 'POST');
}

export async function getAuthState(signal?: AbortSignal): Promise<AuthState> {
  const d = expectObj(await call('/api/auth/state', { signal }));
  const providers = isObj(d.providers) ? d.providers : {};
  return {
    google: providers.google === true, password_min: num(d.password_min) ?? 15,
    needs_bootstrap: d.needs_bootstrap === true, first_login: d.first_login === true, test_admin: d.test_admin === true,
  };
}
