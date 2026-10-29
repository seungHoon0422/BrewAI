import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  AdminApiError, API_URL, getGateway, listAdminModels, patchModel, syncModels,
  type AdminModel, type GatewayInfo, type LoadError, type ModelPatch, type ModelState, type SyncResult,
} from '../api';
import { Icon } from '../icons';
import { ProviderIcon, providerLabel, providerRank } from '../providers';
import { EmptyTable, Note } from '../ui';

// 모델 등록은 LiteLLM 에서만 (Admin UI · config.yaml). 여기서 정하는 것 = 노출 · 표시 이름 · 순서 · 기본 모델 (ADR-0006).
// 가격 · 컨텍스트 · 회사(provider)는 게이트웨이 값이라 입력칸 없이 보여 주기만 한다 (e2e admin.spec 이 입력칸이 없는지 본다).
// 표 순서 = sort_order 그대로. 사용자 앱 모델 메뉴는 기본 모델을 맨 위로 올리고, 나머지는 이 순서로 회사별로 묶는다
// (묶음 순서 = 처음 나온 회사 순서) → 기본 모델의 순서를 바꿔도 메뉴에서는 맨 위 그대로. 아래 docs-src 안내와 같은 말.
const COLS = ['순서', '모델', '회사', '상태', '노출', '기본', '게이트웨이 값'] as const;

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

const STATE_CHIP: Record<ModelState, { text: string; dot: string }> = {
  exposed: { text: '노출', dot: 'dot on' },
  hidden: { text: '숨김', dot: 'dot' },
  candidate: { text: '후보', dot: 'dot new' },
  missing: { text: '게이트웨이에서 사라짐', dot: 'dot warn' },
};

type State = { kind: 'loading' } | { kind: 'ok'; rows: AdminModel[] } | { kind: 'error'; error: LoadError };
type Flash = { kind: 'ok' | 'error'; text: string } | null;

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

