// 설정 › 사용량 — 내 호출 · 토큰 · 추정 비용 · 캐시 적중률 (기간 7 · 30 · 90일) + 하루별 호출 + 모델별 · 스페이스별. 나만 (GET /api/me/usage)
import { useEffect, useState } from 'react';
import {
  BarList, Button, Callout, ProviderIcon, Segmented, Skeleton, StatTile, TimeSeriesChart, deltaOf, formatCompact, formatNumber,
} from '@brewai/ui';
import { isAbort } from '../../../lib/api';
import { Page, Section } from '../../shell/components/Page';
import { getMyUsage, type Days, type Usage } from '../api';
import { USAGE } from '../copy';

type Loaded = { day: Usage; model: Usage; space: Usage };
const DAYS: readonly Days[] = [7, 30, 90];
const usd = (v: number) => (v >= 100 ? `$${formatNumber(Math.round(v))}` : `$${v.toFixed(v >= 1 ? 2 : 4)}`);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const runsText = (v: number) => USAGE.runsUnit(formatNumber(v));

export function UsageScreen() {
  const [days, setDays] = useState<Days>(30);
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    setFailed(false);
    Promise.all((['day', 'model', 'space'] as const).map((g) => getMyUsage(days, g, ctl.signal))).then(
      ([day, model, space]) => setData({ day, model, space }),
      (e) => {
        if (!isAbort(e)) setFailed(true);
      },
    );
    return () => ctl.abort();
  }, [days, tick]);

  const t = data?.day.totals;
  const prev = data?.day.previous;
  return (
    <Page id="settings/usage" sub={USAGE.sub}>
      <div className="usage-bar">
        <Segmented label={USAGE.period} size="sm" value={String(days)} onChange={(v) => setDays(Number(v) as Days)}
          options={DAYS.map((d) => ({ value: String(d), label: USAGE.days(d) }))} />
      </div>
      {failed && (
        <Callout tone="danger" action={<Button size="sm" onClick={() => setTick((n) => n + 1)}>{USAGE.retry}</Button>}>{USAGE.failed}</Callout>
      )}
      {!data || !t ? (
        !failed && <Skeleton lines={4} />
      ) : (
        <>
          <div className="usage-kpis">
            <StatTile data-kpi="runs" label={USAGE.runs} value={formatNumber(t.runs)} sub={USAGE.runsSub(t.errors)}
              delta={prev ? deltaOf(t.runs, prev.runs) : undefined} deltaNote={USAGE.vsPrev(days)} />
            <StatTile data-kpi="tokens" label={USAGE.tokens} value={formatCompact(t.tokens)} exact={formatNumber(t.tokens)}
              sub={USAGE.tokensSub(formatCompact(t.input_tokens), formatCompact(t.output_tokens))}
              delta={prev ? deltaOf(t.tokens, prev.tokens) : undefined} deltaNote={USAGE.vsPrev(days)} />
            <StatTile data-kpi="cost" label={USAGE.cost} value={t.cost_usd === null ? '—' : usd(t.cost_usd)} sub={USAGE.costSub(t.cost_runs)} />
            <StatTile data-kpi="cache" label={USAGE.cache} value={pct(t.cache_hit_rate)} sub={USAGE.cacheSub} />
          </div>

          <Section title={USAGE.trend}>
            {t.runs === 0 ? <p className="usage-none">{USAGE.none}</p> : (
              <TimeSeriesChart label={USAGE.trend} x={data.day.series.map((r) => r.date)} xLabel={md} area
                series={[{ id: 'runs', label: USAGE.runs, values: data.day.series.map((r) => r.runs) }]} />
            )}
          </Section>

          <div className="usage-grid">
            <Section title={USAGE.byModel}>
              {data.model.groups.length === 0 ? <p className="usage-none">{USAGE.none}</p> : (
                <BarList label={USAGE.byModel} format={runsText}
                  items={data.model.groups.map((g) => ({
                    key: g.key, label: g.label ?? g.key, value: g.runs, aside: formatCompact(g.tokens),
                    icon: g.provider ? <ProviderIcon provider={g.provider} size="sm" /> : undefined,
                  }))} />
              )}
            </Section>
            <Section title={USAGE.bySpace}>
              {data.space.groups.length === 0 ? <p className="usage-none">{USAGE.none}</p> : (
                <BarList label={USAGE.bySpace} format={runsText}
                  items={data.space.groups.map((g) => ({
                    key: g.key, label: g.kind === 'personal' ? USAGE.personal : g.label ?? g.key,
                    sub: g.kind === 'personal' ? undefined : g.sub ?? undefined, value: g.runs, aside: formatCompact(g.tokens),
                  }))} />
              )}
            </Section>
          </div>
        </>
      )}
    </Page>
  );
}
