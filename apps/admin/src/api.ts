// api.ts — 관리자 콘솔 → conductor 관리자 API (/api/admin/*). 주소 = 빌드할 때 VITE_BREWAI_API_URL (기본 http://127.0.0.1:8787).
// 관리자 콘솔은 게이트웨이를 직접 부르지 않는다 (키는 conductor 만, ADR-0006).
export const API_URL = (import.meta.env.VITE_BREWAI_API_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');

// 표에 쓰는 것만. conductor 가 더 주는 칸(가격·컨텍스트 …)은 slice 02 에서 안 보여 준다 (Models.tsx 주석)
export type AdminModel = { id: string; label: string; exposed: boolean };
// gateway = 게이트웨이가 안 받음 · gateway_error = 떠 있는데 오류(500 · 이상한 응답) · gateway_auth = 키 틀림
export type LoadError = 'conductor' | 'gateway' | 'gateway_error' | 'gateway_auth' | 'server';

export class AdminApiError extends Error {
  constructor(readonly kind: LoadError, readonly code?: string) {
    super(code ?? kind);
  }
}

export async function listAdminModels(signal?: AbortSignal): Promise<AdminModel[]> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/admin/models`, { signal, credentials: 'omit' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new AdminApiError('conductor'); // 꺼짐 · CORS 거절 = TypeError
  }
  if (!res.ok) {
    const code = await res.json().then((j: { detail?: unknown }) => (typeof j.detail === 'string' ? j.detail : undefined), () => undefined);
    const kind: LoadError =
      code === 'gateway_unreachable' ? 'gateway'
      : code === 'gateway_auth_failed' ? 'gateway_auth'
      : code?.startsWith('gateway_') ? 'gateway_error'
      : 'server';
    throw new AdminApiError(kind, code);
  }
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new AdminApiError('server', 'bad_shape');
  return data.filter((m): m is AdminModel => typeof m?.id === 'string' && typeof m?.label === 'string' && typeof m?.exposed === 'boolean');
}
