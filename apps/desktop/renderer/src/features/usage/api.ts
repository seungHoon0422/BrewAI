// 내 사용량 (설정 › 사용량) = conductor GET /api/me/usage (나로 고정 · 숫자만). 모양은 관리자 사용량과 같다 (conductor/usage.py summary)
// 세부 보기: 묶음(group) = 모델 · 프로젝트 · 스페이스 · 조직 · 거르개(filters)는 서버가 늘 '나' 위에 더한다
import { isObj, json, list, num, str, strOrNull } from '../../lib/api';

export type Days = 7 | 30 | 90;
export type Dim = 'model' | 'project' | 'space' | 'org';
export type Filters = Partial<Record<Dim, { key: string; label: string }>>;
export type Totals = {
  runs: number; errors: number; error_rate: number; tokens: number; input_tokens: number; output_tokens: number;
  cache_hit_rate: number; cost_usd: number | null; cost_runs: number; tool_calls: number; avg_duration_ms: number | null;
};
export type DayRow = { date: string; runs: number; tokens: number };
export type GroupRow = Totals & { key: string; label: string | null; sub: string | null; kind: string | null; provider: string | null; share: number };
export type Usage = { totals: Totals; previous: Totals | null; series: DayRow[]; groups: GroupRow[]; others: number };

const n = (v: unknown) => num(v) ?? 0;
function toTotals(v: unknown): Totals {
  const t = isObj(v) ? v : {};
  return {
    runs: n(t.runs), errors: n(t.errors), error_rate: n(t.error_rate), tokens: n(t.tokens), input_tokens: n(t.input_tokens),
    output_tokens: n(t.output_tokens), cache_hit_rate: n(t.cache_hit_rate), cost_usd: num(t.cost_usd), cost_runs: n(t.cost_runs),
    tool_calls: n(t.tool_calls), avg_duration_ms: num(t.avg_duration_ms),
  };
}
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 기간 = 오늘을 포함한 지난 days 일 (이 PC 시간대)
export function windowOf(days: Days, now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  return { from: ymd(start), to: ymd(now), tz: String(-now.getTimezoneOffset()) };
}

export async function getMyUsage(days: Days, group: 'day' | Dim, filters: Filters, signal?: AbortSignal): Promise<Usage> {
  const q = new URLSearchParams({ ...windowOf(days), group, sort: 'runs', limit: '20', series: String(group === 'day') });
  for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v.key);
  const d = await json(`/api/me/usage?${q}`, signal);
  const o = isObj(d) ? d : {};
  return {
    totals: toTotals(o.totals),
    previous: isObj(o.previous) ? toTotals(o.previous) : null,
    series: list(o.series).map((r) => ({ date: str(r.date), runs: n(r.runs), tokens: n(r.tokens) })),
    groups: list(o.groups).map((g) => ({
      ...toTotals(g), key: str(g.key), label: strOrNull(g.label), sub: strOrNull(g.sub), kind: strOrNull(g.kind), provider: strOrNull(g.provider),
      share: n(g.share),
    })),
    others: isObj(o.others) ? n(o.others.count) : 0,
  };
}
