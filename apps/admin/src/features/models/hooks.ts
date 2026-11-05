// 모델 화면 상태. useModels = 서버 데이터 · 바꾸기 · 연결 테스트 · 동기화 · 알림 줄 / useModelView = 거르개 · 고르기 · 끌기.
// 컴포넌트는 이 둘이 주는 값과 함수만 쓴다 (fetch 없음).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminApiError, isConductorDown, loadErrorOf, type LoadError } from '../../shared/http';
import { deleteModel, getGateway, listAdminModels, patchModel, syncModels, testModel, type AdminModel, type GatewayInfo, type ModelPatch, type ProbeResult } from './api';
import { COPY, LOAD_ERROR, PATCH_ERROR, syncText, type StateFilter } from './copy';
import { canProbe, countsOf, dupIndex, errorOf, filterRows, providerSummary } from './derive';

type Load = { kind: 'loading' } | { kind: 'ok'; rows: AdminModel[] } | { kind: 'error'; error: LoadError };
export type Flash = { kind: 'ok' | 'error'; text: string } | null;
export type Change = (m: AdminModel, patch: ModelPatch, done?: string) => Promise<boolean>;
export type Probe = (m: AdminModel) => Promise<void>;
// 이 화면에서 한 연결 테스트 (그 자리에 보인다): 도는 중 · 끝남(지연 ms) · 못 함(conductor 꺼짐 등). 다시 읽어도 결과(정상 · 오류)는 서버 model_health 에 남는다
export type TestState = { phase: 'running' } | { phase: 'done'; ok: boolean; ms: number; at: string } | { phase: 'error'; down: boolean };

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
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [probingAll, setProbingAll] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [now, setNow] = useState(() => Date.now());
  const reload = useCallback(() => setTick((t) => t + 1), []);
  // 서버에서 새 줄이 왔다 = conductor 가 살아 있다 → '테스트 못 함 · conductor 꺼짐' 은 지운다 (결과는 서버 줄이 말한다). 도는 중 · 끝난 테스트는 둔다
  const fromServer = (list: AdminModel[]) => {
    setState({ kind: 'ok', rows: list });
    setTests((all) => (Object.values(all).some((t) => t.phase === 'error')
      ? Object.fromEntries(Object.entries(all).filter(([, t]) => t.phase !== 'error'))
      : all));
  };

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: 'loading' });
    listAdminModels(ctrl.signal).then(
      (rows) => fromServer(rows),
      (e) => {
        const error = loadErrorOf(e);
        if (error) setState({ kind: 'error', error });
      },
    );
    getGateway(ctrl.signal).then(setGateway, () => setGateway(null));
    return () => ctrl.abort();
  }, [tick]);

  // 고치는 중 · 연결 테스트 중 · 동기화 중 · 숨은 탭이면 건너뛴다.
  // gen = 이 화면이 줄을 바꾼 횟수 → 읽는 동안 바뀌었으면(테스트 결과 · 바꾸기) 그 응답은 버린다 (옛 값으로 덮지 않게)
  const idle = useRef(true);
  idle.current = busy.size === 0 && !syncing && !bulkBusy && !probingAll && state.kind === 'ok';
  const running = useRef(new Set<string>());
  const gen = useRef(0);
  const quiet = () => idle.current && running.current.size === 0;
  useEffect(() => {
    const t = setInterval(() => {
      if (!quiet() || document.visibilityState !== 'visible') return;
      const g = gen.current;
      listAdminModels().then(
        (rows) => { if (quiet() && g === gen.current) fromServer(rows); },
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
  const setRows = (f: (rows: AdminModel[]) => AdminModel[]) => {
    gen.current++;
    setState((s) => (s.kind === 'ok' ? { kind: 'ok', rows: f(s.rows) } : s));
  };
  const refresh = async () => {
    const fresh = await listAdminModels().catch(() => null);
    if (fresh) fromServer(fresh);
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

  const setTest = (id: string, t: TestState) => setTests((all) => ({ ...all, [id]: t }));
  // 연결 테스트 하나 = 짧은 호출 한 번 → 결과는 그 자리(줄의 '연결' 칸 · 자세히 페이지)에. 줄은 잠그지 않는다 (노출 · 이름은 그대로 바꿀 수 있다)
  const runTest = async (m: AdminModel): Promise<{ code: string | null } | { lost: boolean }> => {
    running.current.add(m.id);
    setTest(m.id, { phase: 'running' });
    try {
      const r = await testModel(m.id);
      const code = applyProbe(m, r);
      setTest(m.id, { phase: 'done', ok: r.ok, ms: r.duration_ms, at: r.at });
      return { code };
    } catch (e) {
      const down = isConductorDown(e);
      setTest(m.id, { phase: 'error', down });
      return { lost: down };
    } finally {
      running.current.delete(m.id);
    }
  };
  // 이미 도는 줄 · 여러 개 테스트 중이면 건너뛴다 (같은 모델에 두 번 · 게이트웨이에 한꺼번에 몰리지 않게)
  const probe: Probe = async (m) => {
    if (running.current.has(m.id) || probingAll) return;
    setFlash(null);
    await runTest(m);
    setNow(Date.now());
  };

  // 여러 개 연결 테스트 = 하나씩 차례로 (게이트웨이 · provider 에 한꺼번에 몰리지 않게) → 줄마다 그 자리에 + 끝에 한 줄 요약
  // '모두 테스트' = 노출한 대화 모델 · 고른 줄 테스트 = 고른 대화 모델. 아직 안 써 본 키 없는 모델도 여기서 '문제 있음'에 잡힌다
  const probeMany = async (list: AdminModel[], after?: () => void) => {
    const todo = list.filter((m) => canProbe(m) && !running.current.has(m.id)); // 혼자 도는 중인 줄은 그 결과로
    setFlash(null);
    if (!todo.length) {
      setFlash({ kind: 'error', text: COPY.done.nothingToProbe });
      return;
    }
    setProbingAll(true);
    let ok = 0;
    const bad: string[] = [];
    let lost = false;
    for (const m of todo) {
      const r = await runTest(m);
      if ('lost' in r) {
        lost = r.lost;
        if (!lost) bad.push(COPY.done.probeUntested(m.label));
      } else if (r.code) bad.push(COPY.done.probeBad(m.label, errorOf(r.code).short));
      else ok++;
      if (lost) break;
    }
    setNow(Date.now());
    setProbingAll(false);
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
    setFlash({ kind: bad ? 'error' : 'ok', text: parts.join(', ') });
  };

  // 지우기 = 사라진 모델만 (conductor 가 판정) → 표를 다시 읽는다. 성공하면 true (자세히 페이지가 목록으로 간다)
  const remove = async (m: AdminModel) => {
    start(m.id);
    setFlash(null);
    try {
      await deleteModel(m.id);
      setRows((list) => list.filter((r) => r.id !== m.id));
      await refresh();
      setFlash({ kind: 'ok', text: COPY.done.deleted(m.label) });
      return true;
    } catch (e) {
      setFlash({ kind: 'error', text: COPY.done.patchFail(m.label, patchError(e)) });
      return false;
    } finally {
      done(m.id);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setFlash(null);
    try {
      const r = await syncModels();
      fromServer(r.models);
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
    state, rows, gateway, now, flash, bulkBusy, syncing, probingAll,
    isBusy: (id: string) => busy.has(id) || bulkBusy,
    testOf: (id: string): TestState | undefined => tests[id],
    dismissFlash: () => setFlash(null),
    reload, probe, probeMany, change, bulk, sync, remove,
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
  const [dragId, setDragId] = useState<string | null>(null);

  const providers = useMemo(() => providerSummary(rows), [rows]);
  const dupOf = useMemo(() => dupIndex(rows), [rows]);
  const counts = useMemo(() => countsOf(rows), [rows]);
  // 거르던 제공사가 목록에서 사라지면 전체로
  const activeProvider = provider !== 'all' && !providers.some((p) => p.id === provider) ? 'all' : provider;
  const visible = filterRows(rows, { provider: activeProvider, state: stateFilter, query }); // 표 줄 = 서버 순서 그대로 (전체 순서 하나)

  return {
    provider: activeProvider, setProvider,
    stateFilter, setStateFilter,
    query, setQuery,
    clearFilters: () => { setQuery(''); setProvider('all'); setStateFilter('all'); },
    unfiltered: activeProvider === 'all' && stateFilter === 'all' && !query.trim(),
    providers, dupOf, counts, visible,
    selected,
    picked: rows.filter((r) => selected.has(r.id)),
    toggleSel: (id: string) => setSelected((s) => toggled(s, id)),
    clearSel: () => setSelected(new Set()),
    dragId, setDragId,
    dragSrc: dragId ? rows.find((r) => r.id === dragId) ?? null : null,
  };
}

export type ModelView = ReturnType<typeof useModelView>;
export type ModelsApi = ReturnType<typeof useModels>;
