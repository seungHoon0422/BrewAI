// 진행 상황 상태 — 이 창의 진행 중인 실행(chat store) + 최근 실행(GET /api/runs, 실행이 끝날 때마다 · 돌고 있으면 3초마다 다시).
import { useEffect, useMemo, useState } from 'react';
import { failureOf, isAbort, type Failure } from '../../lib/api';
import { useChat } from '../chat/hooks';
import { isLive, type Answer } from '../chat/model';
import { listRuns, type RunRow } from './api';

export type LiveRun = { threadId: string; title: string; answer: Answer };
export type Runs = { status: 'loading' | 'ready' | 'error'; rows: RunRow[]; error: Failure | null };

const POLL_MS = 3000;

export function useLiveRuns(): LiveRun[] {
  const convs = useChat((s) => s.convs);
  return useMemo(
    () =>
      Object.values(convs).flatMap((c) =>
        c.turns.filter((t) => isLive(t.answer)).map((t) => ({ threadId: c.id, title: c.title, answer: t.answer })),
      ),
    [convs],
  );
}

// live = 이 창에서 도는 실행이 있나 (있으면 목록도 새로 읽는다)
export function useRecentRuns(liveCount: number): { runs: Runs; reload: () => void } {
  const version = useChat((s) => s.runsVersion);
  const [runs, setRuns] = useState<Runs>({ status: 'loading', rows: [], error: null });
  const [tick, setTick] = useState(0);
  const serverRunning = runs.rows.some((r) => r.status === 'running');

  useEffect(() => {
    const ctrl = new AbortController();
    listRuns(ctrl.signal).then(
      (rows) => setRuns({ status: 'ready', rows, error: null }),
      (e) => {
        if (!isAbort(e)) setRuns((r) => ({ ...r, status: 'error', error: failureOf(e) }));
      },
    );
    return () => ctrl.abort();
  }, [version, tick]);

  // 다른 창에서 돌고 있는 실행이 있으면 3초마다 다시 (이 창 실행은 store 가 실시간)
  useEffect(() => {
    if (!serverRunning && liveCount === 0) return;
    const t = setInterval(() => setTick((x) => x + 1), POLL_MS);
    return () => clearInterval(t);
  }, [serverRunning, liveCount]);

  return { runs, reload: () => setTick((x) => x + 1) };
}
