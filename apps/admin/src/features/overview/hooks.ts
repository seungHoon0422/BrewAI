// 개요 = 사용량 집계(하루별) + 게이트웨이 상태 요약 + 사람 수. 단위별 추이(묶음 다섯의 하루별 흐름 + Top 5 표)는 그 카드가 단위 · 기준마다 부른다 (useUnitTrend).
// 기간 = 주소 ?days=7|30 (사용량 메뉴와 같은 API · features/usage)
import type { BreakdownGroup, Metric } from '../usage/copy';
import { METRIC_SORT, OVERVIEW_PERIODS } from '../usage/copy';
import { useGatewayStatus, usePeriodParam, useStats, useUsage } from '../usage/hooks';

export function useOverview() {
  const [days, setDays] = usePeriodParam('overview', OVERVIEW_PERIODS, 7);
  return {
    days,
    setDays,
    usage: useUsage(days, 'day'),
    gateway: useGatewayStatus(days),
    stats: useStats(),
  };
}

// 묶음 다섯 (기준 큰 순 · 서버가 자른 나머지 = others) + 묶음마다 하루별 흐름 (trend) — 흐름 · 증감은 usage 하나가 갖는다 (series 없음)
export const useUnitTrend = (days: number, unit: BreakdownGroup, metric: Metric) =>
  useUsage(days, unit, {}, { limit: 5, series: false, trend: true, sort: METRIC_SORT[metric] });
