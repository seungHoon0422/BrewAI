// 사용량 = conductor GET /api/admin/usage · /api/admin/usage/gateway · /api/admin/stats (쿠키 · 읽기만).
// 숫자만 온다 (질문 · 답 · 대화 제목 없음 — 서버 usage_events 표에 그 칸이 없다). 기간 = 이 브라우저 시간대의 날짜 (tz 분)
import { call, expectObj, isObj, num, objs, str, strOrNull } from '../../shared/http';

export type UsageGroup = 'day' | 'org' | 'space' | 'user' | 'model';
export type UsageFilter = { org?: string; space?: string; user?: string; model?: string };
export type UsageSort = 'runs' | 'tokens' | 'cost';
// 토큰 종류 = 겹치지 않게 나눈 묶음 (입력 = 캐시 아닌 입력 · 출력 = 생각 뺀 출력). 순서 = 막대 왼쪽부터 · 색 칸 고정
export const TOKEN_KINDS = ['input', 'output', 'reasoning', 'cache_read', 'cache_write'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];
export type ByKind = Record<TokenKind, number>;
export type UsageTotals = {
  runs: number;
  ok: number;
  errors: number;
  cancelled: number;
  error_rate: number; // 0~1
  input_tokens: number;
  output_tokens: number;
  tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number; // 입력 안에 든 캐시 읽기
  cache_write_tokens: number; // 입력 안에 든 캐시 쓰기
  cache_hit_rate: number; // 캐시 읽기 / 입력 (0~1)
  tokens_by_kind: ByKind; // 합 = tokens
  requests: number;
  tool_calls: number;
  cost_usd: number | null; // 가격을 아는 실행만 더한 값 (하나도 모르면 null)
  cost_by_kind: ByKind | null; // 종류별 비용 (비용을 모르면 null)
  cost_runs: number;
  cost_estimated_runs: number; // 캐시 가격을 몰라 입력 가격으로 어림한 호출 수
  active_users: number;
  avg_duration_ms: number | null;
};
export type UsageDay = UsageTotals & { date: string };
export type UsageRow = UsageTotals & {
  key: string | null; // null = 알 수 없음 (지운 조직 등) · 스페이스 'personal' = 내 스페이스 전부
  label: string | null;
  sub: string | null;
  share: number; // 호출 비율 0~1
  kind: string | null; // 스페이스: personal | shared
  provider: string | null; // 모델
  org_id: string | null; // 스페이스가 속한 조직
};
export type UsageOthers = { count: number; runs: number; errors: number; tokens: number; cost_usd: number | null; share: number };
export type UsageSummary = {
  from: string;
  to: string;
  days: number;
  group: UsageGroup;
  totals: UsageTotals;
  previous: UsageTotals; // 바로 앞 같은 길이 기간 (series=false 면 0)
  series: UsageDay[];
  groups: UsageRow[];
  others: UsageOthers | null;
};

export type GatewayStatusKind = 'ok' | 'down' | 'error' | 'auth';
export type GatewayModelHealth = {
  id: string;
  label: string;
  provider: string;
  state: 'exposed' | 'candidate' | 'hidden' | 'missing';
  health: 'ok' | 'error' | 'unknown';
  health_code: string | null;
  health_at: string | null;
  runs: number;
  errors: number;
  error_rate: number;
};
export type GatewayStatus = {
  status: GatewayStatusKind;
  code: string | null;
  last_sync_at: string | null;
  models: { total: number; exposed: number; candidate: number; hidden: number; missing: number; failing: number };
  by_model: GatewayModelHealth[];
};
export type DirectoryStats = {
  users: { total: number; active: number; disabled: number; admins: number };
  orgs: number;
  spaces: { shared: number; archived: number; personal: number };
  invites_active: number;
  active_users: { d7: number; d30: number };
};

// 기간 = 오늘까지 days 일 (이 브라우저의 날짜 · 서버는 tz 로 하루를 자른다)
export function windowOf(days: number, now = new Date()) {
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  return { from: ymd(start), to: ymd(now), tz: String(-now.getTimezoneOffset()) };
}

const n0 = (v: unknown) => num(v) ?? 0;

function byKind(v: unknown): ByKind {
  const o = isObj(v) ? v : {};
  return Object.fromEntries(TOKEN_KINDS.map((k) => [k, n0(o[k])])) as ByKind;
}

