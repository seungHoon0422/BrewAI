// 관리자 세션 상태 하나 (틀 App 이 한 번 깐다). 확인 중 → 로그인 화면 | 콘솔.
// 401 · 권한 잃음은 shared/http 가 알린다 (onSessionLost) → 로그인 화면 + 이유 한 줄. 화면(컴포넌트)은 useSession 만 쓴다.
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AdminApiError, isConductorDown, onSessionLost, setCsrfToken } from '../../shared/http';
import { adminLogin, adminLogout, getAdminSession, type AdminMe, type AdminSession } from './api';

export type Session =
  | { status: 'checking' }
  | { status: 'signed_out'; notice: string | null } // notice = copy.ts NOTICE · LOGIN_ERROR 의 code
  | { status: 'signed_in'; user: AdminMe; expires_at: string | null };

export type SessionApi = {
  session: Session;
  login: (email: string, password: string) => Promise<void>; // 실패 = AdminApiError (code 로 문구)
  logout: () => Promise<void>;
  recheck: () => void;
};

export const SessionContext = createContext<SessionApi | null>(null);

// Google 콜백 실패 = '/?auth_error=<code>' → 읽고 주소에서 지운다 (새로고침해도 다시 안 뜨게)
function takeAuthError(): string | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('auth_error');
  if (code === null) return null;
  url.searchParams.delete('auth_error');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  return /^[a-z_]{1,40}$/.test(code) ? code : 'unknown';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: 'checking' });
  const [tick, setTick] = useState(0);

  const signIn = useCallback((s: AdminSession) => {
    setCsrfToken(s.csrf_token);
    setSession({ status: 'signed_in', user: s.user, expires_at: s.expires_at });
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    const authError = takeAuthError();
    getAdminSession(ctrl.signal).then(
      (s) => {
        if (s.user.instance_role !== 'admin') throw new AdminApiError('server', 'not_admin', 403);
        signIn(s);
      },
      (e) => {
        if ((e as Error).name === 'AbortError') return;
        setCsrfToken(null);
        setSession({ status: 'signed_out', notice: authError ?? (isConductorDown(e) ? 'conductor' : null) });
      },
    );
    return () => ctrl.abort();
  }, [tick, signIn]);

  useEffect(
    () =>
      onSessionLost((why) => {
        setCsrfToken(null);
        setSession((s) => (s.status === 'signed_in' ? { status: 'signed_out', notice: why } : s));
      }),
    [],
  );

  const login = useCallback(async (email: string, password: string) => {
    signIn(await adminLogin(email, password));
  }, [signIn]);

  const logout = useCallback(async () => {
    await adminLogout().catch(() => {}); // 이미 끝난 세션이어도 화면은 로그아웃
    setCsrfToken(null);
    setSession({ status: 'signed_out', notice: 'signed_out' });
  }, []);

  const recheck = useCallback(() => {
    setSession({ status: 'checking' });
    setTick((t) => t + 1);
  }, []);

  const value = useMemo(() => ({ session, login, logout, recheck }), [session, login, logout, recheck]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
