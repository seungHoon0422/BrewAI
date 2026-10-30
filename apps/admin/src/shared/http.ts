// http.ts — 관리자 콘솔 → conductor 공통 (주소 · 쿠키 세션 · CSRF · 오류 분류 · 응답 모양 검사). 기능별 호출은 features/<이름>/api.ts.
// 주소 = 같은 출처 '' (vite dev · preview 가 /api 를 conductor 로 넘긴다 · vite.config.ts). 관리자 쿠키(HttpOnly)는 브라우저가 붙이고,
// 안전하지 않은 메서드에는 X-CSRF-Token 을 여기서 붙인다 (ADR-0010). 관리자 콘솔은 게이트웨이를 직접 부르지 않는다 (키는 conductor 만, ADR-0006).
export const API_URL = '';

// gateway = 게이트웨이가 안 받음 · gateway_error = 떠 있는데 오류(500 · 이상한 응답) · gateway_auth = 키 틀림
export type LoadError = 'conductor' | 'gateway' | 'gateway_error' | 'gateway_auth' | 'server';

export class AdminApiError extends Error {
  constructor(readonly kind: LoadError, readonly code?: string, readonly status?: number, readonly retryAfter?: number) {
    super(code ?? kind);
  }
}

/* ── 세션 (쿠키 = 브라우저 · CSRF 토큰 = 이 모듈 메모리) ─────────────────────
   features/auth 가 로그인 · 새로고침 때 setCsrfToken 으로 넣고, onSessionLost 로 '세션 끝남 · 권한 잃음' 을 듣는다. */
export type SessionLoss = 'expired' | 'forbidden';
let csrfToken: string | null = null;
const lossListeners = new Set<(why: SessionLoss) => void>();

export const setCsrfToken = (token: string | null) => {
  csrfToken = token;
};
export function onSessionLost(listener: (why: SessionLoss) => void): () => void {
  lossListeners.add(listener);
  return () => lossListeners.delete(listener);
}

// 관리자 경로에서 세션 문제를 뜻하는 code (그 밖의 401 · 403 = 그 요청만의 실패: invalid_credentials · not_admin · cannot_change_self …)
const LOSS: Record<string, SessionLoss> = { auth_required: 'expired', invalid_token: 'expired', wrong_surface: 'expired', forbidden: 'forbidden' };
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const ME = '/api/admin/auth/me';

async function send(path: string, init: RequestInit): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (!SAFE.has(method) && csrfToken) headers.set('x-csrf-token', csrfToken);
  try {
    return await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'same-origin' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new AdminApiError('conductor'); // 꺼짐 · 네트워크 끊김 = TypeError
  }
}

const detailOf = (res: Response) =>
  res.json().then(
    (j: { detail?: unknown; retry_after?: unknown }) => ({
      code: typeof j.detail === 'string' ? j.detail : undefined,
      retryAfter: typeof j.retry_after === 'number' ? j.retry_after : undefined,
    }),
    () => ({ code: undefined, retryAfter: undefined }),
  );

// CSRF 토큰이 낡았다 (다른 탭에서 다시 로그인 등) → 지금 세션의 토큰을 받아 한 번만 다시 보낸다
async function refreshCsrf(): Promise<boolean> {
  const res = await send(ME, {}).catch(() => null);
  if (!res?.ok) return false;
  const j = (await res.json().catch(() => null)) as { csrf_token?: unknown } | null;
  if (typeof j?.csrf_token !== 'string') return false;
  csrfToken = j.csrf_token;
  return true;
}

export async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  let res = await send(path, init);
  let detail = res.ok ? null : await detailOf(res);
  if (res.status === 403 && detail?.code === 'csrf_failed' && (await refreshCsrf())) {
    res = await send(path, init);
    detail = res.ok ? null : await detailOf(res);
  }
  if (detail) {
    const { code, retryAfter } = detail;
    const loss = code ? LOSS[code] : undefined;
    if (loss && (res.status === 401 || res.status === 403)) lossListeners.forEach((l) => l(loss));
    const kind: LoadError =
      code === 'conductor_unreachable' || (!code && res.status >= 502 && res.status <= 504) ? 'conductor' // proxy: conductor 꺼짐
      : code === 'gateway_unreachable' ? 'gateway'
      : code === 'gateway_auth_failed' ? 'gateway_auth'
      : code?.startsWith('gateway_') ? 'gateway_error'
      : 'server';
    throw new AdminApiError(kind, code, res.status, retryAfter);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => {
    throw new AdminApiError('server', 'bad_json');
  });
}

// 바꾸는 요청 (POST · PATCH · PUT · DELETE). body 가 있으면 JSON 본문
export const callJson = (path: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown) =>
  call(path, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// 오류 → 화면 상태 한 칸 (요청을 끊은 것은 오류가 아니다 → null)
export const loadErrorOf = (e: unknown): LoadError | null =>
  (e as Error).name === 'AbortError' ? null : e instanceof AdminApiError ? e.kind : 'server';
export const isConductorDown = (e: unknown) => e instanceof AdminApiError && e.kind === 'conductor';
export const codeOf = (e: unknown) => (e instanceof AdminApiError ? e.code : undefined);

// 응답 모양 검사 (서버를 믿지 않는다 — 모르는 칸은 기본값)
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
export const strOrNull = (v: unknown) => (typeof v === 'string' ? v : null);
export const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
export const objs = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : []);

export function expectObj(data: unknown): Record<string, unknown> {
  if (!isObj(data)) throw new AdminApiError('server', 'bad_shape');
  return data;
}
export function expectList(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) throw new AdminApiError('server', 'bad_shape');
  return objs(data);
}
