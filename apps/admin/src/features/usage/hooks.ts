// 사용량 상태 = 주소(해시 ?days · group · org · space · user · model) + 서버 집계. 기간 · 거르개를 바꾸는 동안 앞 그림을 흐리게 들고 있다 (뼈대 깜박임 없음)
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHash } from '../../app/hash';
import { hrefOf, queryOf, type RouteId } from '../../app/routes';
import { loadErrorOf, type LoadError } from '../../shared/http';
import { getGatewayStatus, getStats, getUsage, type UsageFilter, type UsageGroup } from './api';
import { GROUP_ORDER, PERIODS, type BreakdownGroup, type Period } from './copy';

export type Kept<T> = { data: T | null; error: LoadError | null; loading: boolean; reload: () => void };

// key 가 바뀌면 다시 읽되, 앞 값(data)은 새 값이 올 때까지 그대로 (loading = 흐리게)
export function useKept<T>(fetcher: (signal: AbortSignal) => Promise<T>, key: string): Kept<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const ref = useRef(fetcher);
  ref.current = fetcher;
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    ref.current(ctrl.signal).then(
      (d) => {
        setData(d);
        setError(null);
        setLoading(false);
      },
      (e) => {
        const err = loadErrorOf(e);
        if (!err) return;
        setError(err);
        setLoading(false);
      },
    );
    return () => ctrl.abort();
  }, [key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

const keyOf = (...parts: unknown[]) => JSON.stringify(parts);

export function useUsage(days: number, group: UsageGroup, filter: UsageFilter = {}, limit = 50, series = true) {
  return useKept((signal) => getUsage(days, group, filter, signal, limit, series), keyOf(days, group, filter, limit, series));
}

export function useGatewayStatus(days: number) {
  return useKept((signal) => getGatewayStatus(days, signal), keyOf('gw', days));
}

export function useStats() {
  return useKept((signal) => getStats(signal), 'stats');
}

/* ── 주소 = 화면 상태 ('#/usage?days=30&group=space&org=o1') ── */
const FILTER_KEYS = ['org', 'space', 'user', 'model'] as const;

export function usePeriodParam(route: RouteId, allowed: readonly number[] = PERIODS, fallback: number = allowed[0]) {
  const q = queryOf(useHash());
  const raw = Number(q.get('days'));
  const days = allowed.includes(raw) ? raw : fallback;
  const setDays = (d: number) => {
    const next = Object.fromEntries(q);
    window.location.replace(hrefOf(route, undefined, { ...next, days: d === fallback ? null : d }));
  };
  return [days, setDays] as const;
}

export function useUsageRoute() {
  const q = queryOf(useHash());
  const rawDays = Number(q.get('days'));
  const days: Period = (PERIODS as readonly number[]).includes(rawDays) ? (rawDays as Period) : 30;
  const group: BreakdownGroup = GROUP_ORDER.find((g) => g === q.get('group')) ?? 'org';
  const filter: UsageFilter = {};
  FILTER_KEYS.forEach((k) => {
    const v = q.get(k);
    if (v) filter[k] = v;
  });
  // 바꾸기 = 주소 바꾸기 (replace = 뒤로 가기 기록을 쌓지 않는다 · 링크로 그대로 나눌 수 있다)
  const set = (patch: { days?: number; group?: BreakdownGroup } & Partial<Record<(typeof FILTER_KEYS)[number], string | null>>) => {
    const next = { days, group, ...filter, ...patch };
    window.location.replace(usageHref(next));
  };
  return { days, group, filter, set, filtered: FILTER_KEYS.some((k) => filter[k]) };
}

// 사용량 메뉴로 가는 링크 (개요 · 서랍 · 표가 쓴다). 기본값(30일 · 조직)은 주소에서 뺀다
export function usageHref(p: { days?: number; group?: BreakdownGroup } & Partial<Record<(typeof FILTER_KEYS)[number], string | null>>) {
  return hrefOf('usage', undefined, {
    days: p.days === 30 ? null : p.days, group: p.group === 'org' ? null : p.group,
    org: p.org, space: p.space, user: p.user, model: p.model,
  });
}
