// 모델 목록에서 화면 값을 계산한다 (순수 함수 · 상태 없음). hooks.ts · 컴포넌트가 같이 쓴다.
// 묶음 순서 = 처음 나온 회사 순서 (사용자 앱 모델 메뉴와 같은 규칙 — 기본 모델은 메뉴에서 맨 위).
// 화면의 순서 숫자 = 그 회사 묶음 안 자리 (1 · 2 …). ↑↓ · 끌기 모두 같은 회사 안에서만 옮긴다.
import { providerLabel } from '@brewai/ui';
import type { AdminModel } from './api';
import { COL_LABEL, COPY, ERROR_DETAIL, FIX_HINT, UNKNOWN_ERROR_HINT, type StateFilter } from './copy';

// 표 칸 (E2E: 순서). 글 = copy.ts COL_LABEL · 정보 = 좁은 창(<1100)에선 숨김 (서랍에 있다)
export const COL_IDS = ['select', 'order', 'model', 'state', 'exposed', 'default', 'health', 'info'] as const;
export type ColId = (typeof COL_IDS)[number];
export const COL_LABELS = COL_IDS.map((id) => COL_LABEL[id]);

// 같은 표시 이름: user = 둘 다 노출이라 사용자 앱에서 겹친다 · hidden = 한쪽이 숨김이라 지금은 안 겹친다
export type Dup = 'user' | 'hidden' | null;
export type ProviderGroup = { id: string; label: string; rows: AdminModel[] };
export type ProviderSummary = { id: string; label: string; total: number; exposed: number };

export const providerName = (m: Pick<AdminModel, 'provider' | 'provider_label'>) => providerLabel(m.provider, m.provider_label);

// 128000 → 128K · 1000000 → 1M
export const tokens = (n: number | null) =>
  n == null ? null : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
// 토큰당 → 100만 토큰당 달러 (게이트웨이 가격표 스냅샷)
const perM = (c: number | null) => {
  if (c == null) return null;
  const n = c * 1_000_000;
  return `$${n > 0 && n < 1 ? n.toFixed(2) : +n.toFixed(2)}`; // $0.15 · $0.60 · $3 · $15
};

export function ago(iso: string | null, now: number) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const s = Math.round((now - t) / 1000);
  if (s < 45) return COPY.ago.now;
  if (s < 3600) return COPY.ago.min(Math.max(1, Math.round(s / 60)));
  if (s < 86400) return COPY.ago.hour(Math.round(s / 3600));
  return new Date(t).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// 마지막 연결 결과 = 대화 · 연결 시험 중 나중 것
export const failed = (m: AdminModel) => !!m.last_error_at && (!m.last_ok_at || m.last_error_at > m.last_ok_at);
export const canExpose = (m: AdminModel) => m.is_chat && m.status !== 'missing';
export const canProbe = (m: AdminModel) => m.is_chat && m.status === 'present';

const norm = (s: string) => s.normalize('NFC').toLowerCase();
const labelKey = (s: string) => norm(s).replace(/\s+/g, '');

// 게이트웨이 값 → 짧은 낱말들 (정보 칸 · 서랍 '기능')
export const info = (m: AdminModel) => [
  !m.is_chat ? `${m.mode === 'embedding' ? COPY.info.embedding : m.mode ?? COPY.info.notChat} · ${COPY.info.unused}` : '',
  tokens(m.max_input_tokens) ? COPY.info.context(tokens(m.max_input_tokens)!) : '',
  m.supports_function_calling ? COPY.info.tools : '',
  m.supports_reasoning ? COPY.info.reasoning : '',
  m.supports_vision ? COPY.info.vision : '',
].filter(Boolean);
export const priceOf = (m: AdminModel) => (m.input_cost_per_token != null || m.output_cost_per_token != null
  ? `${perM(m.input_cost_per_token) ?? '—'} / ${perM(m.output_cost_per_token) ?? '—'}`
  : null);

export const errorOf = (code: string) =>
  (Object.prototype.hasOwnProperty.call(ERROR_DETAIL, code) ? ERROR_DETAIL[code] : undefined) ?? { short: code, hint: UNKNOWN_ERROR_HINT };

