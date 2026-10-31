import { BarList, LinkButton, Meta, ProviderIcon, Skeleton, TimeSeriesChart } from '@brewai/ui';
import { Section } from '../../../shared/components/parts';
import { modelHref } from '../../models/route';
import type { UsageFilter } from '../api';
import { USAGE_COPY as C, USAGE_LOAD_FAILED, compact, count, dayLabel, money, percent } from '../copy';
import { usageHref, useUsage } from '../hooks';
import '../usage.css';

const DAYS = 30;

// 사용자 · 조직 · 스페이스 서랍의 '사용량' 칸 = 최근 30일 숫자 한 줄 · 하루별 호출 · 많이 쓴 모델 셋 · 사용량 메뉴(그 대상으로 거른) 링크
export function UsageSection({ filter }: { filter: UsageFilter }) {
  const usage = useUsage(DAYS, 'model', filter, 3);
  const d = usage.data;
  return (
    <Section title={C.section} hint={C.sectionHint(DAYS)}>
      <div className="us-section" data-stale={usage.loading && d ? '' : undefined}>
        {!d ? (
          usage.error ? <p className="part-hint" role="alert">{USAGE_LOAD_FAILED[usage.error]}</p> : <Skeleton lines={2} />
        ) : d.totals.runs === 0 ? (
          <p className="part-hint">{C.sectionEmpty(DAYS)}</p>
        ) : (
          <>
            <Meta wrap className="us-section-meta" items={C.summaryLine(count(d.totals.runs), compact(d.totals.tokens), money(d.totals.cost_usd))} />
            <TimeSeriesChart label={C.runsChart} x={d.series.map((s) => s.date)} xLabel={dayLabel} height={110} area
              series={[{ id: 'runs', label: C.seriesRuns, values: d.series.map((s) => s.runs), color: 1 }]} />
            <p className="us-sub">{C.topModels}</p>
            <BarList label={C.topModels} items={d.groups.map((g) => ({
              key: g.key ?? 'unknown', label: g.label ?? g.key ?? C.unknown, value: g.runs, aside: percent(g.share),
              icon: g.provider ? <ProviderIcon provider={g.provider} size="sm" /> : undefined, href: g.key ? modelHref(g.key) : undefined,
            }))} />
          </>
        )}
        <LinkButton size="sm" variant="ghost" iconEnd="arrow-right" href={usageHref({ ...filter, group: filter.user ? 'model' : filter.space ? 'user' : 'space' })}>
          {C.openUsage}
        </LinkButton>
      </div>
    </Section>
  );
}
