// 개요 = 사용량 집계(하루별 + Top 5 넷: 조직 · 사용자 · 모델 · 스페이스) + 게이트웨이 상태 요약 + 사람 수.
// 기간 = 주소 ?days=7|30 (사용량 메뉴와 같은 API · features/usage). 모델은 두 번: 호출 Top 5 · 비용 Top 5 (서버가 비용 순으로 자른다 = 모델이 많아도 비싼 모델이 나머지로 빠지지 않는다)
import { useGatewayStatus, usePeriodParam, useStats, useUsage } from '../usage/hooks';
import { OVERVIEW_PERIODS } from '../usage/copy';

const TOP = { limit: 5, series: false } as const; // 묶음 줄만 (흐름 · 증감은 usage 하나가 갖는다)

export function useOverview() {
  const [days, setDays] = usePeriodParam('overview', OVERVIEW_PERIODS, 7);
  return {
    days,
    setDays,
    usage: useUsage(days, 'day'),
    orgs: useUsage(days, 'org', {}, TOP),
    users: useUsage(days, 'user', {}, TOP),
    spaces: useUsage(days, 'space', {}, TOP),
    models: useUsage(days, 'model', {}, TOP),
    modelsByCost: useUsage(days, 'model', {}, { ...TOP, sort: 'cost' }),
    gateway: useGatewayStatus(days),
    stats: useStats(),
  };
}
