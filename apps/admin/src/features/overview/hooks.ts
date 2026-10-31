// 개요 = 사용량 집계 셋(하루별 · 조직별 · 모델별) + 게이트웨이 상태 요약 + 사람 수. 기간 = 주소 ?days=7|30 (사용량 메뉴와 같은 API · features/usage)
import { useGatewayStatus, usePeriodParam, useStats, useUsage } from '../usage/hooks';
import { OVERVIEW_PERIODS } from '../usage/copy';

export function useOverview() {
  const [days, setDays] = usePeriodParam('overview', OVERVIEW_PERIODS, 7);
  return {
    days,
    setDays,
    usage: useUsage(days, 'day'),
    orgs: useUsage(days, 'org', {}, 6, false), // 묶음 줄만 (흐름 · 증감은 usage 하나가 갖는다)
    models: useUsage(days, 'model', {}, 5, false),
    gateway: useGatewayStatus(days),
    stats: useStats(),
  };
}
