// 모델 목록에서 화면 값을 계산한다 (순수 함수 · 상태 없음). hooks.ts · 컴포넌트가 같이 쓴다.
// 표 = 한 장 (제공사 = 칸). 줄 순서 = 전체 순서 하나 (서버 sort_order · 제공사로 묶지 않는다) = 사용자 앱 모델 메뉴 순서.
// 화면의 순서 숫자 = 그 전체 자리 (서버 order 1 … N · 사라진 모델은 —). 끌기 = 아무 줄 사이로 · 자세히 페이지 = 한 칸 위 · 아래.
import { providerLabel, type IconName } from '@brewai/ui';
import type { AdminModel } from './api';
import { CAP, COL_LABEL, COPY, ERROR_DETAIL, FIX_HINT, UNKNOWN_ERROR_HINT, type CapId, type StateFilter } from './copy';

// 표 칸 (E2E: 순서). 글 = copy.ts COL_LABEL · 좁은 창에서 숨는 칸 = models.css (data-col).
// 왼쪽 = 무엇인지(제공사 · 이름 · 게이트웨이 값) · 맨 오른쪽 = 여기서 정하는 것(노출 · 기본)과 연결. 상태 칸 없음 (후보 · 사라짐만 이름 옆 딱지)
export const COL_IDS = ['select', 'order', 'provider', 'model', 'context', 'input', 'output', 'caps', 'exposed', 'default', 'health'] as const;
export type ColId = (typeof COL_IDS)[number];
export const COL_LABELS = COL_IDS.map((id) => COL_LABEL[id]);

// 같은 표시 이름: user = 둘 다 노출이라 사용자 앱에서 겹친다 · hidden = 한쪽이 숨김이라 지금은 안 겹친다
export type Dup = 'user' | 'hidden' | null;
export type ProviderSummary = { id: string; label: string; total: number; exposed: number };

export const providerName = (m: Pick<AdminModel, 'provider' | 'provider_label'>) => providerLabel(m.provider, m.provider_label);

// 128000 → 128K · 1000000 → 1M
export const tokens = (n: number | null) =>
  n == null ? null : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
// 토큰당 → 100만 토큰당 달러 (게이트웨이 가격표 스냅샷)
export const perM = (c: number | null) => {
  if (c == null) return null;
  const n = c * 1_000_000;
  return `$${n > 0 && n < 1 ? n.toFixed(2) : +n.toFixed(2)}`; // $0.15 · $0.60 · $3 · $15
};

// 게이트웨이 값 → 기능 아이콘 (표 '기능' 칸 · 자세히 페이지). 대화 모델 = 텍스트 + 아는 기능 · 임베딩 · 그 밖의 mode = 대화에 안 씀
export type Cap = { id: CapId; icon: IconName; label: string; long: string };
const cap = (id: CapId, long?: string): Cap => ({ id, ...CAP[id], long: long ?? CAP[id].long });
export function capsOf(m: AdminModel): Cap[] {
  if (m.mode === 'embedding') return [cap('embedding')];
  if (!m.is_chat) return [cap('other', COPY.capOther(m.mode ?? ''))];
  return [
    cap('text'),
    ...(m.supports_vision ? [cap('image')] : []),
    ...(m.supports_function_calling ? [cap('tools')] : []),
    ...(m.supports_reasoning ? [cap('reasoning')] : []),
  ];
}

// 도구 꺼짐 = 대화 모델인데 게이트웨이가 도구 호출을 된다고 하지 않음 (사용자 앱에서 앱 · 스킬을 못 쓴다 · copy.ts TOOLS_OFF)
//   unknown = LiteLLM 이 모름 → Model Info 에 값을 넣으면 된다 · no = LiteLLM 이 안 된다고 함 → 넣으라고 하지 않는다 (넣으면 대화가 400)
type ToolsFlag = Pick<AdminModel, 'is_chat' | 'supports_function_calling'>;
export const toolsOff = (m: ToolsFlag) => m.is_chat && m.supports_function_calling !== true;
export const toolsOffKind = (m: ToolsFlag): 'unknown' | 'no' | null =>
  !toolsOff(m) ? null : m.supports_function_calling === false ? 'no' : 'unknown';

// 연결 테스트 응답 시간 (conductor 가 잰 왕복): 412ms · 1.2초
export const latency = (ms: number) => (ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}초`);

// 하루 넘으면 날짜 (compact = 날짜만 · 좁은 표 칸용. 시각까지는 when() 을 툴팁에)
export function ago(iso: string | null, now: number, compact = false) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const s = Math.round((now - t) / 1000);
  if (s < 45) return COPY.ago.now;
  if (s < 3600) return COPY.ago.min(Math.max(1, Math.round(s / 60)));
  if (s < 86400) return COPY.ago.hour(Math.round(s / 3600));
  return compact ? new Date(t).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) : when(iso);
}
export const when = (iso: string | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
};

// 마지막 연결 결과 = 대화 · 연결 시험 중 나중 것
export const failed = (m: AdminModel) => !!m.last_error_at && (!m.last_ok_at || m.last_error_at > m.last_ok_at);
export const canExpose = (m: AdminModel) => m.is_chat && m.status !== 'missing';
export const canProbe = (m: AdminModel) => m.is_chat && m.status === 'present';

const norm = (s: string) => s.normalize('NFC').toLowerCase();
const labelKey = (s: string) => norm(s).replace(/\s+/g, '');

export const errorOf = (code: string) =>
  (Object.prototype.hasOwnProperty.call(ERROR_DETAIL, code) ? ERROR_DETAIL[code] : undefined) ?? { short: code, hint: UNKNOWN_ERROR_HINT };

// 고치는 곳은 아는 만큼 좁힌다: 등록한 곳(config.yaml · 관리 화면) × 제공사 → .env 키 이름 · LiteLLM 화면
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

// 제공사별 개수 · 노출 수. 고르기 상자 순서 = 표 줄 순서 (처음 나온 제공사)
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

export const candidatesOf = (rows: readonly AdminModel[]) => rows.filter((r) => r.state === 'candidate');

// 게이트웨이에 있는 줄 사이에서 앞 · 뒤 (자세히 페이지 '한 칸 위 · 아래' 로 옮길 자리 · 제공사와 상관없이 전체 순서)
export function neighbors(list: readonly AdminModel[], m: AdminModel) {
  const live = list.filter((r) => r.status === 'present');
  const at = live.findIndex((r) => r.id === m.id);
  return { at, total: live.length, prev: at > 0 ? live[at - 1] : undefined, next: at >= 0 && at < live.length - 1 ? live[at + 1] : undefined };
}
