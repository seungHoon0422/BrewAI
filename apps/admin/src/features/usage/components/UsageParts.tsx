// 사용량 조각 = 숫자 카드 줄 · 흐름 차트 (척도가 다르면 차트를 나눈다 · 축 하나씩) · 종류별 막대 · Top 표 · 묶음 줄 이름.
// 개요 · 사용량 메뉴 · 모델 자세히가 같이 쓴다
import type { ReactNode } from 'react';
import { BarList, Card, CardHeader, LinkButton, ProviderIcon, ShareBar, StatTile, TimeSeriesChart, deltaOf, vizSlot, type BarItem, type ShareItem, type StatDelta } from '@brewai/ui';
import { modelHref } from '../../models/route';
import { TOKEN_KINDS, type ByKind, type UsageOthers, type UsageRow, type UsageSummary, type UsageTotals } from '../api';
import {
  TOKEN_KIND_LABEL, USAGE_COPY as C, compact, count, dayLabel, money, moneyAxis, percent,
  type BreakdownGroup, type Metric,
} from '../copy';
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
  const tiles: { key: KpiKey; value: string; exact?: string; sub?: string; delta?: StatDelta; trend: number[]; icon: 'chat' | 'text' | 'receipt' | 'people' | 'alert' }[] = [
    { key: 'runs', value: count(t.runs), delta: deltaOf(t.runs, p.runs), trend: series.map((s) => s.runs), icon: 'chat', sub: C.runsSub(count(t.requests)) },
    { key: 'tokens', value: compact(t.tokens), exact: C.exactTokens(count(t.tokens), count(t.input_tokens), count(t.output_tokens)), delta: deltaOf(t.tokens, p.tokens), trend: series.map((s) => s.tokens), icon: 'text',
      sub: C.tokensSub(compact(t.input_tokens), compact(t.output_tokens)) },
    { key: 'cost', value: money(t.cost_usd), exact: t.cost_usd === null ? undefined : C.exactCost(exactMoney(t.cost_usd)), delta: t.cost_usd === null || (p.cost_usd === null && p.ok > 0) ? undefined : deltaOf(t.cost_usd, p.cost_usd ?? 0, { upIsGood: false }),
      trend: series.map((s) => s.cost_usd ?? 0), icon: 'receipt', sub: t.runs && t.cost_usd === null ? C.costNone : C.costSub(Math.max(0, unknownCost)) },
    { key: 'users', value: count(t.active_users), delta: deltaOf(t.active_users, p.active_users), trend: series.map((s) => s.active_users), icon: 'people', sub: C.usersSub },
    { key: 'errors', value: percent(t.error_rate), delta: pointsDelta(t.error_rate, p.error_rate, t.runs + p.runs > 0),
      trend: series.map((s) => s.error_rate), icon: 'alert', sub: C.errorsSub(t.errors, t.cancelled) },
  ];
  return (
    <div className="us-kpis">
      {tiles.map((k) => (
        <StatTile key={k.key} data-kpi={k.key} label={C.kpi[k.key]} value={k.value} exact={k.exact} sub={k.sub} delta={withLabel(k.delta, days)} trend={k.trend}
          icon={k.icon} href={hrefs?.[k.key]} deltaNote={k.delta && C.vsPrevious(days)} />
      ))}
    </div>
  );
}

