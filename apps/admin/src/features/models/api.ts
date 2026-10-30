// 모델 = conductor /api/admin/models* (게이트웨이와 동기화한 model_exposure, ADR-0006). fetch 와 응답 모양 검사만 한다.
// 모델 등록은 LiteLLM 에서만. 여기서 바꾸는 것 = 노출 · 표시 이름 · 순서 · 기본 모델 (PATCH 가 다른 칸은 422 로 거절)
import { AdminApiError, call, expectObj, isObj, num, str, strOrNull, strs } from '../../shared/http';

export type ModelState = 'exposed' | 'candidate' | 'hidden' | 'missing';
export type AdminModel = {
  id: string;
  label: string; // 보이는 이름 = display_name ?? default_label
  display_name: string | null;
  default_label: string;
  family: string | null;
  provider: string; // 아이콘 키 (@brewai/ui ProviderIcon)
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
  // ↓ 연결 상태 (conductor 가 본 것: 대화 결과 · 연결 시험). last_error_code = 실패 이유 (copy.ts ERROR_DETAIL)
  last_ok_at: string | null;
  last_error_code: string | null;
  last_error_at: string | null;
};
// POST /api/admin/models/{id}/test — 짧은 호출 한 번
export type ProbeResult = { model: string; ok: boolean; code: string | null; detail: string | null; status: number | null; at: string; duration_ms: number };
export type ModelPatch = Partial<Pick<AdminModel, 'exposed' | 'display_name' | 'order' | 'is_default'>>;
export type SyncResult = { added: string[]; missing: string[]; restored: string[]; first_sync: boolean; synced_at: string; models: AdminModel[] };
export type GatewayInfo = { kind: string; url: string; ui_url: string; last_sync_at: string | null };

const STATES: readonly ModelState[] = ['exposed', 'candidate', 'hidden', 'missing'];

function toModel(m: Record<string, unknown>, i: number): AdminModel {
  const exposed = m.exposed === true;
  const status = m.status === 'missing' ? 'missing' : 'present';
  // 예전 conductor(slice 02)는 state 를 안 준다 → exposed 로 짐작
  const state = STATES.find((s) => s === m.state) ?? (status === 'missing' ? 'missing' : exposed ? 'exposed' : 'hidden');
  return {
    id: str(m.id),
    label: str(m.label, str(m.id)),
    display_name: strOrNull(m.display_name),
    default_label: str(m.default_label, str(m.label, str(m.id))),
    family: strOrNull(m.family),
    provider: str(m.provider, 'other'),
    provider_label: str(m.provider_label),
    provider_ids: strs(m.provider_ids),
    state,
    status,
    exposed,
    is_default: m.is_default === true,
    order: num(m.order) ?? i + 1,
    is_chat: m.is_chat !== false,
    first_seen: str(m.first_seen),
    last_seen: str(m.last_seen),
    mode: strOrNull(m.mode),
    max_input_tokens: num(m.max_input_tokens),
    max_output_tokens: num(m.max_output_tokens),
    input_cost_per_token: num(m.input_cost_per_token),
    output_cost_per_token: num(m.output_cost_per_token),
    supports_function_calling: m.supports_function_calling === true,
    supports_vision: m.supports_vision === true,
    supports_reasoning: m.supports_reasoning === true,
    source: m.source === 'config' || m.source === 'ui' || m.source === 'mixed' ? m.source : null,
    last_ok_at: strOrNull(m.last_ok_at),
    last_error_code: strOrNull(m.last_error_code),
    last_error_at: strOrNull(m.last_error_at),
  };
}

const toModels = (data: unknown): AdminModel[] => {
  if (!Array.isArray(data)) throw new AdminApiError('server', 'bad_shape');
  return data.filter((m): m is Record<string, unknown> => isObj(m) && typeof m.id === 'string').map(toModel);
};

// id 에 / 가 있을 수 있다 (예: vertex_ai/gemini-2.5-pro). 조각마다 인코딩해 경로 모양은 그대로
const modelPath = (id: string) => id.split('/').map(encodeURIComponent).join('/');

// 부를 때마다 게이트웨이와 동기화한다 (conductor 쪽). 새 모델 = 후보(숨김), 사라진 모델 = missing
export async function listAdminModels(signal?: AbortSignal): Promise<AdminModel[]> {
  return toModels(await call('/api/admin/models', { signal }));
}

export async function patchModel(id: string, patch: ModelPatch): Promise<AdminModel> {
  const data = await call(`/api/admin/models/${modelPath(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return toModel(expectObj(data), 0);
}

export async function testModel(id: string): Promise<ProbeResult> {
  const data = expectObj(await call(`/api/admin/models/${modelPath(id)}/test`, { method: 'POST' }));
  return {
    model: str(data.model, id), ok: data.ok === true, code: strOrNull(data.code), detail: strOrNull(data.detail), status: num(data.status),
    at: str(data.at), duration_ms: num(data.duration_ms) ?? 0,
  };
}

export async function syncModels(): Promise<SyncResult> {
  const data = expectObj(await call('/api/admin/models/sync', { method: 'POST' }));
  return {
    added: strs(data.added), missing: strs(data.missing), restored: strs(data.restored),
    first_sync: data.first_sync === true, synced_at: str(data.synced_at), models: toModels(data.models),
  };
}

export async function getGateway(signal?: AbortSignal): Promise<GatewayInfo> {
  const data = expectObj(await call('/api/admin/gateway', { signal }));
  return { kind: str(data.kind, 'litellm'), url: str(data.url), ui_url: str(data.ui_url), last_sync_at: strOrNull(data.last_sync_at) };
}
