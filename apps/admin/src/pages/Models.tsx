import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import {
  AdminApiError, API_URL, getGateway, listAdminModels, patchModel, syncModels, testModel,
  type AdminModel, type GatewayInfo, type LoadError, type ModelPatch, type ModelState, type SyncResult,
} from '../api';
import { Icon } from '../icons';
import { ProviderIcon, providerLabel } from '../providers';
import { EmptyTable, Note } from '../ui';

// 모델 등록은 LiteLLM 에서만 (Admin UI · config.yaml). 여기서 정하는 것 = 노출 · 표시 이름 · 순서 · 기본 모델 (ADR-0006).
// 가격 · 컨텍스트 · 회사(provider)는 게이트웨이 값이라 입력칸 없이 보여 주기만 한다 (e2e admin.spec 이 입력칸이 없는지 본다).
// 화면 = 요약 카드(누르면 그 상태만) → 도구 줄(검색 · 회사 · 상태 · 여러 개 고르기) → 회사별로 묶은 목록 → 줄을 누르면 오른쪽 서랍(자세히 · 고치기).
// 목록 순서 = sort_order. 묶음 순서 = 처음 나온 회사 순서 (사용자 앱 모델 메뉴와 같은 규칙 — 기본 모델은 메뉴에서 맨 위).
// 화면의 순서 숫자 = 그 회사 묶음 안 자리 (1 · 2 …). ↑↓ · 끌기 모두 같은 회사 안에서만 옮긴다. 회사 칩도 묶음과 같은 순서.
const COLS = ['선택', '순서', '모델', '상태', '노출', '기본', '연결', '정보'] as const;
const COL_CLASS: Partial<Record<(typeof COLS)[number], string>> = { 선택: 'sel', 정보: 'gi' }; // 정보 = 좁은 창(<1100)에선 숨김 (서랍에 있다)

// 연결 실패 이유 (conductor diagnose.py detail · 공개 code) → 짧은 이름 + 고치는 곳. 데스크톱 chat/text.ts DETAIL 과 같은 뜻
export const ERROR_DETAIL: Record<string, { short: string; hint: string }> = {
  provider_key_missing: { short: '키 없음', hint: 'LiteLLM 관리 화면 › Models › 이 모델의 Credential 키 확인 (config.yaml 모델이면 .env 의 ANTHROPIC_API_KEY · OPENAI_API_KEY)' },
  provider_key_invalid: { short: '키 틀림', hint: 'LiteLLM 관리 화면 › Models › 이 모델의 Credential 키 확인 (권한 · 만료)' },
  provider_model_not_found: { short: '모델 이름 없음', hint: '모델 이름이 provider 에 없음 — LiteLLM 관리 화면 › Models 에서 LiteLLM 모델 이름 확인' },
  reasoning_unsupported: { short: '생각 설정 거절', hint: '이 모델은 생각(추론) 파라미터를 받지 않아요 — 사용자 앱에서 생각 깊이를 끄기로' },
  provider_bad_request: { short: '요청 거절', hint: 'provider 가 요청을 거절 — conductor 로그의 provider_message 확인 · 생각 깊이를 끄고 다시' },
  gateway_budget_exceeded: { short: '예산 초과', hint: 'LiteLLM 관리 화면 › Virtual Keys · Teams 의 Max Budget 확인' },
  gateway_key_invalid: { short: '게이트웨이 키 틀림', hint: '.env 의 LLM_GATEWAY_KEY (또는 LITELLM_MASTER_KEY) 가 LiteLLM 과 같은지 확인' },
  gateway_model_denied: { short: '키에 모델 허용 안 됨', hint: 'LiteLLM 관리 화면 › Virtual Keys › conductor 키의 허용 모델 확인' },
  gateway_model_missing: { short: '게이트웨이에 없음', hint: 'LiteLLM 관리 화면 › Models 에 이 모델이 있는지 확인 뒤 동기화' },
  provider_rate_limited: { short: '요청 제한', hint: 'provider 요청 한도 — 잠시 뒤 다시' },
  provider_unavailable: { short: 'provider 응답 없음', hint: 'provider 서버 오류 — 잠시 뒤 다시' },
  gateway_unreachable: { short: '게이트웨이 꺼짐', hint: '게이트웨이가 켜져 있는지 확인 — npm run stack' },
  gateway_auth_failed: { short: '게이트웨이 인증 실패', hint: '.env 의 LLM_GATEWAY_KEY 확인' },
  provider_auth_failed: { short: '키 문제', hint: 'LiteLLM 관리 화면 › Models › 이 모델의 Credential 키 확인' },
  provider_rejected: { short: '설정 문제', hint: 'conductor 로그의 provider_message 확인' },
  model_error: { short: '모델 오류', hint: 'conductor 로그 확인 — 잠시 뒤 다시' },
};
const errorOf = (code: string) =>
  (Object.prototype.hasOwnProperty.call(ERROR_DETAIL, code) ? ERROR_DETAIL[code] : undefined) ?? { short: code, hint: 'conductor 로그 확인' };

