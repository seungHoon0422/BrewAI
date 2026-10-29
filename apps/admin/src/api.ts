// api.ts — 관리자 콘솔 → conductor 관리자 API (/api/admin/*). 주소 = 빌드할 때 VITE_BREWAI_API_URL (기본 http://127.0.0.1:8787).
// 관리자 콘솔은 게이트웨이를 직접 부르지 않는다 (키는 conductor 만, ADR-0006).
// 모델 등록은 LiteLLM 에서만. 여기서 바꾸는 것 = 노출 · 표시 이름 · 순서 · 기본 모델 (PATCH 가 다른 칸은 422 로 거절)
export const API_URL = (import.meta.env.VITE_BREWAI_API_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');

export type ModelState = 'exposed' | 'candidate' | 'hidden' | 'missing';
export type AdminModel = {
  id: string;
  label: string; // 보이는 이름 = display_name ?? default_label
  display_name: string | null;
  default_label: string;
  family: string | null;
  provider: string; // 아이콘 키 (providers.tsx)
  provider_label: string;
  provider_ids: string[];
  state: ModelState;
  status: 'present' | 'missing';
  exposed: boolean;
  is_default: boolean;
  order: number; // 표 위치 (1부터)
  is_chat: boolean;
  first_seen: string;
  last_seen: string;
  // ↓ 게이트웨이 값 (읽기 전용 · 보여 주기만)
  mode: string | null;
  max_input_tokens: number | null;
  max_output_tokens: number | null;
  input_cost_per_token: number | null;
  output_cost_per_token: number | null;
  supports_function_calling: boolean;
  supports_vision: boolean;
  supports_reasoning: boolean;
  source: 'config' | 'ui' | 'mixed' | null; // 등록 출처 (LiteLLM model_info.db_model) · null = 모름
  // ↓ 연결 상태 (conductor 가 본 것: 대화 결과 · 연결 시험). last_error_code = 실패 이유 (Models.tsx ERROR_DETAIL)
  last_ok_at: string | null;
  last_error_code: string | null;
  last_error_at: string | null;
};
// POST /api/admin/models/{id}/test — 짧은 호출 한 번
export type ProbeResult = { model: string; ok: boolean; code: string | null; detail: string | null; status: number | null; at: string; duration_ms: number };
// GET /api/admin/skills — 제품 스킬 카탈로그 (읽기 전용)
export type AdminSkill = {
  name: string; label: string; description: string; tools: string[]; version: string; source: string; builtin: boolean; used: number; lines: number;
};
export type SkillCatalog = { source: string; skills: AdminSkill[]; errors: { dir: string; code: string; message: string }[] };
export type ModelPatch = Partial<Pick<AdminModel, 'exposed' | 'display_name' | 'order' | 'is_default'>>;
export type SyncResult = { added: string[]; missing: string[]; restored: string[]; first_sync: boolean; synced_at: string; models: AdminModel[] };
export type GatewayInfo = { kind: string; url: string; ui_url: string; last_sync_at: string | null };

// gateway = 게이트웨이가 안 받음 · gateway_error = 떠 있는데 오류(500 · 이상한 응답) · gateway_auth = 키 틀림
export type LoadError = 'conductor' | 'gateway' | 'gateway_error' | 'gateway_auth' | 'server';

export class AdminApiError extends Error {
  constructor(readonly kind: LoadError, readonly code?: string, readonly status?: number) {
    super(code ?? kind);
  }
}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, credentials: 'omit' });
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
    throw new AdminApiError(kind, code, res.status);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => {
    throw new AdminApiError('server', 'bad_json');
  });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const STATES: readonly ModelState[] = ['exposed', 'candidate', 'hidden', 'missing'];

