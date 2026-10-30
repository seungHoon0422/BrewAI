// 목록 하나 읽기 상태 (불러오는 중 · 성공 · 실패) + 다시 읽기 · 조용히 새로 읽기. 기능 hooks.ts 가 api.ts 함수를 넘겨 쓴다 (컴포넌트는 fetch 하지 않는다)
import { useCallback, useEffect, useRef, useState } from 'react';
import { COMMON_COPY, LOAD_FAILED } from './copy';
import { codeOf, isConductorDown, loadErrorOf, type LoadError } from './http';
import { useToast } from './toast';

export type Load<T> = { kind: 'loading' } | { kind: 'ok'; data: T } | { kind: 'error'; error: LoadError };

// key 가 바뀌면 다시 읽는다 (예: 연 조직 id)
export function useLoad<T>(fetcher: (signal?: AbortSignal) => Promise<T>, key = '') {
  const [state, setState] = useState<Load<T>>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: 'loading' });
    fetchRef.current(ctrl.signal).then(
      (data) => setState({ kind: 'ok', data }),
      (e) => {
        const error = loadErrorOf(e);
        if (error) setState({ kind: 'error', error });
      },
    );
    return () => ctrl.abort();
  }, [tick, key]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  // 바꾼 뒤 표를 서버 값으로 (뼈대 줄 없이). 실패하면 표는 그대로
  const refresh = useCallback(async () => {
    const data = await fetchRef.current().catch(() => null);
    if (data !== null) setState({ kind: 'ok', data });
  }, []);
  const data = state.kind === 'ok' ? state.data : null;
  return { state, data, reload, refresh };
}

// 바꾸기 실패 → 한 줄. 기능 copy 의 code 표 → conductor 꺼짐 → 공통 문구
export function errorText(e: unknown, codes: Readonly<Record<string, string>>, down: string): string {
  const code = codeOf(e);
  if (code && codes[code]) return codes[code];
  return isConductorDown(e) ? down : COMMON_COPY.failed;
}

// 바꾸기 하나 = 바쁨 표시(무엇이 바쁜지 id) → 성공 알림 + 목록 새로 읽기 | 실패 알림 (기능 copy 의 code 표). 성공하면 true
export function useTask(refresh: () => Promise<void>, errors: Readonly<Record<string, string>>) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(task: () => Promise<T>, done: string | ((r: T) => string), id = ''): Promise<boolean> => {
    setBusy(id);
    try {
      const r = await task();
      toast({ tone: 'ok', title: typeof done === 'function' ? done(r) : done });
      await refresh();
      return true;
    } catch (e) {
      toast({ tone: 'danger', title: errorText(e, errors, LOAD_FAILED.conductor) });
      return false;
    } finally {
      setBusy(null);
    }
  }, [refresh, errors, toast]);
  return { busy, run };
}
