// 모델 화면 상태. useModels = 서버 데이터 · 바꾸기 · 연결 시험 · 동기화 · 알림 줄 / useModelView = 거르개 · 고르기 · 접기 · 서랍 · 끌기.
// 컴포넌트는 이 둘이 주는 값과 함수만 쓴다 (fetch 없음).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminApiError, isConductorDown, loadErrorOf, type LoadError } from '../../shared/http';
import { getGateway, listAdminModels, patchModel, syncModels, testModel, type AdminModel, type GatewayInfo, type ModelPatch, type ProbeResult } from './api';
import { COPY, LOAD_ERROR, PATCH_ERROR, syncText, type StateFilter } from './copy';
import { canProbe, dupIndex, errorOf, filterRows, fixFor, groupRows, positions, providerSummary } from './derive';

type Load = { kind: 'loading' } | { kind: 'ok'; rows: AdminModel[] } | { kind: 'error'; error: LoadError };
export type Flash = { kind: 'ok' | 'error'; text: string } | null;
export type Change = (m: AdminModel, patch: ModelPatch, done?: string) => Promise<boolean>;
export type Probe = (m: AdminModel) => Promise<void>;

const POLL_MS = 30_000; // conductor 가 60초마다 LiteLLM 과 동기화 → 열어 둔 화면도 조용히 다시 읽는다
const CLOCK_MS = 30_000; // '3분 전' 이 흐르게

const patchError = (e: unknown) =>
  isConductorDown(e) ? COPY.done.patchDown
  : e instanceof AdminApiError && e.code && PATCH_ERROR[e.code] ? PATCH_ERROR[e.code]
  : COPY.done.patchUnknown;

export function useModels() {
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [gateway, setGateway] = useState<GatewayInfo | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
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
        const error = loadErrorOf(e);
        if (error) setState({ kind: 'error', error });
      },
    );
    getGateway(ctrl.signal).then(setGateway, () => setGateway(null));
    return () => ctrl.abort();
  }, [tick]);

  // 고치는 중 · 동기화 중 · 숨은 탭이면 건너뛴다
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
    }, POLL_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(t);
  }, []);

  const rows = state.kind === 'ok' ? state.rows : [];
  const setRows = (f: (rows: AdminModel[]) => AdminModel[]) => setState((s) => (s.kind === 'ok' ? { kind: 'ok', rows: f(s.rows) } : s));
  const refresh = async () => {
    const fresh = await listAdminModels().catch(() => null);
    if (fresh) setState({ kind: 'ok', rows: fresh });
  };
  const start = (id: string) => setBusy((b) => new Set(b).add(id));
  const done = (id: string) =>
    setBusy((b) => {
      const n = new Set(b);
      n.delete(id);
      return n;
    });

  // 시험 결과 → 그 줄의 '연결' 칸. 실패면 code 를 돌려준다
  const applyProbe = (m: AdminModel, r: ProbeResult): string | null => {
    const code = r.ok ? null : r.detail ?? r.code ?? 'model_error';
    setRows((list) => list.map((x) => (x.id !== m.id ? x : r.ok ? { ...x, last_ok_at: r.at } : { ...x, last_error_code: code, last_error_at: r.at })));
    return code;
  };

  // 연결 시험 = 짧은 호출 한 번 → 그 줄의 '연결' 칸 + 한 줄 안내
  const probe: Probe = async (m) => {
    start(m.id);
    setFlash(null);
    try {
      const r = await testModel(m.id);
      const code = applyProbe(m, r);
      setNow(Date.now());
      if (r.ok) setFlash({ kind: 'ok', text: COPY.done.probeOk(m.label, (r.duration_ms / 1000).toFixed(1)) });
      else {
        const e = fixFor(m, code!);
        setFlash({ kind: 'error', text: COPY.done.probeFail(m.label, e.short, e.hint) });
      }
    } catch (e) {
      setFlash({ kind: 'error', text: COPY.done.probeError(m.label, isConductorDown(e)) });
    } finally {
      done(m.id);
    }
  };

  // 여러 개 연결 시험 = 하나씩 차례로 (게이트웨이 · provider 에 한꺼번에 몰리지 않게) → 끝에 한 줄 요약
  // '모두 시험' = 노출한 대화 모델 · 고른 줄 시험 = 고른 대화 모델. 아직 안 써 본 키 없는 모델도 여기서 '문제 있음'에 잡힌다
  const probeMany = async (list: AdminModel[], after?: () => void) => {
    const todo = list.filter(canProbe);
    setFlash(null);
    if (!todo.length) {
      setFlash({ kind: 'error', text: COPY.done.nothingToProbe });
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    const bad: string[] = [];
    let lost = false;
    for (const m of todo) {
      start(m.id);
      try {
        const code = applyProbe(m, await testModel(m.id));
        if (code) bad.push(COPY.done.probeBad(m.label, errorOf(code).short));
        else ok++;
      } catch (e) {
        if (isConductorDown(e)) lost = true;
        else bad.push(COPY.done.probeUntested(m.label));
      } finally {
        done(m.id);
      }
      if (lost) break;
    }
    setNow(Date.now());
    setBulkBusy(false);
    after?.();
    if (lost) setFlash({ kind: 'error', text: COPY.done.probeLost(ok + bad.length) });
    else if (bad.length) setFlash({ kind: 'error', text: COPY.done.probeSome(todo.length, ok, bad) });
    else setFlash({ kind: 'ok', text: COPY.done.probeAllOk(todo.length) });
  };

  // 바꾸기 = PATCH 한 줄 → 표 전체를 다시 읽는다 (기본 · 순서는 다른 줄도 바뀐다)
  const change: Change = async (m, patch, doneText) => {
    start(m.id);
    setFlash(null);
    // 기본 모델 라디오는 누른 즉시 바뀐 것으로 보인다 (실패하면 아래에서 다시 읽어 되돌린다)
    if (patch.is_default) setRows((list) => list.map((r) => ({ ...r, is_default: r.id === m.id })));
    try {
      const updated = await patchModel(m.id, patch);
      setRows((list) => list.map((r) => (r.id === updated.id ? updated : r)));
      await refresh();
      if (doneText) setFlash({ kind: 'ok', text: doneText });
      return true;
    } catch (e) {
      setFlash({ kind: 'error', text: COPY.done.patchFail(m.label, patchError(e)) });
      if (patch.is_default) await refresh();
      return false;
    } finally {
      done(m.id);
    }
  };

  // 여러 개 한 번에: PATCH 를 하나씩 → 마지막에 한 번 다시 읽는다. 노출 못 하는 줄(대화 모델 아님 · 사라짐)은 건너뛴다
  const bulk = async (picked: AdminModel[], expose: boolean, after?: () => void) => {
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
    await refresh();
    setBulkBusy(false);
    after?.();
    const already = picked.length - skip.length - todo.length;
    const parts = [
      COPY.done.bulk(ok, expose),
      skip.length ? COPY.done.bulkSkipped(skip.length) : '',
      already > 0 ? COPY.done.bulkAlready(already, expose) : '',
      bad ? COPY.done.bulkFailed(bad) : '',
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
      setFlash({ kind: 'error', text: LOAD_ERROR[e instanceof AdminApiError ? e.kind : 'server'] });
    } finally {
      setSyncing(false);
    }
  };

  return {
    state, rows, gateway, now, flash, bulkBusy, syncing,
    isBusy: (id: string) => busy.has(id) || bulkBusy,
    dismissFlash: () => setFlash(null),
    reload, probe, probeMany, change, bulk, sync,
  };
}

