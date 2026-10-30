// 작은 store — 라이브러리 없이 useSyncExternalStore. 상태는 바꿀 때마다 새 객체 (React 가 바뀐 곳만 다시 그린다).
// 기능마다 하나씩 (features/<이름>/hooks.ts). 화면 밖에 있어서 메뉴를 옮겨도 상태가 남는다.
import { useSyncExternalStore } from 'react';

export type Store<S> = {
  get: () => S;
  set: (fn: (s: S) => S) => void;
  use: <T>(pick: (s: S) => T) => T;
  // 화면 밖에서 따라가기 (다른 기능이 '스페이스가 바뀌면 다시 읽기' 등). pick 값이 바뀔 때만 부른다
  watch: <T>(pick: (s: S) => T, fn: (now: T, before: T) => void) => () => void;
};

export function createStore<S>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return {
    get: () => state,
    set(fn) {
      const next = fn(state);
      if (next === state) return;
      state = next;
      for (const l of listeners) l();
    },
    use: (pick) => useSyncExternalStore(subscribe, () => pick(state)),
    watch(pick, fn) {
      let before = pick(state);
      return subscribe(() => {
        const now = pick(state);
        if (Object.is(now, before)) return;
        const was = before;
        before = now;
        fn(now, was);
      });
    },
  };
}

// 불러오는 목록 한 칸 (모델 · 스킬 · 최근 대화)
export type Loadable<T, F = string> = { status: 'loading' | 'ready' | 'error'; list: T[]; error: F | null };
export const loading = <T, F>(): Loadable<T, F> => ({ status: 'loading', list: [], error: null });

// 같은 요청이 겹치면 하나만 (끝나면 다음 요청을 받는다)
export function single(run: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    pending ??= run().finally(() => {
      pending = null;
    });
    return pending;
  };
}
