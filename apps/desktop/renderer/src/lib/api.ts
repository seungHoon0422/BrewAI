// conductor API 공통 — 주소 · 요청 · 실패 종류 · 응답 읽기 도우미. 기능별 요청은 features/<이름>/api.ts 에.
// 주소는 main 이 app://brewai/config.json 으로 준다 (개발 중엔 Vite 가 같은 모양으로).
// 키는 없다. 게이트웨이·Langfuse 는 conductor 만 안다 (AGENTS.md). 로그인 토큰도 없다 — main 이 Authorization 을 붙이고,
// 401 이면 main 에 한 번 새로 고침을 부탁하고 한 번만 다시 보낸다 (ADR-0010). 그래도 401 = 'auth' (화면은 로그인 게이트).
// BrewAI 가 정한 JSON(REST · CUSTOM value) 은 snake_case, AG-UI 자체 필드는 camelCase (conductor 계약).

import { viaBridge } from './bridge';

export type Reasoning = 'off' | 'low' | 'high';

// 화면이 보여 줄 실패 종류. 서버 글을 그대로 띄우지 않고 code → 문구로 바꾼다 (features/chat/copy.ts)
export type Failure =
  | 'offline' | 'gateway' | 'config' | 'no_models' | 'model_gone' | 'busy' | 'too_long' | 'run_limit' | 'not_found' | 'cut' | 'server'
  | 'auth' | 'forbidden' | 'conflict';
// detail = 왜 안 됐는지 (RUN_ERROR.detail · conductor diagnose.py DETAILS) → 화면 문구 + 고치는 곳 (features/chat/copy.ts DETAIL)
// raw = 모델 · 게이트웨이가 준 거절 원문 (RUN_ERROR.provider_message · 서버가 키를 가린 뒤) = 실패 카드에 그대로
export class ApiError extends Error {
  constructor(readonly kind: Failure, readonly code?: string, readonly detail?: string, readonly raw?: string) {
    super(code ?? kind);
  }
}

// *_auth_failed · provider_rejected = 설정 문제 (다시 해도 안 됨) · 나머지 gateway_* = 게이트웨이 문제 (잠시 뒤 다시)
// status: 401 = 로그인 필요 · 403 = 보이지만 이 행동은 안 됨 · 404 = 안 보임 · 409 = 상태 때문에 막힘 (conductor 계약)
// 404 · 409 는 코드가 아니라 상태로 나눈다 → 층(스페이스 · 프로젝트 …)을 넣거나 이름을 바꿔도 여기는 그대로 (ADR-0012)
export const kindOf = (code?: string, status?: number): Failure =>
  status === 401 ? 'auth'
  : status === 403 ? 'forbidden'
  : code === 'no_models' ? 'no_models'
  : code === 'unknown_model' ? 'model_gone' // 숨김 · 사라짐 · 없는 모델 (서버가 일부러 구분하지 않는다)
  : code === 'thread_busy' ? 'busy'
  : code === 'message_too_long' ? 'too_long'
  : code === 'run_limit' ? 'run_limit'
  : code && /^(gateway|provider)_auth_failed$|^provider_rejected$/.test(code) ? 'config'
  : code?.startsWith('gateway_') ? 'gateway'
  : status === 404 ? 'not_found'
  : status === 409 ? 'conflict'
  : 'server';

export const failureOf = (e: unknown): Failure => (e instanceof ApiError ? e.kind : 'server');
export const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';

let base: Promise<string | null> | undefined;
export function apiBase(): Promise<string | null> {
  base ??= fetch('./config.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { apiUrl?: unknown } | null) => (typeof j?.apiUrl === 'string' ? j.apiUrl : null))
    .catch(() => null);
  return base;
}

export async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const b = await apiBase();
  if (!b) throw new ApiError('offline', 'no_api_url');
  const once = async () => {
    try {
      return await fetch(new URL(path, b), { ...init, credentials: 'omit', redirect: 'error' });
    } catch (e) {
      if (isAbort(e)) throw e;
      throw new ApiError('offline'); // 꺼짐 · CORS 거절 · CSP 차단 = 모두 TypeError
    }
  };
  let res = await once();
  // access 만료 → main 이 refresh 를 한 번 (동시 401 도 POST 하나) → 다시 한 번. 실패면 main 이 게이트를 띄운다
  if (res.status === 401 && (await viaBridge((br) => br.auth.refresh(), false))) res = await once();
  if (!res.ok) {
    const code = await res.json().then((j: { detail?: unknown }) => (typeof j.detail === 'string' ? j.detail : undefined), () => undefined);
    throw new ApiError(kindOf(code, res.status), code);
  }
  return res;
}

// JSON 보내고 JSON 받기 (204 = null). PATCH · POST · PUT · DELETE 공통
export async function send(path: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown): Promise<unknown> {
  const res = await call(path, {
    method,
    headers: body === undefined ? { accept: 'application/json' } : { 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    throw new ApiError('server', 'bad_json');
  }
}

// 실패의 conductor 코드 (화면이 코드 → 문구로 바꾼다)
export const codeOf = (e: unknown): string | undefined => (e instanceof ApiError ? e.code ?? e.kind : undefined);

export async function json(path: string, signal?: AbortSignal): Promise<unknown> {
  const res = await call(path, { signal });
  try {
    return await res.json();
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError('server', 'bad_json');
  }
}

// 응답 읽기 — 모르는 모양이어도 화면이 깨지지 않게 칸마다 기본값
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
export const reasoningOf = (v: unknown): Reasoning => (v === 'low' || v === 'high' ? v : 'off');
export const bool = (v: unknown): boolean => v === true;
export const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObj) : []);