const toggled = (s: Set<string>, id: string) => {
  const n = new Set(s);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
};

export function useModelView(rows: AdminModel[]) {
  const [provider, setProvider] = useState<string>('all');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const providers = useMemo(() => providerSummary(rows), [rows]);
  const posOf = useMemo(() => positions(rows), [rows]);
  const dupOf = useMemo(() => dupIndex(rows), [rows]);
  // 거르던 회사가 목록에서 사라지면 전체로
  const activeProvider = provider !== 'all' && !providers.some((p) => p.id === provider) ? 'all' : provider;
  const visible = filterRows(rows, { provider: activeProvider, state: stateFilter, query });
  const groups = groupRows(visible);

  return {
    provider: activeProvider, setProvider,
    stateFilter, setStateFilter,
    pickCard: (f: StateFilter) => setStateFilter((cur) => (cur === f ? 'all' : f)),
    query, setQuery,
    clearFilters: () => { setQuery(''); setProvider('all'); setStateFilter('all'); },
    unfiltered: activeProvider === 'all' && stateFilter === 'all' && !query.trim(),
    providers, posOf, dupOf, visible, groups,
    selected,
    picked: rows.filter((r) => selected.has(r.id)),
    toggleSel: (id: string) => setSelected((s) => toggled(s, id)),
    clearSel: () => setSelected(new Set()),
    collapsed,
    toggleGroup: (id: string) => setCollapsed((c) => toggled(c, id)),
    open: openId ? rows.find((r) => r.id === openId) ?? null : null,
    setOpenId,
    dragId, setDragId,
    dragSrc: dragId ? rows.find((r) => r.id === dragId) ?? null : null,
  };
}

export type ModelView = ReturnType<typeof useModelView>;
export type ModelsApi = ReturnType<typeof useModels>;
