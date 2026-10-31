// 사용량 조각 = 숫자 카드 줄 · 흐름 차트 둘 (호출 · 토큰 = 척도가 달라 차트를 나눈다 · 축 하나씩) · 묶음 줄 이름. 개요와 사용량 메뉴가 같이 쓴다
import { Card, CardHeader, StatTile, TimeSeriesChart, deltaOf, type StatDelta } from '@brewai/ui';
import type { UsageRow, UsageSummary } from '../api';
import { USAGE_COPY as C, compact, count, dayLabel, money, percent, type BreakdownGroup } from '../copy';
import '../usage.css';

type KpiKey = keyof typeof C.kpi;
const withLabel = (d: StatDelta | undefined, days: number): StatDelta | undefined => d && { ...d, label: C.deltaLabel(days, d.text) };

// 실패율 = 비율이라 증감도 %p (12% → 15% = +3%p · '+25%' 로 읽히지 않게). 오름 = 나쁨
function pointsDelta(now: number, before: number, any: boolean): StatDelta | undefined {
  if (!any) return undefined;
  const pts = Math.round((now - before) * 1000) / 10;
  if (pts === 0) return { text: C.points(0), dir: 'flat', tone: 'neutral' };
  return { text: C.points(pts), dir: pts > 0 ? 'up' : 'down', tone: pts > 0 ? 'bad' : 'good' };
}

// 숫자 카드 다섯 (지난 같은 길이 기간 대비 · 작은 흐름). href = 누르면 그 화면 (개요 → 사용량)
// 비용 증감: 지난 기간에 성공한 호출이 있는데 가격을 몰랐으면(null) 0 으로 치지 않는다 ('처음' 으로 속이지 않게)
export function UsageKpis({ data, hrefs }: { data: UsageSummary; hrefs?: Partial<Record<KpiKey, string>> }) {
  const { totals: t, previous: p, series, days } = data;
  const unknownCost = t.ok - t.cost_runs;
  const tiles: { key: KpiKey; value: string; sub?: string; delta?: StatDelta; trend: number[]; icon: 'chat' | 'text' | 'receipt' | 'people' | 'alert' }[] = [
    { key: 'runs', value: count(t.runs), delta: deltaOf(t.runs, p.runs), trend: series.map((s) => s.runs), icon: 'chat', sub: C.runsSub(count(t.requests)) },
    { key: 'tokens', value: compact(t.tokens), delta: deltaOf(t.tokens, p.tokens), trend: series.map((s) => s.tokens), icon: 'text',
      sub: C.tokensSub(compact(t.input_tokens), compact(t.output_tokens)) },
    { key: 'cost', value: money(t.cost_usd), delta: t.cost_usd === null || (p.cost_usd === null && p.ok > 0) ? undefined : deltaOf(t.cost_usd, p.cost_usd ?? 0, { upIsGood: false }),
      trend: series.map((s) => s.cost_usd ?? 0), icon: 'receipt', sub: t.runs && t.cost_usd === null ? C.costNone : C.costSub(Math.max(0, unknownCost)) },
    { key: 'users', value: count(t.active_users), delta: deltaOf(t.active_users, p.active_users), trend: series.map((s) => s.active_users), icon: 'people', sub: C.usersSub },
    { key: 'errors', value: percent(t.error_rate), delta: pointsDelta(t.error_rate, p.error_rate, t.runs + p.runs > 0),
      trend: series.map((s) => s.error_rate), icon: 'alert', sub: C.errorsSub(t.errors, t.cancelled) },
  ];
  return (
    <div className="us-kpis">
      {tiles.map((k) => (
        <StatTile key={k.key} data-kpi={k.key} label={C.kpi[k.key]} value={k.value} sub={k.sub} delta={withLabel(k.delta, days)} trend={k.trend}
          icon={k.icon} href={hrefs?.[k.key]} deltaNote={k.delta && C.vsPrevious(days)} />
      ))}
    </div>
  );
}

// 흐름 = 호출(성공 + 실패 따로) · 토큰(입력 · 출력). 두 척도를 한 축에 겹치지 않는다
export function UsageTrends({ data, height = 200 }: { data: UsageSummary; height?: number }) {
  const x = data.series.map((s) => s.date);
  return (
    <div className="us-grid">
      <Card as="section" aria-label={C.runsChart}>
        <CardHeader title={C.runsChart} />
        <TimeSeriesChart label={C.runsChart} x={x} xLabel={dayLabel} height={height} area
          series={[
            { id: 'runs', label: C.seriesRuns, values: data.series.map((s) => s.runs), color: 1 },
            { id: 'errors', label: C.seriesErrors, values: data.series.map((s) => s.errors), color: 2 },
          ]} />
      </Card>
      <Card as="section" aria-label={C.tokensChart}>
        <CardHeader title={C.tokensChart} />
        <TimeSeriesChart label={C.tokensChart} x={x} xLabel={dayLabel} height={height}
          series={[
            { id: 'input', label: C.seriesInput, values: data.series.map((s) => s.input_tokens), color: 1 },
            { id: 'output', label: C.seriesOutput, values: data.series.map((s) => s.output_tokens), color: 3 },
          ]} />
      </Card>
    </div>
  );
}

// 묶음 한 줄의 이름 · 아래 줄 (null = 알 수 없음 · 내 스페이스 전부)
export function rowName(group: BreakdownGroup, r: UsageRow): { name: string; sub?: string } {
  if (group === 'space' && r.key === 'personal') return { name: C.personal, sub: C.personalSub };
  if (!r.key || !r.label) return { name: r.key && group === 'model' ? r.key : C.unknown, sub: undefined };
  return { name: r.label, sub: group === 'model' ? r.key : group === 'org' ? undefined : r.sub ?? undefined }; // 조직 slug 는 뜻이 없어 뺀다
}
