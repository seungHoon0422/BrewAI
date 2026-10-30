// 로그인 화면 상태 (입력 · 보내는 중 · 오류 한 줄) · Google 버튼을 보일지. 컴포넌트는 이 값과 함수만 쓴다
import { useContext, useEffect, useState, type FormEvent } from 'react';
import { AdminApiError, isConductorDown } from '../../shared/http';
import { getAuthState, type AuthState } from './api';
import { AUTH_COPY, LOGIN_ERROR, rateLimited } from './copy';
import { SessionContext, type SessionApi } from './session';

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession: <SessionProvider> 밖에서 불렀다');
  return ctx;
}

// 공개 /api/auth/state — Google 버튼 (GOOGLE_CLIENT_ID 가 비면 숨김). 못 읽으면 비밀번호만
export function useAuthState(): AuthState | null {
  const [state, setState] = useState<AuthState | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    getAuthState(ctrl.signal).then(setState, () => {});
    return () => ctrl.abort();
  }, []);
  return state;
}

export const loginErrorText = (e: unknown): string => {
  if (isConductorDown(e)) return LOGIN_ERROR.conductor;
  const code = e instanceof AdminApiError ? e.code : undefined;
  if (code === 'rate_limited') return rateLimited(e instanceof AdminApiError ? e.retryAfter : undefined);
  return (code && LOGIN_ERROR[code]) || LOGIN_ERROR.unknown;
};

export function useLoginForm() {
  const { login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) {
      setError(AUTH_COPY.missing);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(loginErrorText(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return { email, setEmail, password, setPassword, busy, error, submit };
}