// 고치는 곳은 아는 만큼 좁힌다: 등록한 곳(config.yaml · 관리 화면) × 회사 → .env 키 이름 · LiteLLM 화면
const ENV_KEY: Record<string, string> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', google: 'GEMINI_API_KEY' };
const envKey = (provider: string) => ENV_KEY[provider] ?? `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
const KEY_CODES = new Set(['provider_key_missing', 'provider_key_invalid', 'provider_auth_failed']);
export function fixFor(m: Pick<AdminModel, 'source' | 'provider'>, code: string): { short: string; hint: string; litellm: boolean } {
  const e = errorOf(code);
  if (KEY_CODES.has(code)) {
    if (m.source === 'config') return { short: e.short, hint: FIX_HINT.configKey(envKey(m.provider)), litellm: false };
    if (m.source === 'ui') return { short: e.short, hint: FIX_HINT.uiKey, litellm: true };
  }
  if (code === 'provider_model_not_found' && m.source === 'config') return { short: e.short, hint: FIX_HINT.configModel, litellm: false };
  return { ...e, litellm: e.hint.includes(FIX_HINT.litellmMarker) };
}

export type Counts = { exposed: number; hidden: number; candidate: number; missing: number; problem: number; untested: number };
export function countsOf(rows: readonly AdminModel[]): Counts {
  const present = rows.filter((r) => r.status === 'present');
  return {
    exposed: present.filter((r) => r.state === 'exposed').length,
    hidden: present.filter((r) => r.state === 'hidden').length,
    candidate: present.filter((r) => r.state === 'candidate').length,
    missing: rows.filter((r) => r.state === 'missing').length,
    problem: present.filter(failed).length,
    untested: present.filter((r) => r.exposed && r.is_chat && !r.last_ok_at && !r.last_error_at).length,
  };
}

// 같은 표시 이름 (대소문자 · 공백 무시). 둘 다 노출일 때만 사용자 앱에서 헷갈린다 (숨긴 쪽은 사용자가 못 본다)
export function dupIndex(rows: readonly AdminModel[]): (m: AdminModel) => Dup {
  const twins = new Map<string, AdminModel[]>();
  for (const r of rows) if (r.status === 'present') twins.set(labelKey(r.label), [...(twins.get(labelKey(r.label)) ?? []), r]);
  return (m) => {
    const others = m.status === 'present' ? (twins.get(labelKey(m.label)) ?? []).filter((r) => r.id !== m.id) : [];
    if (!others.length) return null;
    return m.exposed && others.some((r) => r.exposed) ? 'user' : 'hidden';
  };
}

// 묶음 안 자리 (1 · 2 …) = 화면의 순서 숫자. 전체 sort_order 는 회사를 건너 이어져 1 · 3 · 2 처럼 읽히므로 안 보인다
export function positions(rows: readonly AdminModel[]): Map<string, number> {
  const seen = new Map<string, number>();
  const pos = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== 'present') continue;
    const n = (seen.get(r.provider) ?? 0) + 1;
    seen.set(r.provider, n);
    pos.set(r.id, n);
  }
  return pos;
}

// 회사별 개수 · 노출 수. 칩 순서 = 목록 묶음과 같은 순서 (처음 나온 회사)
export function providerSummary(rows: readonly AdminModel[]): ProviderSummary[] {
  const map = new Map<string, ProviderSummary>();
  for (const r of rows) {
    const g = map.get(r.provider) ?? { id: r.provider, label: providerName(r), total: 0, exposed: 0 };
    g.total++;
    if (r.state === 'exposed') g.exposed++;
    map.set(r.provider, g);
  }
  return [...map.values()];
}

export function filterRows(rows: readonly AdminModel[], { provider, state, query }: { provider: string; state: StateFilter; query: string }) {
  const q = norm(query.trim());
  return rows.filter((r) =>
    (provider === 'all' || r.provider === provider)
    && (state === 'all'
      || (state === 'hidden' ? r.state === 'hidden' || r.state === 'missing'
        : state === 'problem' ? r.status === 'present' && failed(r) : r.state === state))
    && (!q || norm(r.label).includes(q) || norm(r.id).includes(q)));
}

export function groupRows(rows: readonly AdminModel[]): ProviderGroup[] {
  const out: ProviderGroup[] = [];
  for (const r of rows) {
    const g = out.find((x) => x.id === r.provider);
    if (g) g.rows.push(r);
    else out.push({ id: r.provider, label: providerName(r), rows: [r] });
  }
  return out;
}

// 같은 회사 · 게이트웨이에 있는 줄 사이에서 앞 · 뒤 (↑↓ 로 옮길 자리)
export function neighbors(list: readonly AdminModel[], m: AdminModel) {
  const live = list.filter((r) => r.provider === m.provider && r.status === 'present');
  const at = live.findIndex((r) => r.id === m.id);
  return { at, total: live.length, prev: at > 0 ? live[at - 1] : undefined, next: at >= 0 && at < live.length - 1 ? live[at + 1] : undefined };
}