function toTotals(t: unknown): UsageTotals {
  const o = isObj(t) ? t : {};
  return {
    runs: n0(o.runs), ok: n0(o.ok), errors: n0(o.errors), cancelled: n0(o.cancelled), error_rate: n0(o.error_rate),
    input_tokens: n0(o.input_tokens), output_tokens: n0(o.output_tokens), tokens: n0(o.tokens), reasoning_tokens: n0(o.reasoning_tokens),
    cache_read_tokens: n0(o.cache_read_tokens), cache_write_tokens: n0(o.cache_write_tokens), cache_hit_rate: n0(o.cache_hit_rate),
    tokens_by_kind: byKind(o.tokens_by_kind),
    requests: n0(o.requests), tool_calls: n0(o.tool_calls), cost_usd: num(o.cost_usd),
    cost_by_kind: isObj(o.cost_by_kind) && num(o.cost_usd) !== null ? byKind(o.cost_by_kind) : null,
    cost_runs: n0(o.cost_runs), cost_estimated_runs: n0(o.cost_estimated_runs),
    active_users: n0(o.active_users), avg_duration_ms: num(o.avg_duration_ms),
  };
}

const GROUPS: readonly UsageGroup[] = ['day', 'org', 'space', 'user', 'model'];

// series=false = 묶음 줄만 (지난 기간 · 하루별 흐름을 서버가 건너뛴다 → previous 0 · series [])
// sort = 묶음 줄 순서 (큰 것부터) · limit 으로 자른 나머지는 others
export type UsageQuery = { limit?: number; series?: boolean; sort?: UsageSort };

export async function getUsage(days: number, group: UsageGroup, filter: UsageFilter = {}, opts: UsageQuery = {}, signal?: AbortSignal): Promise<UsageSummary> {
  const { limit = 50, series = true, sort = 'runs' } = opts;
  const q = new URLSearchParams({
    ...windowOf(days), group, limit: String(limit), ...(series ? {} : { series: 'false' }), ...(sort === 'runs' ? {} : { sort }),
  });
  (Object.entries(filter) as [string, string | undefined][]).forEach(([k, v]) => v && q.set(k, v));
  const d = expectObj(await call(`/api/admin/usage?${q}`, { signal }));
  return {
    from: str(d.from), to: str(d.to), days: n0(d.days), group: GROUPS.find((g) => g === d.group) ?? group,
    totals: toTotals(d.totals), previous: toTotals(d.previous),
    series: objs(d.series).map((s) => ({ ...toTotals(s), date: str(s.date) })),
    groups: objs(d.groups).map((g) => ({
      ...toTotals(g), key: strOrNull(g.key), label: strOrNull(g.label), sub: strOrNull(g.sub), share: n0(g.share),
      kind: strOrNull(g.kind), provider: strOrNull(g.provider), org_id: strOrNull(g.org_id),
    })),
    others: isObj(d.others) ? {
      count: n0(d.others.count), runs: n0(d.others.runs), errors: n0(d.others.errors), tokens: n0(d.others.tokens), cost_usd: num(d.others.cost_usd), share: n0(d.others.share),
    } : null,
  };
}

const KINDS: readonly GatewayStatusKind[] = ['ok', 'down', 'error', 'auth'];
const MSTATES = ['exposed', 'candidate', 'hidden', 'missing'] as const;
const HEALTH = ['ok', 'error', 'unknown'] as const;

export async function getGatewayStatus(days: number, signal?: AbortSignal): Promise<GatewayStatus> {
  const q = new URLSearchParams(windowOf(days));
  const d = expectObj(await call(`/api/admin/usage/gateway?${q}`, { signal }));
  const m = isObj(d.models) ? d.models : {};
  return {
    status: KINDS.find((k) => k === d.status) ?? 'error',
    code: strOrNull(d.code),
    last_sync_at: strOrNull(d.last_sync_at),
    models: { total: n0(m.total), exposed: n0(m.exposed), candidate: n0(m.candidate), hidden: n0(m.hidden), missing: n0(m.missing), failing: n0(m.failing) },
    by_model: objs(d.by_model).map((r) => ({
      id: str(r.id), label: str(r.label, str(r.id)), provider: str(r.provider, 'other'),
      state: MSTATES.find((s) => s === r.state) ?? 'hidden', health: HEALTH.find((h) => h === r.health) ?? 'unknown',
      health_code: strOrNull(r.health_code), health_at: strOrNull(r.health_at), runs: n0(r.runs), errors: n0(r.errors), error_rate: n0(r.error_rate),
    })),
  };
}

export async function getStats(signal?: AbortSignal): Promise<DirectoryStats> {
  const d = expectObj(await call('/api/admin/stats', { signal }));
  const u = isObj(d.users) ? d.users : {};
  const s = isObj(d.spaces) ? d.spaces : {};
  const a = isObj(d.active_users) ? d.active_users : {};
  return {
    users: { total: n0(u.total), active: n0(u.active), disabled: n0(u.disabled), admins: n0(u.admins) },
    orgs: n0(d.orgs),
    spaces: { shared: n0(s.shared), archived: n0(s.archived), personal: n0(s.personal) },
    invites_active: n0(d.invites_active),
    active_users: { d7: n0(a.d7), d30: n0(a.d30) },
  };
}
