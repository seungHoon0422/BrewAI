// 모델 목록 = GET /api/models (노출된 대화 모델만). 순서 = 관리자가 정한 전체 순서 그대로 (화면은 다시 묶거나 정렬하지 않는다).
// 모델을 등록하는 화면 · 요청은 없다 (AGENTS.md) — 우리는 고르기만.
import { isObj, json, num, str, strOrNull } from '../../lib/api';

export type ModelSource = 'config' | 'ui' | 'mixed' | null;
export type ModelHealth = 'ok' | 'error' | 'unknown';

export type Model = {
  id: string;
  label: string;
  provider: string; // 아이콘 키 (@brewai/ui ProviderIcon)
  provider_label: string;
  family: string | null;
  is_default: boolean;
  supports_reasoning: boolean;
  supports_tools: boolean;
  supports_vision: boolean;
  max_input_tokens: number | null;
  max_output_tokens: number | null;
  source: ModelSource; // 등록 출처 (LiteLLM model_info.db_model) · null = 모름
  health: ModelHealth; // 마지막 연결 결과 (대화 · 관리자 연결 시험). error 여도 고를 수 있다 — 경고만
  health_code: string | null; // 실패 이유 (copy.ts HEALTH_SHORT)
  health_at: string | null;
};

export async function listModels(signal?: AbortSignal): Promise<Model[]> {
  const data = await json('/api/models', signal);
  if (!Array.isArray(data)) return [];
  return data
    .filter((m): m is Record<string, unknown> => isObj(m) && typeof m.id === 'string' && typeof m.label === 'string')
    .map((m) => ({
      id: m.id as string,
      label: (m.label as string).trim() || (m.id as string),
      provider: str(m.provider, 'other'),
      provider_label: str(m.provider_label),
      family: strOrNull(m.family),
      is_default: m.is_default === true,
      supports_reasoning: m.supports_reasoning === true,
      supports_tools: m.supports_tools === true,
      supports_vision: m.supports_vision === true,
      max_input_tokens: num(m.max_input_tokens),
      max_output_tokens: num(m.max_output_tokens),
      source: m.source === 'config' || m.source === 'ui' || m.source === 'mixed' ? m.source : null,
      health: m.health === 'ok' || m.health === 'error' ? m.health : 'unknown',
      health_code: strOrNull(m.health_code),
      health_at: strOrNull(m.health_at),
    }));
}