// 고치는 곳은 아는 만큼 좁힌다: 등록한 곳(config.yaml · 관리 화면) × 회사 → .env 키 이름 · LiteLLM 화면
const ENV_KEY: Record<string, string> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', google: 'GEMINI_API_KEY' };
const envKey = (provider: string) => ENV_KEY[provider] ?? `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
const KEY_CODES = new Set(['provider_key_missing', 'provider_key_invalid', 'provider_auth_failed']);
export function fixFor(m: Pick<AdminModel, 'source' | 'provider'>, code: string): { short: string; hint: string; litellm: boolean } {
  const e = errorOf(code);
  if (KEY_CODES.has(code)) {
    if (m.source === 'config') return { short: e.short, hint: `config.yaml 모델 — .env 의 ${envKey(m.provider)} 확인 뒤 게이트웨이 다시 켜기 (npm run gateway)`, litellm: false };
    if (m.source === 'ui') return { short: e.short, hint: 'LiteLLM 관리 화면 › Models › 이 모델의 Credential 키 확인', litellm: true };
  }
  if (code === 'provider_model_not_found' && m.source === 'config') {
    return { short: e.short, hint: 'config.yaml 모델 — infra/litellm/config.yaml 의 litellm_params.model 이름 확인', litellm: false };
  }
  return { ...e, litellm: e.hint.includes('LiteLLM 관리 화면') };
}

const ERROR_TEXT: Record<LoadError, string> = {
  conductor: `conductor 에 연결할 수 없어요 (${API_URL}) — npm run api`,
  gateway: '게이트웨이에 연결할 수 없어요 — npm run gateway',
  gateway_error: '게이트웨이가 오류를 냈어요 — 게이트웨이 로그 확인',
  gateway_auth: '게이트웨이 인증에 실패했어요 — .env 의 LITELLM_MASTER_KEY 확인',
  server: '모델 목록을 읽지 못했어요',
};

// PATCH 실패 (detail code) → 한 줄
const PATCH_ERROR: Record<string, string> = {
  model_not_found: '그 모델이 목록에 없어요. 새로 고쳐 주세요',
  not_chat_model: '대화 모델이 아니라서 노출할 수 없어요',
  model_missing: '게이트웨이에서 사라진 모델이라 노출할 수 없어요',
  default_requires_exposed: '노출한 모델만 기본으로 정할 수 있어요',
  bad_display_name: '표시 이름은 60자까지, 보이지 않는 글자 없이 써 주세요',
  bad_order: '순서 값이 올바르지 않아요',
};
const patchError = (e: unknown) =>
  e instanceof AdminApiError && e.kind === 'conductor' ? `conductor 에 연결할 수 없어요 (${API_URL})`
  : e instanceof AdminApiError && e.code && PATCH_ERROR[e.code] ? PATCH_ERROR[e.code]
  : '바꾸지 못했어요. 잠시 뒤 다시 해 주세요';

const STATE_TEXT: Record<ModelState, string> = { exposed: '노출', hidden: '숨김', candidate: '후보', missing: '게이트웨이에서 사라짐' };
const SOURCE: Record<string, { tag: string; long: string }> = {
  config: { tag: 'config.yaml', long: 'config.yaml (infra/litellm)' },
  ui: { tag: 'LiteLLM UI', long: 'LiteLLM 관리 화면 (DB)' },
  mixed: { tag: 'config + UI', long: 'config.yaml 과 LiteLLM 관리 화면 둘 다' },
};

type Load = { kind: 'loading' } | { kind: 'ok'; rows: AdminModel[] } | { kind: 'error'; error: LoadError };
type Flash = { kind: 'ok' | 'error'; text: string } | null;
type StateFilter = 'all' | 'exposed' | 'candidate' | 'hidden' | 'problem';
type Change = (m: AdminModel, patch: ModelPatch, done?: string) => Promise<boolean>;
type Probe = (m: AdminModel) => Promise<void>;
type ProbeResult = Awaited<ReturnType<typeof testModel>>;
// 같은 표시 이름: user = 둘 다 노출이라 사용자 앱에서 겹친다 · hidden = 한쪽이 숨김이라 지금은 안 겹친다
type Dup = 'user' | 'hidden' | null;

const STATE_FILTERS: { id: StateFilter; label: string }[] = [
  { id: 'all', label: '전체' }, { id: 'exposed', label: '노출' }, { id: 'candidate', label: '후보' },
  { id: 'hidden', label: '숨김' }, { id: 'problem', label: '문제 있음' },
];

// 128000 → 128K · 1000000 → 1M
const tokens = (n: number | null) =>
  n == null ? null : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
// 토큰당 → 100만 토큰당 달러 (게이트웨이 가격표 스냅샷)
const perM = (c: number | null) => {
  if (c == null) return null;
  const n = c * 1_000_000;
  return `$${n > 0 && n < 1 ? n.toFixed(2) : +n.toFixed(2)}`; // $0.15 · $0.60 · $3 · $15
};

function ago(iso: string | null, now: number) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const s = Math.round((now - t) / 1000);
  if (s < 45) return '방금';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}분 전`;
  if (s < 86400) return `${Math.round(s / 3600)}시간 전`;
  return new Date(t).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function syncText(r: SyncResult) {
  const parts = [
    r.added.length ? `새 모델 ${r.added.length}개 (후보 · 숨김)` : '',
    r.missing.length ? `사라진 모델 ${r.missing.length}개 (자동 숨김)` : '',
    r.restored.length ? `돌아온 모델 ${r.restored.length}개 (숨김 유지)` : '',
  ].filter(Boolean);
  return parts.length ? `동기화했어요 · ${parts.join(' · ')}` : '동기화했어요 · 바뀐 모델 없음';
}

// 마지막 연결 결과 = 대화 · 연결 시험 중 나중 것
const failed = (m: AdminModel) => !!m.last_error_at && (!m.last_ok_at || m.last_error_at > m.last_ok_at);
const norm = (s: string) => s.normalize('NFC').toLowerCase();
const labelKey = (s: string) => norm(s).replace(/\s+/g, '');
const info = (m: AdminModel) => [
  !m.is_chat ? `${m.mode === 'embedding' ? '임베딩' : m.mode ?? '대화 아님'} · 대화에 안 씀` : '',
  tokens(m.max_input_tokens) ? `컨텍스트 ${tokens(m.max_input_tokens)}` : '',
  m.supports_function_calling ? '도구' : '',
  m.supports_reasoning ? '생각' : '',
  m.supports_vision ? '이미지' : '',
].filter(Boolean);
const priceOf = (m: AdminModel) => (m.input_cost_per_token != null || m.output_cost_per_token != null
  ? `${perM(m.input_cost_per_token) ?? '—'} / ${perM(m.output_cost_per_token) ?? '—'}`
  : null);