// 비용 실제 값 (소수 6자리까지 · 끝 0 없음) — 줄인 값($0.86)에 마우스를 올리면
export const exactMoney = (v: number) => `$${v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;

// 줄인 숫자(34.1만) + 실제 값 풍선 (표 칸 = 브라우저 title · 표 틀이 넘침을 자른다)
export const Compact = ({ v }: { v: number }) => <span className="ui-num" title={count(v)}>{compact(v)}</span>;

// 비용 색 = 한 칸 (보라 7). 종류 막대(1~5)와 겹치지 않게 · 개요 '모델별' 비용 막대와 같은 색 = 돈
export const COST_COLOR = 7;

// 작은 흐름 둘 = 호출 · 추정 비용 (척도가 달라 한 축에 겹치지 않는다 → 위아래 작은 차트 둘 · 같은 날짜 축). 개요 · 모델 자세히
export function TrendPair({ data, height = 104 }: { data: UsageSummary; height?: number }) {
  const x = data.series.map((s) => s.date);
  return (
    <div className="us-pair">
      <TimeSeriesChart label={C.runsChart} x={x} xLabel={dayLabel} height={height} area legend
        series={[{ id: 'runs', label: C.seriesRuns, values: data.series.map((s) => s.runs), color: 1 }]} />
      <TimeSeriesChart label={C.costChart} x={x} xLabel={dayLabel} height={height} area legend integer={false} format={money} axisFormat={moneyAxis}
        series={[{ id: 'cost', label: C.seriesCost, values: data.series.map((s) => s.cost_usd ?? 0), color: COST_COLOR }]} />
    </div>
  );
}

// 사용량 메뉴의 흐름 = 기준(호출 · 토큰 · 비용) 하나. 호출 = 호출 + 실패 · 토큰 = 입력 + 출력 · 비용 = 추정 비용
export function MetricTrend({ data, metric, height = 200 }: { data: UsageSummary; metric: Metric; height?: number }) {
  const x = data.series.map((s) => s.date);
  const title = C.trendChart(metric);
  const chart =
    metric === 'cost' ? (
      <TimeSeriesChart label={title} x={x} xLabel={dayLabel} height={height} area integer={false} format={money} axisFormat={moneyAxis}
        series={[{ id: 'cost', label: C.seriesCost, values: data.series.map((s) => s.cost_usd ?? 0), color: COST_COLOR }]} />
    ) : metric === 'tokens' ? (
      <TimeSeriesChart label={title} x={x} xLabel={dayLabel} height={height}
        series={[
          { id: 'input', label: C.seriesInput, values: data.series.map((s) => s.input_tokens), color: 1 },
          { id: 'output', label: C.seriesOutput, values: data.series.map((s) => s.output_tokens), color: 3 },
        ]} />
    ) : (
      <TimeSeriesChart label={title} x={x} xLabel={dayLabel} height={height} area
        series={[
          { id: 'runs', label: C.seriesRuns, values: data.series.map((s) => s.runs), color: 1 },
          { id: 'errors', label: C.seriesErrors, values: data.series.map((s) => s.errors), color: 4 },
        ]} />
    );
  return (
    <Card as="section" aria-label={title}>
      <CardHeader title={title} />
      {chart}
    </Card>
  );
}

// 종류별 막대 (토큰 또는 비용). 색 = 종류마다 고정 칸 (입력 1 · 출력 2 · 생각 3 · 캐시 읽기 4 · 캐시 쓰기 5)
export function kindItems(values: ByKind, fmt: (v: number) => string): ShareItem[] {
  return TOKEN_KINDS.map((k, i) => ({ key: k, label: TOKEN_KIND_LABEL[k], value: values[k], valueText: fmt(values[k]), color: vizSlot(i) }));
}

export function KindShare({ totals, cost, label }: { totals: UsageTotals; cost: boolean; label: string }) {
  if (cost && !totals.cost_by_kind) return <p className="us-note">{C.costNone}</p>;
  const items = cost ? kindItems(totals.cost_by_kind!, money) : kindItems(totals.tokens_by_kind, compact);
  return (
    <div className="us-kinds">
      <ShareBar label={label} items={items} format={cost ? money : compact} />
      {cost && totals.cost_estimated_runs > 0 && <p className="us-note">{C.estimated(totals.cost_estimated_runs)}</p>}
    </div>
  );
}

// 비용 칸 = 값 + 풍선(종류별 비용). 표 틀이 넘침을 자르므로 브라우저 title 풍선 + 화면 낭독용 글
export function CostCell({ t }: { t: Pick<UsageTotals, 'cost_usd' | 'cost_by_kind'> }) {
  if (t.cost_usd === null || !t.cost_by_kind) return <span className="ui-num">{money(t.cost_usd)}</span>;
  const parts = TOKEN_KINDS.filter((k) => t.cost_by_kind![k] > 0).map((k) => `${TOKEN_KIND_LABEL[k]} ${money(t.cost_by_kind![k])}`);
  const text = parts.join(', ');
  return (
    <span className="ui-num us-cost" title={text} data-breakdown={text}>
      {money(t.cost_usd)}
      {parts.length > 0 && <span className="ui-sr">, {text}</span>}
    </span>
  );
}

// Top 표 (개요 · 모델 자세히의 카드 안). 줄 = 이름(링크) · 호출 · 토큰 · 비용 + 이름 아래 얇은 막대(기준 비율). 상세보기 = 사용량 메뉴(그 묶음)
export type TopItem = { key: string; name: string; sub?: string; icon?: ReactNode; href?: string; row: UsageTotals };

export function TopCard({ title, hint, items, others, more, metric = 'calls', empty }: {
  title: string;
  hint?: string;
  items: TopItem[];
  others?: UsageOthers | null;
  more?: string; // 상세보기 링크
  metric?: Metric; // 막대 기준
  empty: string;
}) {
  return (
    <Card as="section" aria-label={title} className="us-topcard">
      <CardHeader title={title} description={hint}
        actions={more ? <LinkButton size="sm" variant="ghost" iconEnd="arrow-right" href={more}>{C.more}</LinkButton> : undefined} />
      <TopTable label={title} items={items} others={others} metric={metric} empty={empty} />
    </Card>
  );
}

// Top 표만 (카드 없이 · 개요 '단위별 추이' 카드 안) — 줄 = 이름(링크) · 호출 · 토큰 · 비용 + 이름 아래 얇은 막대(기준 비율)
export function TopTable({ label, items, others, metric = 'calls', empty }: {
  label: string;
  items: TopItem[];
  others?: UsageOthers | null;
  metric?: Metric;
  empty: string;
}) {
  const val = (t: UsageTotals) => (metric === 'cost' ? t.cost_usd ?? 0 : metric === 'tokens' ? t.tokens : t.runs);
  const top = Math.max(0, ...items.map((i) => val(i.row)));
  return (
    <>
      {items.length === 0 ? (
        <p className="us-note">{empty}</p>
      ) : (
        <table className="ui-table us-top" data-density="compact" aria-label={label}>
          <thead>
            <tr>
              <th scope="col">{C.col.name}</th>
              <th scope="col" data-align="end">{C.col.runs}</th>
              <th scope="col" data-align="end">{C.col.tokens}</th>
              <th scope="col" data-align="end">{C.col.cost}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const pct = top > 0 ? Math.max(val(it.row) > 0 ? 2 : 0, (val(it.row) / top) * 100) : 0;
              const name = (
                <>
                  {it.icon}
                  <span className="us-top-text">
                    <b className="ui-ell">{it.name}</b>
                    {it.sub && <span className="ui-ell">{it.sub}</span>}
                  </span>
                </>
              );
              return (
                <tr key={it.key} data-rank={i + 1}>
                  <th scope="row">
                    {it.href ? <a className="us-top-name" href={it.href}>{name}</a> : <span className="us-top-name">{name}</span>}
                    <span className="us-top-track" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
                  </th>
                  <td data-align="end" className="ui-num">{count(it.row.runs)}</td>
                  <td data-align="end"><Compact v={it.row.tokens} /></td>
                  <td data-align="end"><CostCell t={it.row} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {others && <p className="us-note">{C.others(others.count)} {C.summaryLine(count(others.runs), compact(others.tokens), money(others.cost_usd)).join(', ')}</p>}
    </>
  );
}

// 묶음 줄 → Top 표 한 줄 (이름 · 아래 줄 · 모델이면 제공사 아이콘)
export function topItem(group: BreakdownGroup, r: UsageRow, href?: string): TopItem {
  const { name, sub } = rowName(group, r);
  return {
    key: r.key ?? 'unknown', name, sub, href: r.key ? href : undefined, row: r,
    icon: group === 'model' && r.provider ? <ProviderIcon provider={r.provider} size="sm" /> : undefined,
  };
}

export const metricValue = (m: Metric, t: UsageTotals) => (m === 'cost' ? t.cost_usd ?? 0 : m === 'tokens' ? t.tokens : t.runs);
export const metricText = (m: Metric, t: UsageTotals) => (m === 'cost' ? money(t.cost_usd) : m === 'tokens' ? compact(t.tokens) : count(t.runs));

// 묶음 한 줄의 이름 · 아래 줄 (null = 알 수 없음 · 내 스페이스 전부)
export function rowName(group: BreakdownGroup, r: UsageRow): { name: string; sub?: string } {
  if (group === 'space' && r.key === 'personal') return { name: C.personal, sub: C.personalSub };
  if (!r.key || !r.label) return { name: r.key && group === 'model' ? r.key : C.unknown, sub: undefined };
  return { name: r.label, sub: group === 'model' ? r.key : group === 'org' ? undefined : r.sub ?? undefined }; // 조직 slug 는 뜻이 없어 뺀다
}

// 비용 분해 = 토큰 종류별 비중(캐시 아닌 입력 · 생각 뺀 출력 · 생각 · 캐시 읽기 · 캐시 쓰기) + 모델별 비용(서버가 비용 순으로 자른 Top 5 막대 + 나머지).
// 사용량 메뉴 (개요에서 옮김 · 2026-11-04 사용자). models = 같은 기간 · 거르개의 모델 묶음 (비용 순). 모델별은 비용 색 한 칸 (종류 막대와 색이 겹치지 않게)
export function CostBreakdown({ data, models }: { data: UsageSummary; models: UsageSummary | null }) {
  const t = data.totals;
  const total = t.cost_usd ?? 0;
  const byCost = (models?.groups ?? []).filter((g) => (g.cost_usd ?? 0) > 0);
  const items: BarItem[] = byCost.map((g) => ({
    key: g.key ?? 'unknown', label: g.label ?? g.key ?? C.unknown, value: g.cost_usd ?? 0, valueText: money(g.cost_usd),
    aside: total ? percent((g.cost_usd ?? 0) / total) : undefined, color: COST_COLOR, href: g.key ? modelHref(g.key) : undefined,
    icon: g.provider ? <ProviderIcon provider={g.provider} size="sm" /> : undefined,
  }));
  const tail = models?.others;
  const tailCost = tail?.cost_usd ?? 0;
  return (
    <Card as="section" aria-label={C.cost} className="us-costcard">
      <CardHeader title={C.cost} description={C.costHint} />
      <div className="us-costcard-total">
        <b className="ui-num ui-exact" data-exact={t.cost_usd === null ? undefined : C.exactCost(exactMoney(t.cost_usd))}>{money(t.cost_usd)}</b>
        <span className="us-note">{C.kpi.cost}, {C.cacheHit} {percent(t.cache_hit_rate)}</span>
      </div>
      <div className="us-costcard-body">
        <div className="us-costcard-part">
          <p className="us-sub">{C.costKinds}</p>
          <KindShare totals={t} cost label={C.costKinds} />
        </div>
        {items.length > 0 && (
          <div className="us-costcard-part">
            <p className="us-sub">{C.costModels} <span className="us-note">{C.costModelsHint}</span></p>
            <BarList label={C.costModels} items={items} format={money} />
            {tail && tailCost > 0 && <p className="us-note">{C.modelsOther(tail.count)} {money(tailCost)}</p>}
          </div>
        )}
      </div>
      {t.runs > 0 && t.cost_runs < t.ok && <p className="us-note">{C.costSub(t.ok - t.cost_runs)}</p>}
    </Card>
  );
}
