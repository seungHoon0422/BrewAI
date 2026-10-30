// 최근 실행 = GET /api/runs (다른 창 · 지난 실행 포함). 이 창에서 지금 도는 실행은 chat/hooks.ts store 가 실시간으로 준다.
import { isObj, json, num, reasoningOf, str, strOrNull, type Reasoning } from '../../lib/api';
import { toSteps, toUsage, type Step, type Usage } from '../chat/api';
import { UNTITLED } from '../chat/copy';

export type RunStatus = 'running' | 'done' | 'error' | 'cancelled';
export type RunRow = {
  id: string;
  thread_id: string;
  thread_title: string;
  status: RunStatus;
  model: string;
  model_label: string;
  provider: string;
  provider_label: string;
  reasoning: Reasoning;
  steps: Step[];
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error_code: string | null;
  usage: Usage;
};

export async function listRuns(signal?: AbortSignal): Promise<RunRow[]> {
  const data = await json('/api/runs?limit=30', signal);
  if (!Array.isArray(data)) return [];
  return data.filter((r) => isObj(r) && typeof r.id === 'string').map((x) => {
    const r = x as Record<string, unknown>;
    return {
      id: r.id as string,
      thread_id: str(r.thread_id),
      thread_title: str(r.thread_title).trim() || UNTITLED,
      status: (['running', 'done', 'error', 'cancelled'] as const).find((s) => s === r.status) ?? 'done',
      model: str(r.model),
      model_label: str(r.model_label, str(r.model)),
      provider: str(r.provider, 'other'),
      provider_label: str(r.provider_label),
      reasoning: reasoningOf(r.reasoning),
      steps: toSteps(r.steps),
      started_at: str(r.started_at),
      finished_at: strOrNull(r.finished_at),
      duration_ms: num(r.duration_ms),
      error_code: strOrNull(r.error_code),
      usage: toUsage(r.usage),
    };
  });
}