function toModel(m: Record<string, unknown>, i: number): AdminModel {
  const exposed = m.exposed === true;
  const status = m.status === 'missing' ? 'missing' : 'present';
  // 예전 conductor(slice 02)는 state 를 안 준다 → exposed 로 짐작
  const state = STATES.find((s) => s === m.state) ?? (status === 'missing' ? 'missing' : exposed ? 'exposed' : 'hidden');
  return {
    id: str(m.id),
    label: str(m.label, str(m.id)),
    display_name: typeof m.display_name === 'string' ? m.display_name : null,
    default_label: str(m.default_label, str(m.label, str(m.id))),
    family: typeof m.family === 'string' ? m.family : null,
    provider: str(m.provider, 'other'),
    provider_label: str(m.provider_label),
    provider_ids: Array.isArray(m.provider_ids) ? m.provider_ids.filter((p): p is string => typeof p === 'string') : [],
    state,
    status,
    exposed,
    is_default: m.is_default === true,
    order: num(m.order) ?? i + 1,
    is_chat: m.is_chat !== false,
    first_seen: str(m.first_seen),
    last_seen: str(m.last_seen),
    mode: typeof m.mode === 'string' ? m.mode : null,
    max_input_tokens: num(m.max_input_tokens),
    max_output_tokens: num(m.max_output_tokens),
    input_cost_per_token: num(m.input_cost_per_token),
    output_cost_per_token: num(m.output_cost_per_token),
    supports_function_calling: m.supports_function_calling === true,
    supports_vision: m.supports_vision === true,
    supports_reasoning: m.supports_reasoning === true,
    source: m.source === 'config' || m.source === 'ui' || m.source === 'mixed' ? m.source : null,
    last_ok_at: typeof m.last_ok_at === 'string' ? m.last_ok_at : null,
    last_error_code: typeof m.last_error_code === 'string' ? m.last_error_code : null,
    last_error_at: typeof m.last_error_at === 'string' ? m.last_error_at : null,
  };
}

const toModels = (data: unknown): AdminModel[] => {
  if (!Array.isArray(data)) throw new AdminApiError('server', 'bad_shape');
  return data.filter((m): m is Record<string, unknown> => isObj(m) && typeof m.id === 'string').map(toModel);
};

// 부를 때마다 게이트웨이와 동기화한다 (conductor 쪽). 새 모델 = 후보(숨김), 사라진 모델 = missing
export async function listAdminModels(signal?: AbortSignal): Promise<AdminModel[]> {
  return toModels(await call('/api/admin/models', { signal }));
}

export async function patchModel(id: string, patch: ModelPatch): Promise<AdminModel> {
  // id 에 / 가 있을 수 있다 (예: vertex_ai/gemini-2.5-pro). 조각마다 인코딩해 경로 모양은 그대로
  const path = id.split('/').map(encodeURIComponent).join('/');
  const data = await call(`/api/admin/models/${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!isObj(data)) throw new AdminApiError('server', 'bad_shape');
  return toModel(data, 0);
}

const modelPath = (id: string) => id.split('/').map(encodeURIComponent).join('/');

export async function testModel(id: string): Promise<ProbeResult> {
  const data = await call(`/api/admin/models/${modelPath(id)}/test`, { method: 'POST' });
  if (!isObj(data)) throw new AdminApiError('server', 'bad_shape');
  const s = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    model: str(data.model, id), ok: data.ok === true, code: s(data.code), detail: s(data.detail), status: num(data.status),
    at: str(data.at), duration_ms: num(data.duration_ms) ?? 0,
  };
}

export async function listAdminSkills(signal?: AbortSignal): Promise<SkillCatalog> {
  const data = await call('/api/admin/skills', { signal });
  if (!isObj(data) || !Array.isArray(data.skills)) throw new AdminApiError('server', 'bad_shape');
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    source: str(data.source, 'runtime/skills'),
    skills: data.skills.filter(isObj).map((k) => ({
      name: str(k.name), label: str(k.label, str(k.name)), description: str(k.description), tools: strs(k.tools),
      version: str(k.version), source: str(k.source), builtin: k.builtin === true, used: num(k.used) ?? 0, lines: num(k.lines) ?? 0,
    })),
    errors: Array.isArray(data.errors)
      ? data.errors.filter(isObj).map((e) => ({ dir: str(e.dir), code: str(e.code), message: str(e.message) }))
      : [],
  };
}

export async function syncModels(): Promise<SyncResult> {
  const data = await call('/api/admin/models/sync', { method: 'POST' });
  if (!isObj(data)) throw new AdminApiError('server', 'bad_shape');
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    added: ids(data.added), missing: ids(data.missing), restored: ids(data.restored),
    first_sync: data.first_sync === true, synced_at: str(data.synced_at), models: toModels(data.models),
  };
}

export async function getGateway(signal?: AbortSignal): Promise<GatewayInfo> {
  const data = await call('/api/admin/gateway', { signal });
  if (!isObj(data)) throw new AdminApiError('server', 'bad_shape');
  return { kind: str(data.kind, 'litellm'), url: str(data.url), ui_url: str(data.ui_url), last_sync_at: typeof data.last_sync_at === 'string' ? data.last_sync_at : null };
}