export default function Models() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [gateway, setGateway] = useState<GatewayInfo | null>(null);
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<string>('all');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [now, setNow] = useState(() => Date.now());
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
  idle.current = busy.size === 0 && !syncing && state.kind === 'ok';
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
  };
  const count = (n: number) => (state.kind === 'ok' ? n : '—'); // 불러오는 중 · 오류면 숫자를 안 보인다

  // 회사별 묶음 (개수 · 노출 수). 순서 = conductor 의 회사 순서 (안정)
  const providers = useMemo(() => {
    const map = new Map<string, { id: string; label: string; total: number; exposed: number }>();
    for (const r of rows) {
      const g = map.get(r.provider) ?? { id: r.provider, label: providerLabel(r.provider, r.provider_label), total: 0, exposed: 0 };
      g.total++;
      if (r.state === 'exposed') g.exposed++;
      map.set(r.provider, g);
    }
    return [...map.values()].sort((a, b) => providerRank(a.id) - providerRank(b.id));
  }, [rows]);
  const activeFilter = filter !== 'all' && !providers.some((p) => p.id === filter) ? 'all' : filter;
  const visible = activeFilter === 'all' ? rows : rows.filter((r) => r.provider === activeFilter);

  // 바꾸기 = PATCH 한 줄 → 표 전체를 다시 읽는다 (기본 · 순서는 다른 줄도 바뀐다)
  const change = async (m: AdminModel, patch: ModelPatch, done?: string) => {
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
      if (done) setFlash({ kind: 'ok', text: done });
      return true;
    } catch (e) {
      setFlash({ kind: 'error', text: `${m.label} · ${patchError(e)}` });
      if (patch.is_default) {
        const fresh = await listAdminModels().catch(() => null);
        if (fresh) setState({ kind: 'ok', rows: fresh });
      }
      return false;
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(m.id);
        return n;
      });
    }
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

  const lastSync = ago(gateway?.last_sync_at ?? null, now);
  return (
    <>
      <Note icon="lock">
        모델은 게이트웨이(LiteLLM)에서만 등록됩니다. 여기서는 노출 · 표시 이름 · 순서 · 기본 모델만 정합니다.
      </Note>

      <div className="mtool">
        {gateway?.ui_url ? (
          <a className="btn" href={gateway.ui_url} target="_blank" rel="noopener noreferrer" title={`LiteLLM Admin UI 열기 (${gateway.ui_url})`}>
            <Icon name="external" />LiteLLM 에서 추가
          </a>
        ) : (
          <button className="btn" type="button" disabled title="conductor 에 연결되면 LiteLLM Admin UI 주소를 알려 줘요">
            <Icon name="external" />LiteLLM 에서 추가
          </button>
        )}
        <button className="btn" type="button" onClick={sync} disabled={syncing || state.kind === 'loading'}>
          <span className={syncing ? 'ico spin' : 'ico'} aria-hidden="true"><Icon name="refresh" /></span>
          {syncing ? '동기화 중…' : '동기화'}
        </button>
        <span className="hint">
          새 모델은 LiteLLM 에 등록한 뒤 동기화하면 <b>후보</b>로 숨김 상태로 들어와요
          {lastSync && <> · 마지막 동기화 <time dateTime={gateway?.last_sync_at ?? undefined}>{lastSync}</time></>}
        </span>
      </div>

      <div className="legend">
        <span>상태</span>
        <span className="chip"><i className="dot on" />노출 {count(counts.exposed)}</span>
        <span className="chip"><i className="dot" />숨김 {count(counts.hidden)}</span>
        <span className="chip"><i className="dot new" />후보 {count(counts.candidate)}</span>
        {counts.missing > 0 && <span className="chip"><i className="dot warn" />사라짐 {counts.missing}</span>}
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
          <button className="link" type="button" onClick={() => setFilter('all')}>전체 보기</button>
        </div>
      )}

      {state.kind === 'ok' && providers.length > 0 && (
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
              <tr>{COLS.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
            </thead>
            <tbody>
              {visible.map((m, i) => (
                <Row key={m.id} m={m} busy={busy.has(m.id)} onChange={change}
                  prev={visible.slice(0, i).reverse().find((r) => r.status === 'present')}
                  next={visible.slice(i + 1).find((r) => r.status === 'present')} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {state.kind === 'ok' && rows.length > 0 && (
        <p className="docs-src">
          사용자 앱 모델 메뉴는 기본 모델을 맨 위에, 나머지는 이 순서대로 회사별로 묶어 보여요.
          게이트웨이 값(회사 · 컨텍스트 · 가격 · 기능)은 LiteLLM <code>/model_group/info</code> 의 읽기 전용 스냅샷이에요. 가격 단위 = 100만 토큰당 입력 / 출력.
        </p>
      )}
    </>
  );
}

function Row({ m, prev, next, busy, onChange }: {
  m: AdminModel;
  prev?: AdminModel;
  next?: AdminModel;
  busy: boolean;
  onChange: (m: AdminModel, patch: ModelPatch, done?: string) => Promise<boolean>;
}) {
  const missing = m.status === 'missing';
  const chip = STATE_CHIP[m.state];
  const canExpose = m.is_chat && !missing;
  const exposeWhy = !m.is_chat ? '대화 모델이 아니라서 노출할 수 없어요' : missing ? '게이트웨이에서 사라진 모델이에요' : undefined;
  const info = [
    !m.is_chat ? `${m.mode === 'embedding' ? '임베딩' : m.mode ?? '대화 아님'} · 대화에 안 씀` : '',
    tokens(m.max_input_tokens) ? `컨텍스트 ${tokens(m.max_input_tokens)}` : '',
    m.supports_function_calling ? '도구' : '',
    m.supports_reasoning ? '생각' : '',
    m.supports_vision ? '이미지' : '',
  ].filter(Boolean);
  const price = m.input_cost_per_token != null || m.output_cost_per_token != null
    ? `${perM(m.input_cost_per_token) ?? '—'} / ${perM(m.output_cost_per_token) ?? '—'}`
    : null;
  const extra = m.provider_ids.slice(1).map((p) => providerLabel(p));

  return (
    <tr data-model={m.id} data-state={m.state} aria-busy={busy} className={busy ? 'busy' : undefined}>
      <td className="ord">
        {missing ? '—' : (
          <span className="ordc">
            <span className="num">{m.order}</span>
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
      <td className="mcell"><NameCell m={m} busy={busy} onChange={onChange} /></td>
      <td>
        <span className="prov" title={[providerLabel(m.provider, m.provider_label), ...extra].join(' · ')}>
          <ProviderIcon provider={m.provider} />
          <span className="ell">{providerLabel(m.provider, m.provider_label)}</span>
          {extra.length > 0 && <span className="plus">+{extra.length}</span>}
        </span>
      </td>
      <td>
        <span className={`chip st-${m.state}`}><i className={chip.dot} />{chip.text}</span>
      </td>
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
      <td className="ginfo">
        {info.length > 0 && <span>{info.join(' · ')}</span>}
        {price && <span className="price" title="100만 토큰당 입력 / 출력 (게이트웨이 가격표)">{price}</span>}
        {!info.length && !price && <span className="nil">—</span>}
      </td>
    </tr>
  );
}

// 표시 이름 = 이 칸에서만 바꾼다 (Enter 저장 · Esc 취소 · 비우면 기본 이름으로)
function NameCell({ m, busy, onChange }: { m: AdminModel; busy: boolean; onChange: (m: AdminModel, patch: ModelPatch, done?: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const editBtn = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const start = () => {
    setValue(m.display_name ?? m.label);
    setEditing(true);
  };
  const finish = async (save: boolean) => {
    if (saving.current) return;
    const next = value.replace(/\s+/g, ' ').trim();
    const same = next === (m.display_name ?? '') || (!m.display_name && next === m.default_label);
    if (!save || same) {
      setEditing(false);
      requestAnimationFrame(() => editBtn.current?.focus());
      return;
    }
    saving.current = true;
    const ok = await onChange(m, { display_name: next === '' || next === m.default_label ? null : next });
    saving.current = false;
    if (ok) {
      setEditing(false);
      requestAnimationFrame(() => editBtn.current?.focus());
    } else input.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      void finish(false);
    }
  };

  if (editing) {
    return (
      <div className="nedit">
        <input ref={input} className="nin" type="text" value={value} maxLength={60} disabled={busy}
          aria-label={`표시 이름 — ${m.id}`} placeholder={m.default_label} onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey} onBlur={() => void finish(true)} />
        <span className="hint">Enter 저장 · Esc 취소 · 비우면 기본 이름 ({m.default_label})</span>
      </div>
    );
  }
  return (
    <div className="ncell">
      <span className="nline">
        <b className="ell" title={m.label}>{m.label}</b>
        {m.is_default && <span className="dflt">기본</span>}
        <button ref={editBtn} className="ibt" type="button" aria-label={`표시 이름 바꾸기 — ${m.label}`} title="표시 이름 바꾸기"
          disabled={busy} onClick={start}>
          <Icon name="pen" />
        </button>
      </span>
      <span className="sub">
        <code title="게이트웨이 ID">{m.id}</code>
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