export default function Models() {
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [gateway, setGateway] = useState<GatewayInfo | null>(null);
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<string>('all'); // 회사
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [now, setNow] = useState(() => Date.now());
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: 'loading' });
    listAdminModels(ctrl.signal).then(
      (rows) => setState({ kind: 'ok', rows }),
      (e) => {
        if ((e as Error).name !== 'AbortError') setState({ kind: 'error', error: e instanceof AdminApiError ? e.kind : 'server' });
      },
    );
    getGateway(ctrl.signal).then(setGateway, () => setGateway(null));
    return () => ctrl.abort();
  }, [tick]);

  // 열어 둔 화면도 30초마다 조용히 다시 읽는다 (conductor 가 60초마다 LiteLLM 과 동기화) — 고치는 중 · 동기화 중 · 숨은 탭이면 건너뛴다
  const idle = useRef(true);
  idle.current = busy.size === 0 && !syncing && !bulkBusy && state.kind === 'ok';
  useEffect(() => {
    const t = setInterval(() => {
      if (!idle.current || document.visibilityState !== 'visible') return;
      listAdminModels().then(
        (rows) => { if (idle.current) setState({ kind: 'ok', rows }); },
        () => {}, // 일시 오류는 다음 주기에. 표는 그대로 둔다
      );
      getGateway().then(setGateway, () => {});
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  // '3분 전' 이 흐르게
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const rows = state.kind === 'ok' ? state.rows : [];
  const present = rows.filter((r) => r.status === 'present');
  const counts = {
    exposed: present.filter((r) => r.state === 'exposed').length,
    hidden: present.filter((r) => r.state === 'hidden').length,
    candidate: present.filter((r) => r.state === 'candidate').length,
    missing: rows.filter((r) => r.state === 'missing').length,
    problem: present.filter(failed).length,
    untested: present.filter((r) => r.exposed && r.is_chat && !r.last_ok_at && !r.last_error_at).length,
  };
  const count = (n: number) => (state.kind === 'ok' ? n : '—'); // 불러오는 중 · 오류면 숫자를 안 보인다

  // 같은 표시 이름 (대소문자 · 공백 무시). 둘 다 노출일 때만 사용자 앱에서 헷갈린다 (숨긴 쪽은 사용자가 못 본다)
  const dupOf = useMemo(() => {
    const twins = new Map<string, AdminModel[]>();
    for (const r of rows) if (r.status === 'present') twins.set(labelKey(r.label), [...(twins.get(labelKey(r.label)) ?? []), r]);
    return (m: AdminModel): Dup => {
      const others = m.status === 'present' ? (twins.get(labelKey(m.label)) ?? []).filter((r) => r.id !== m.id) : [];
      if (!others.length) return null;
      return m.exposed && others.some((r) => r.exposed) ? 'user' : 'hidden';
    };
  }, [rows]);

  // 묶음 안 자리 (1 · 2 …) = 화면의 순서 숫자. 전체 sort_order 는 회사를 건너 이어져 1 · 3 · 2 처럼 읽히므로 안 보인다
  const posOf = useMemo(() => {
    const seen = new Map<string, number>();
    const pos = new Map<string, number>();
    for (const r of rows) {
      if (r.status !== 'present') continue;
      const n = (seen.get(r.provider) ?? 0) + 1;
      seen.set(r.provider, n);
      pos.set(r.id, n);
    }
    return pos;
  }, [rows]);

  // 회사별 묶음 (개수 · 노출 수). 칩 순서 = 목록 묶음과 같은 순서 (처음 나온 회사)
  const providers = useMemo(() => {
    const map = new Map<string, { id: string; label: string; total: number; exposed: number }>();
    for (const r of rows) {
      const g = map.get(r.provider) ?? { id: r.provider, label: providerLabel(r.provider, r.provider_label), total: 0, exposed: 0 };
      g.total++;
      if (r.state === 'exposed') g.exposed++;
      map.set(r.provider, g);
    }
    return [...map.values()];
  }, [rows]);
  const activeFilter = filter !== 'all' && !providers.some((p) => p.id === filter) ? 'all' : filter;
  const q = norm(query.trim());
  const visible = rows.filter((r) =>
    (activeFilter === 'all' || r.provider === activeFilter)
    && (stateFilter === 'all'
      || (stateFilter === 'hidden' ? r.state === 'hidden' || r.state === 'missing'
        : stateFilter === 'problem' ? r.status === 'present' && failed(r) : r.state === stateFilter))
    && (!q || norm(r.label).includes(q) || norm(r.id).includes(q)));
  const unfiltered = activeFilter === 'all' && stateFilter === 'all' && !q;

  // 목록 묶음 = 처음 나온 회사 순서 (사용자 앱 메뉴와 같은 규칙)
  const groups = useMemo(() => {
    const out: { id: string; label: string; rows: AdminModel[] }[] = [];
    for (const r of visible) {
      const g = out.find((x) => x.id === r.provider);
      if (g) g.rows.push(r);
      else out.push({ id: r.provider, label: providerLabel(r.provider, r.provider_label), rows: [r] });
    }
    return out;
  }, [visible]);

  const done = (id: string) =>
    setBusy((b) => {
      const n = new Set(b);
      n.delete(id);
      return n;
    });

  // 시험 결과 → 그 줄의 '연결' 칸. 실패면 code 를 돌려준다
  const applyProbe = (m: AdminModel, r: ProbeResult): string | null => {
    const code = r.ok ? null : r.detail ?? r.code ?? 'model_error';
    setState((s) => (s.kind === 'ok' ? {
      kind: 'ok',
      rows: s.rows.map((x) => (x.id !== m.id ? x : r.ok ? { ...x, last_ok_at: r.at } : { ...x, last_error_code: code, last_error_at: r.at })),
    } : s));
    return code;
  };

  // 연결 시험 = 짧은 호출 한 번 → 그 줄의 '연결' 칸 + 한 줄 안내
  const probe: Probe = async (m) => {
    setBusy((b) => new Set(b).add(m.id));
    setFlash(null);
    try {
      const r = await testModel(m.id);
      const code = applyProbe(m, r);
      setNow(Date.now());
      if (r.ok) setFlash({ kind: 'ok', text: `${m.label} · 연결 정상 (${(r.duration_ms / 1000).toFixed(1)}초)` });
      else {
        const e = fixFor(m, code!);
        setFlash({ kind: 'error', text: `${m.label} · 연결 실패: ${e.short} — ${e.hint}` });
      }
    } catch (e) {
      setFlash({ kind: 'error', text: `${m.label} · ${e instanceof AdminApiError && e.kind === 'conductor' ? `conductor 에 연결할 수 없어요 (${API_URL})` : '연결 시험을 하지 못했어요'}` });
    } finally {
      done(m.id);
    }
  };

  // 여러 개 연결 시험 = 하나씩 차례로 (게이트웨이 · provider 에 한꺼번에 몰리지 않게) → 끝에 한 줄 요약
  // '모두 시험' = 노출한 대화 모델 · 고른 줄 시험 = 고른 대화 모델. 아직 안 써 본 키 없는 모델도 여기서 '문제 있음'에 잡힌다
  const probeMany = async (list: AdminModel[], clearSel = false) => {
    const todo = list.filter((r) => r.is_chat && r.status === 'present');
    setFlash(null);
    if (!todo.length) {
      setFlash({ kind: 'error', text: '시험할 대화 모델이 없어요' });
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    const bad: string[] = [];
    let lost = false;
    for (const m of todo) {
      setBusy((b) => new Set(b).add(m.id));
      try {
        const code = applyProbe(m, await testModel(m.id));
        if (code) bad.push(`${m.label} (${errorOf(code).short})`);
        else ok++;
      } catch (e) {
        if (e instanceof AdminApiError && e.kind === 'conductor') lost = true;
        else bad.push(`${m.label} (시험 못 함)`);
      } finally {
        done(m.id);
      }
      if (lost) break;
    }
    setNow(Date.now());
    setBulkBusy(false);
    if (clearSel) setSelected(new Set());
    if (lost) setFlash({ kind: 'error', text: `conductor 에 연결할 수 없어요 (${API_URL}) · ${ok + bad.length}개까지 시험함` });
    else if (bad.length) setFlash({ kind: 'error', text: `${todo.length}개 시험 · 정상 ${ok} · 실패 ${bad.length}: ${bad.join(', ')} — 줄을 누르면 고치는 곳` });
    else setFlash({ kind: 'ok', text: `${todo.length}개 시험 · 모두 정상` });
  };

  // 바꾸기 = PATCH 한 줄 → 표 전체를 다시 읽는다 (기본 · 순서는 다른 줄도 바뀐다)
  const change: Change = async (m, patch, doneText) => {
    setBusy((b) => new Set(b).add(m.id));
    setFlash(null);
    // 기본 모델 라디오는 누른 즉시 바뀐 것으로 보인다 (실패하면 아래에서 다시 읽어 되돌린다)
    if (patch.is_default) {
      setState((s) => (s.kind === 'ok' ? { kind: 'ok', rows: s.rows.map((r) => ({ ...r, is_default: r.id === m.id })) } : s));
    }
    try {
      const updated = await patchModel(m.id, patch);
      setState((s) => (s.kind === 'ok' ? { kind: 'ok', rows: s.rows.map((r) => (r.id === updated.id ? updated : r)) } : s));
      const fresh = await listAdminModels().catch(() => null);
      if (fresh) setState({ kind: 'ok', rows: fresh });
      if (doneText) setFlash({ kind: 'ok', text: doneText });
      return true;
    } catch (e) {
      setFlash({ kind: 'error', text: `${m.label} · ${patchError(e)}` });
      if (patch.is_default) {
        const fresh = await listAdminModels().catch(() => null);
        if (fresh) setState({ kind: 'ok', rows: fresh });
      }
      return false;
    } finally {
      done(m.id);
    }
  };

  // 여러 개 한 번에: PATCH 를 하나씩 → 마지막에 한 번 다시 읽는다. 노출 못 하는 줄(대화 모델 아님 · 사라짐)은 건너뛴다
  const bulk = async (expose: boolean) => {
    const picked = rows.filter((r) => selected.has(r.id));
    const skip = expose ? picked.filter((r) => !r.is_chat || r.status === 'missing') : [];
    const todo = picked.filter((r) => !skip.includes(r) && r.exposed !== expose);
    setBulkBusy(true);
    setFlash(null);
    let ok = 0;
    let bad = 0;
    for (const r of todo) {
      try {
        await patchModel(r.id, { exposed: expose });
        ok++;
      } catch {
        bad++;
      }
    }
    const fresh = await listAdminModels().catch(() => null);
    if (fresh) setState({ kind: 'ok', rows: fresh });
    setBulkBusy(false);
    setSelected(new Set());
    const verb = expose ? '노출' : '숨김';
    const parts = [
      `${ok}개 ${verb}`,
      skip.length ? `${skip.length}개는 대화 모델이 아니라 건너뜀` : '',
      picked.length - skip.length - todo.length > 0 ? `${picked.length - skip.length - todo.length}개는 이미 ${verb}` : '',
      bad ? `${bad}개 실패` : '',
    ].filter(Boolean);
    setFlash({ kind: bad ? 'error' : 'ok', text: parts.join(' · ') });
  };

  const sync = async () => {
    setSyncing(true);
    setFlash(null);
    try {
      const r = await syncModels();
      setState({ kind: 'ok', rows: r.models });
      setGateway((g) => (g ? { ...g, last_sync_at: r.synced_at } : g));
      setNow(Date.now());
      setFlash({ kind: 'ok', text: syncText(r) });
    } catch (e) {
      setFlash({ kind: 'error', text: e instanceof AdminApiError ? ERROR_TEXT[e.kind] : ERROR_TEXT.server });
    } finally {
      setSyncing(false);
    }
  };

  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const pickCard = (f: StateFilter) => setStateFilter((cur) => (cur === f ? 'all' : f));

  // 끌어서 순서 바꾸기 (전체 보기에서만 · 같은 회사 안에서만 · 키보드는 ↑↓ 버튼)
  const dragSrc = dragId ? rows.find((r) => r.id === dragId) ?? null : null;
  const onDrop = (target: AdminModel) => {
    const src = dragSrc;
    setDragId(null);
    if (!src || src.id === target.id || target.status === 'missing' || target.provider !== src.provider) return;
    void change(src, { order: target.order }, `순서를 바꿨어요 · ${src.label} → ${providerLabel(src.provider, src.provider_label)} ${posOf.get(target.id) ?? ''}번`);
  };

  const lastSync = ago(gateway?.last_sync_at ?? null, now);
  const drawerModel = openId ? rows.find((r) => r.id === openId) ?? null : null;
  const selCount = [...selected].filter((id) => rows.some((r) => r.id === id)).length;

  return (
    <>
      <Note icon="lock">
        모델은 게이트웨이(LiteLLM)에서만 등록됩니다. 여기서는 노출 · 표시 이름 · 순서 · 기본 모델만 정합니다.
      </Note>

      <div className="mhead">
        <div className="stats mstats">
          <SummaryCard k="exposed" label="노출" value={count(counts.exposed)} sub="사용자 앱에 보임" pressed={stateFilter === 'exposed'} onPick={pickCard} />
          <SummaryCard k="candidate" label="후보" value={count(counts.candidate)} sub="새로 들어옴 · 확인 필요" pressed={stateFilter === 'candidate'}
            tone={counts.candidate > 0 ? 'info' : undefined} onPick={pickCard} />
          <SummaryCard k="hidden" label="숨김" value={count(counts.hidden + counts.missing)} pressed={stateFilter === 'hidden'} onPick={pickCard}
            sub={counts.missing > 0 ? `사라짐 ${counts.missing}` : '사용자 앱에 안 보임'} />
          <SummaryCard k="problem" label="문제 있음" value={count(counts.problem)} pressed={stateFilter === 'problem'}
            sub={counts.problem > 0 ? '최근 실패 · 눌러서 보기' : counts.untested > 0 ? `최근 실패 없음 · 확인 전 ${counts.untested}` : '최근 실패 없음'}
            tone={counts.problem > 0 ? 'bad' : undefined} onPick={pickCard} />
        </div>
        <div className="msync">
          <span className="hint">
            {lastSync ? <>마지막 동기화 <time dateTime={gateway?.last_sync_at ?? undefined}>{lastSync}</time></> : '아직 동기화 전'}
          </span>
          <span className="mbtns">
          <button className="btn" type="button" onClick={sync} disabled={syncing || state.kind === 'loading'}
            title="새 모델은 LiteLLM 에 등록한 뒤 동기화하면 후보(숨김)로 들어와요">
            <span className={syncing ? 'ico spin' : 'ico'} aria-hidden="true"><Icon name="refresh" /></span>
            {syncing ? '동기화 중…' : '동기화'}
          </button>
          <button className="btn" type="button" disabled={bulkBusy || state.kind !== 'ok' || counts.exposed === 0}
            title="노출한 대화 모델을 하나씩 짧게 불러 봐요 (키 · 모델 이름 확인)" onClick={() => void probeMany(present.filter((r) => r.exposed))}>
            <Icon name="plug" />모두 시험
          </button>
          {gateway?.ui_url ? (
            <a className="btn" href={gateway.ui_url} target="_blank" rel="noopener noreferrer" title={`LiteLLM Admin UI 열기 (${gateway.ui_url})`}>
              <Icon name="external" />LiteLLM 에서 추가
            </a>
          ) : (
            <button className="btn" type="button" disabled title="conductor 에 연결되면 LiteLLM Admin UI 주소를 알려 줘요">
              <Icon name="external" />LiteLLM 에서 추가
            </button>
          )}
          </span>
        </div>
      </div>

      {flash && (
        <p className={`flash ${flash.kind}`} role={flash.kind === 'error' ? 'alert' : 'status'}>
          <Icon name={flash.kind === 'error' ? 'alert' : 'check'} />
          {flash.text}
          <button className="fx" type="button" aria-label="안내 닫기" onClick={() => setFlash(null)}><Icon name="close" /></button>
        </p>
      )}

      {state.kind === 'ok' && counts.candidate > 0 && (
        <div className="cand" role="note">
          <i className="dot new" />
          새 모델 {counts.candidate}개가 <b>후보</b>로 들어왔어요. 확인하고 노출을 켜면 사용자 앱에 보여요.
          <button className="link" type="button" onClick={() => setStateFilter('candidate')}>후보만 보기</button>
        </div>
      )}

      {state.kind === 'ok' && rows.length > 0 && (
        <div className="mbar">
          <label className="msearch">
            <Icon name="search" />
            <input type="search" aria-label="모델 검색" placeholder="이름 · ID 로 찾기" value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); } }} spellCheck={false} />
          </label>
          {selCount > 0 ? (
            <div className="bulk" role="toolbar" aria-label="고른 모델">
              <b>{selCount}개 선택됨</b>
              <button className="btn sm" type="button" disabled={bulkBusy} onClick={() => void bulk(true)}>노출</button>
              <button className="btn sm" type="button" disabled={bulkBusy} onClick={() => void bulk(false)}>숨기기</button>
              <button className="btn sm" type="button" disabled={bulkBusy} onClick={() => void probeMany(rows.filter((r) => selected.has(r.id)), true)}>연결 시험</button>
              <button className="link" type="button" disabled={bulkBusy} onClick={() => setSelected(new Set())}>선택 해제</button>
            </div>
          ) : (
            <>
              <div className="pfilter" role="toolbar" aria-label="회사별 보기">
                <button type="button" className="pf" aria-pressed={activeFilter === 'all'} aria-label={`전체 · 모델 ${rows.length}개`}
                  onClick={() => setFilter('all')}>
                  전체 <span className="n">{rows.length}</span>
                </button>
                {providers.map((p) => (
                  <button key={p.id} type="button" className="pf" aria-pressed={activeFilter === p.id} data-provider={p.id}
                    onClick={() => setFilter(p.id)} aria-label={`${p.label} · 모델 ${p.total}개 · 노출 ${p.exposed}개`}
                    title={`${p.label} · 모델 ${p.total}개 중 ${p.exposed}개 노출`}>
                    <ProviderIcon provider={p.id} />
                    {p.label}
                    <span className="n">{p.total}</span>
                    <span className="n on">노출 {p.exposed}</span>
                  </button>
                ))}
              </div>
              <StateSeg value={stateFilter} onChange={setStateFilter} />
            </>
          )}
        </div>
      )}

      {state.kind === 'loading' && <EmptyTable label="모델 목록" cols={COLS} icon="plug">불러오는 중…</EmptyTable>}
      {state.kind === 'error' && (
        <EmptyTable label="모델 목록" cols={COLS} icon="plug">
          <span role="alert">{ERROR_TEXT[state.error]}</span>
          <button className="btn" type="button" onClick={reload}>다시 시도</button>
        </EmptyTable>
      )}
      {state.kind === 'ok' && rows.length === 0 && (
        <EmptyTable label="모델 목록" cols={COLS} icon="plug">
          게이트웨이에 모델이 없어요 — LiteLLM Admin UI 나 <code>infra/litellm/config.yaml</code> 의 <code>model_list</code> 에서 등록해요
        </EmptyTable>
      )}
      {state.kind === 'ok' && rows.length > 0 && (
        <div className="table mtable">
          <table aria-label="모델 목록">
            <thead>
              <tr>{COLS.map((c) => <th key={c} scope="col" className={COL_CLASS[c]}>{c === '선택' ? <span className="sr">선택</span> : c}</th>)}</tr>
            </thead>
            {visible.length === 0 && (
              <tbody>
                <tr>
                  <td colSpan={COLS.length}>
                    <div className="empty">
                      <p>조건에 맞는 모델이 없어요</p>
                      <button className="link" type="button" onClick={() => { setQuery(''); setFilter('all'); setStateFilter('all'); }}>필터 지우기</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            )}
            {groups.map((g) => {
              const all = rows.filter((r) => r.provider === g.id);
              const isCollapsed = collapsed.has(g.id);
              return (
                <tbody key={g.id} data-group={g.id}>
                  <tr className="grp">
                    <th colSpan={COLS.length} scope="rowgroup">
                      <button type="button" aria-expanded={!isCollapsed}
                        onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}>
                        <span className="chev" aria-hidden="true"><Icon name="chev" /></span>
                        <span className="prov"><ProviderIcon provider={g.id} />{g.label}</span>
                        <span className="gmeta">모델 {all.length} · 노출 {all.filter((r) => r.state === 'exposed').length}</span>
                      </button>
                    </th>
                  </tr>
                  {!isCollapsed && g.rows.map((m, i) => (
                    <Row key={m.id} m={m} pos={posOf.get(m.id)} busy={busy.has(m.id) || bulkBusy} onChange={change} onProbe={probe} now={now}
                      dup={dupOf(m)} checked={selected.has(m.id)} onCheck={() => toggleSel(m.id)} onOpen={() => setOpenId(m.id)}
                      canDrag={unfiltered} canDrop={!dragSrc || dragSrc.provider === m.provider}
                      dragging={dragId === m.id} onDragStart={() => setDragId(m.id)} onDragEnd={() => setDragId(null)}
                      onDrop={() => onDrop(m)}
                      prev={g.rows.slice(0, i).reverse().find((r) => r.status === 'present')}
                      next={g.rows.slice(i + 1).find((r) => r.status === 'present')} />
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
      {state.kind === 'ok' && rows.length > 0 && (
        <p className="docs-src">
          사용자 앱 모델 메뉴는 기본 모델을 맨 위에, 나머지는 이 순서대로 회사별로 묶어 보여요. 순서 = 회사 묶음 안 자리. 줄을 누르면 자세히 · 고치기.
          게이트웨이 값(회사 · 컨텍스트 · 가격 · 기능 · 출처)은 LiteLLM <code>/model_group/info</code> · <code>/v1/model/info</code> 의 읽기 전용 스냅샷이에요. 가격 단위 = 100만 토큰당 입력 / 출력.
        </p>
      )}

      <Drawer m={drawerModel} rows={rows} dup={drawerModel ? dupOf(drawerModel) : null} busy={drawerModel ? busy.has(drawerModel.id) || bulkBusy : false}
        gateway={gateway} now={now} onChange={change} onProbe={probe} onClose={() => setOpenId(null)} />
    </>
  );
}

function SummaryCard({ k, label, value, sub, pressed, tone, onPick }: {
  k: StateFilter; label: string; value: number | string; sub: string; pressed: boolean; tone?: 'info' | 'bad'; onPick: (f: StateFilter) => void;
}) {
  return (
    <button type="button" className="stat mstat" data-card={k} aria-pressed={pressed} onClick={() => onPick(k)}
      title={pressed ? '전체 보기로' : `${label}만 보기`}>
      <span className="k">{label}</span>
      <span className={`v${tone ? ` ${tone}` : ''}${value === '—' ? ' none' : ''}`}>{value}</span>
      <span className="sub">{sub}</span>
    </button>
  );
}

// 상태 필터 = 분할 버튼 (radiogroup · ←→)
function StateSeg({ value, onChange }: { value: StateFilter; onChange: (v: StateFilter) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const i = STATE_FILTERS.findIndex((f) => f.id === value);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const n = (i + dir + STATE_FILTERS.length) % STATE_FILTERS.length;
    onChange(STATE_FILTERS[n].id);
    refs.current[n]?.focus();
  };
  return (
    <div className="sseg" role="radiogroup" aria-label="상태" onKeyDown={onKey}>
      {STATE_FILTERS.map((f, n) => (
        <button key={f.id} ref={(el) => { refs.current[n] = el; }} type="button" role="radio" aria-checked={f.id === value}
          tabIndex={f.id === value ? 0 : -1} onClick={() => onChange(f.id)}>
          {f.label}
        </button>
      ))}
    </div>
  );
}

function Row({ m, pos, prev, next, busy, onChange, onProbe, now, dup, checked, onCheck, onOpen, canDrag, canDrop, dragging, onDragStart, onDragEnd, onDrop }: {
  m: AdminModel;
  pos?: number;
  prev?: AdminModel;
  next?: AdminModel;
  busy: boolean;
  onChange: Change;
  onProbe: Probe;
  now: number;
  dup: Dup;
  checked: boolean;
  onCheck: () => void;
  onOpen: () => void;
  canDrag: boolean;
  canDrop: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const missing = m.status === 'missing';
  const canExpose = m.is_chat && !missing;
  const exposeWhy = !m.is_chat ? '대화 모델이 아니라서 노출할 수 없어요' : missing ? '게이트웨이에서 사라진 모델이에요' : undefined;
  const ginfo = info(m);
  const price = priceOf(m);
  const [over, setOver] = useState(false);
  // 줄의 빈 곳을 누르면 서랍 (버튼 · 입력 · 링크는 제 일을 한다)
  const onRowClick = (e: MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as HTMLElement).closest('button,input,a,label,.nedit')) return;
    onOpen();
  };
  const dragProps = canDrag && canDrop && !missing ? {
    onDragOver: (e: DragEvent) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => { e.preventDefault(); setOver(false); onDrop(); },
  } : {};

  return (
    <tr data-model={m.id} data-state={m.state} aria-busy={busy} onClick={onRowClick} {...dragProps}
      className={[busy ? 'busy' : '', checked ? 'on' : '', dragging ? 'drag' : '', over ? 'over' : ''].filter(Boolean).join(' ') || undefined}>
      <td className="sel">
        <input type="checkbox" className="cb" aria-label={`선택 — ${m.label}`} checked={checked} onChange={onCheck} />
      </td>
      <td className="ord" title={canDrag ? `${providerLabel(m.provider, m.provider_label)} 안에서 ${pos ?? '—'}번째 · 같은 회사 안에서만 옮겨요` : '전체 보기에서 순서를 바꿀 수 있어요'}>
        {missing ? '—' : (
          <span className="ordc">
            {canDrag && (
              <span className="grip" draggable aria-hidden="true" title="끌어서 순서 바꾸기"
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', m.id); onDragStart(); }}
                onDragEnd={onDragEnd}>
                <Icon name="grip" />
              </span>
            )}
            <span className="num">{pos ?? '—'}</span>
            <span className="mv">
              <button className="ibt" type="button" aria-label={`위로 — ${m.label}`} title="위로" disabled={busy || !prev}
                onClick={() => prev && onChange(m, { order: prev.order })}>
                <Icon name="up" />
              </button>
              <button className="ibt" type="button" aria-label={`아래로 — ${m.label}`} title="아래로" disabled={busy || !next}
                onClick={() => next && onChange(m, { order: next.order })}>
                <Icon name="down" />
              </button>
            </span>
          </span>
        )}
      </td>
      <td className="mcell"><NameCell m={m} busy={busy} onChange={onChange} dup={dup} onOpen={onOpen} /></td>
      <td><span className={`chip st-${m.state}`}>{STATE_TEXT[m.state]}</span></td>
      <td>
        <button type="button" role="switch" className="tgl" aria-checked={m.exposed} aria-label={`노출 — ${m.label}`}
          title={exposeWhy ?? (m.exposed ? '사용자 앱에서 숨기기' : '사용자 앱에 보이기')} disabled={busy || (!canExpose && !m.exposed)}
          onClick={() => onChange(m, { exposed: !m.exposed })}>
          <span className="knob" />
        </button>
      </td>
      <td>
        <input type="radio" name="default-model" className="radio" aria-label={`기본 모델 — ${m.label}`} checked={m.is_default}
          disabled={busy || !m.exposed} title={m.exposed ? '기본 모델로' : '노출한 모델만 기본으로 정할 수 있어요'}
          onChange={() => onChange(m, { is_default: true }, `기본 모델을 바꿨어요 · ${m.label}`)} />
      </td>
      <td className="conn"><Health m={m} busy={busy} onProbe={onProbe} now={now} /></td>
      <td className="ginfo gi">
        {ginfo.length > 0 && <span>{ginfo.join(' · ')}</span>}
        {price && <span className="price" title="100만 토큰당 입력 / 출력 (게이트웨이 가격표)">{price}</span>}
        {!ginfo.length && !price && <span className="nil">—</span>}
      </td>
    </tr>
  );
}

// 연결 칸: 마지막 결과(대화 · 연결 시험 중 나중 것) 한 줄 + '연결 시험'. 고치는 곳은 툴팁 · 서랍에
function Health({ m, busy, onProbe, now, label = `연결 시험 — ${m.label}`, wide, fixUrl }: {
  m: AdminModel; busy: boolean; onProbe: Probe; now: number; label?: string; wide?: boolean; fixUrl?: string;
}) {
  const bad = failed(m);
  const at = bad ? m.last_error_at : m.last_ok_at;
  const err = bad && m.last_error_code ? fixFor(m, m.last_error_code) : null;
  const can = m.is_chat && m.status === 'present';
  return (
    <div className={wide ? 'hcell wide' : 'hcell'}>
      <span className={`hl ${bad ? 'bad' : at ? 'ok' : 'none'}`} data-health={bad ? 'error' : at ? 'ok' : 'unknown'}
        title={err ? err.hint : undefined}>
        <i className={bad ? 'dot warn' : at ? 'dot on' : 'dot'} />
        {bad ? err?.short ?? '오류' : at ? '정상' : '확인 전'}
        {at && <span className="tm"> · {ago(at, now)}</span>}
      </span>
      {wide && err && <span className="hhint">{err.hint}</span>}
      {can && (
        <button className="btn sm" type="button" disabled={busy} aria-label={label} title="짧은 호출 한 번으로 키 · 모델 이름을 확인해요"
          onClick={() => void onProbe(m)}>
          {busy ? <span className="ico spin" aria-hidden="true"><Icon name="refresh" /></span> : null}
          연결 시험
        </button>
      )}
      {wide && err?.litellm && fixUrl && (
        <a className="btn sm" href={fixUrl} target="_blank" rel="noopener noreferrer" title={`LiteLLM Admin UI 열기 (${fixUrl})`}>
          <Icon name="external" />LiteLLM 에서 고치기
        </a>
      )}
    </div>
  );
}

// 표시 이름 = 연필로 바꾼다 (Enter 저장 · Esc 취소 · 비우면 기본 이름으로). 이름을 누르면 서랍
function DupBadge({ dup }: { dup: Dup }) {
  if (dup === 'user') return <span className="dupb" title="같은 표시 이름의 모델이 둘 다 노출돼 있어요 — 사용자 앱은 ID 를 함께 보여 줘요">이름 겹침</span>;
  if (dup === 'hidden') return <span className="dupb soft" title="같은 표시 이름의 모델이 있지만 한쪽이 숨김이라 사용자 앱에선 겹치지 않아요">이름 같음</span>;
  return null;
}

function NameCell({ m, busy, onChange, dup, onOpen }: { m: AdminModel; busy: boolean; onChange: Change; dup: Dup; onOpen: () => void }) {
  const [editing, setEditing] = useState(false);
  const editBtn = useRef<HTMLButtonElement>(null);
  if (editing) {
    return (
      <NameEditor m={m} busy={busy} onChange={onChange} label={`표시 이름 — ${m.id}`}
        onDone={() => {
          setEditing(false);
          requestAnimationFrame(() => editBtn.current?.focus());
        }} />
    );
  }
  return (
    <div className="ncell">
      <span className="nline">
        <button className="nbtn" type="button" onClick={onOpen} title="자세히" aria-label={`자세히 — ${m.label}`}>
          <b className="ell">{m.label}</b>
        </button>
        {m.is_default && <span className="dflt">기본</span>}
        <DupBadge dup={dup} />
        <button ref={editBtn} className="ibt" type="button" aria-label={`표시 이름 바꾸기 — ${m.label}`} title="표시 이름 바꾸기"
          disabled={busy} onClick={() => setEditing(true)}>
          <Icon name="pen" />
        </button>
      </span>
      <span className="sub">
        <code title="게이트웨이 ID">{m.id}</code>
        {m.source && <span className="src" title={`등록한 곳: ${SOURCE[m.source].long}`}>{SOURCE[m.source].tag}</span>}
        {m.display_name && (
          <>
            <span className="was" title="게이트웨이 ID 로 만든 기본 이름">기본 이름 {m.default_label}</span>
            <button className="link" type="button" disabled={busy} onClick={() => void onChange(m, { display_name: null }, `기본 이름으로 되돌렸어요 · ${m.default_label}`)}>
              되돌리기
            </button>
          </>
        )}
      </span>
    </div>
  );
}

function NameEditor({ m, busy, onChange, onDone, label }: { m: AdminModel; busy: boolean; onChange: Change; onDone: () => void; label: string }) {
  const [value, setValue] = useState(m.display_name ?? m.label);
  const input = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  useEffect(() => input.current?.select(), []);
  const finish = async (save: boolean) => {
    if (saving.current) return;
    const next = value.replace(/\s+/g, ' ').trim();
    const same = next === (m.display_name ?? '') || (!m.display_name && next === m.default_label);
    if (!save || same) return onDone();
    saving.current = true;
    const ok = await onChange(m, { display_name: next === '' || next === m.default_label ? null : next });
    saving.current = false;
    if (ok) onDone();
    else input.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // 서랍 안이면 서랍은 닫지 않는다
      void finish(false);
    }
  };
  return (
    <div className="nedit">
      <input ref={input} className="nin" type="text" value={value} maxLength={60} disabled={busy}
        aria-label={label} placeholder={m.default_label} onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey} onBlur={() => void finish(true)} />
      <span className="hint">Enter 저장 · Esc 취소 · 비우면 기본 이름 ({m.default_label})</span>
    </div>
  );
}

// 오른쪽 서랍 (폰 = 아래 시트): 이름 · 노출 · 기본 · 순서 · 연결 · 게이트웨이 값(읽기 전용)
function Drawer({ m, rows, dup, busy, gateway, now, onChange, onProbe, onClose }: {
  m: AdminModel | null; rows: AdminModel[]; dup: Dup; busy: boolean; gateway: GatewayInfo | null; now: number;
  onChange: Change; onProbe: Probe; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const last = useRef<string | null>(null);
  const [editing, setEditing] = useState(false);
  const open = m !== null;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      closeBtn.current?.focus();
    } else if (!open && d.open) d.close();
    if (open) last.current = m.id;
    else if (last.current) {
      document.querySelector<HTMLButtonElement>(`tr[data-model="${CSS.escape(last.current)}"] .nbtn`)?.focus();
      last.current = null;
      setEditing(false);
    }
  }, [open, m?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const siblings = m ? rows.filter((r) => r.provider === m.provider && r.status === 'present') : [];
  const at = m ? siblings.findIndex((r) => r.id === m.id) : -1;
  const prev = at > 0 ? siblings[at - 1] : undefined;
  const next = at >= 0 && at < siblings.length - 1 ? siblings[at + 1] : undefined;
  const ginfo = m ? info(m) : [];
  const price = m ? priceOf(m) : null;

  return (
    <dialog ref={ref} className="drawer mdrawer" aria-label={m ? `${m.label} 자세히` : '모델 자세히'}
      onClose={() => open && onClose()} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {m && (
        <div className="drawer-in">
          <header className="drawer-head">
            <div className="drawer-tags">
              <span className={`chip st-${m.state}`}>{STATE_TEXT[m.state]}</span>
              {m.is_default && <span className="dflt">기본</span>}
              <DupBadge dup={dup} />
              {m.source && <span className="src">{SOURCE[m.source].tag}</span>}
            </div>
            <h2><ProviderIcon provider={m.provider} />{m.label}</h2>
            <p className="hint"><code>{m.id}</code> · {providerLabel(m.provider, m.provider_label)}{m.family ? ` · ${m.family} 계열` : ''}</p>
            <button ref={closeBtn} className="x" type="button" aria-label="닫기" onClick={onClose}>×</button>
          </header>

          <section className="dpart">
            <h3>표시 이름</h3>
            {editing ? (
              <NameEditor m={m} busy={busy} onChange={onChange} label="표시 이름" onDone={() => setEditing(false)} />
            ) : (
              <div className="drow">
                <b>{m.label}</b>
                <button className="btn sm" type="button" disabled={busy} onClick={() => setEditing(true)}><Icon name="pen" />이름 바꾸기</button>
                {m.display_name && (
                  <button className="link" type="button" disabled={busy}
                    onClick={() => void onChange(m, { display_name: null }, `기본 이름으로 되돌렸어요 · ${m.default_label}`)}>
                    기본 이름({m.default_label})으로
                  </button>
                )}
              </div>
            )}
            {dup === 'user' && <p className="dwarn">같은 표시 이름의 모델이 둘 다 노출돼 있어요. 사용자 앱은 ID 를 함께 보여 주지만, 이름을 다르게 바꾸면 더 헷갈리지 않아요.</p>}
            {dup === 'hidden' && <p className="dwarn soft">같은 표시 이름의 모델이 있지만 한쪽이 숨김이라 지금은 사용자 앱에서 겹치지 않아요. 둘 다 노출하려면 이름을 다르게 바꿔 주세요.</p>}
          </section>

          <section className="dpart">
            <h3>사용자 앱</h3>
            <div className="drow">
              <button type="button" role="switch" className="tgl" aria-checked={m.exposed} aria-label="사용자 앱에 노출"
                disabled={busy || ((!m.is_chat || m.status === 'missing') && !m.exposed)} onClick={() => onChange(m, { exposed: !m.exposed })}>
                <span className="knob" />
              </button>
              <span>{m.exposed ? '사용자 앱에 보여요' : !m.is_chat ? '대화 모델이 아니라 노출할 수 없어요' : m.status === 'missing' ? '게이트웨이에서 사라진 모델이에요' : '숨김'}</span>
            </div>
            <div className="drow">
              <button className="btn sm" type="button" disabled={busy || !m.exposed || m.is_default}
                onClick={() => onChange(m, { is_default: true }, `기본 모델을 바꿨어요 · ${m.label}`)}>
                {m.is_default ? '기본 모델이에요' : '기본 모델로 정하기'}
              </button>
              {m.status === 'present' && (
                <span className="dord">
                  <span title={`${providerLabel(m.provider, m.provider_label)} 묶음 안 자리`}>순서 <b>{at + 1}</b> / {siblings.length}</span>
                  <button className="ibt" type="button" aria-label="위로 옮기기" disabled={busy || !prev} onClick={() => prev && onChange(m, { order: prev.order })}><Icon name="up" /></button>
                  <button className="ibt" type="button" aria-label="아래로 옮기기" disabled={busy || !next} onClick={() => next && onChange(m, { order: next.order })}><Icon name="down" /></button>
                </span>
              )}
            </div>
          </section>

          <section className="dpart">
            <h3>연결</h3>
            <Health m={m} busy={busy} onProbe={onProbe} now={now} label="연결 시험" wide fixUrl={gateway?.ui_url || undefined} />
          </section>

          <section className="dpart">
            <h3>게이트웨이 값 <span className="hint">읽기 전용 · LiteLLM 에서 바꿔요</span></h3>
            <dl className="kv dkv">
              <div><dt>회사</dt><dd>{[providerLabel(m.provider, m.provider_label), ...m.provider_ids.slice(1).map((p) => providerLabel(p))].join(' · ')}</dd></div>
              <div><dt>등록한 곳</dt><dd>{m.source ? SOURCE[m.source].long : '알 수 없음'}</dd></div>
              <div><dt>기능</dt><dd>{ginfo.join(' · ') || '—'}</dd></div>
              <div><dt>출력 한도</dt><dd>{tokens(m.max_output_tokens) ?? '—'}</dd></div>
              <div><dt>가격</dt><dd className="mono">{price ? `${price} (100만 토큰당 입력 / 출력)` : '—'}</dd></div>
              <div><dt>처음 본 때</dt><dd>{ago(m.first_seen, now) ?? '—'}</dd></div>
              <div><dt>마지막 본 때</dt><dd>{ago(m.last_seen, now) ?? '—'}</dd></div>
            </dl>
          </section>
        </div>
      )}
    </dialog>
  );
}
