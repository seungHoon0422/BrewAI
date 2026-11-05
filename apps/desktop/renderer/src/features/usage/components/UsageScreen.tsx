// 설정 › 사용량 — 내 호출 · 토큰 · 추정 비용 · 캐시 적중률 (기간 7 · 30 · 90일) + 하루별 호출 + 세부 보기 (모델 · 프로젝트 · 스페이스 · 조직).
// 세부 보기 표의 줄을 누르면 그 항목으로 거른다 (칩 · ✕ 로 해제 · 분류마다 하나 · 여러 분류를 겹쳐 거를 수 있다). 나만 (GET /api/me/usage)
import { useEffect, useState } from 'react';
import {
  Button, Callout, Chip, ProviderIcon, Segmented, Skeleton, StatTile, Table, Tabs, TimeSeriesChart, deltaOf, formatCompact, formatNumber,
  type Column,
} from '@brewai/ui';
import { isAbort } from '../../../lib/api';
import { Page, Section } from '../../shell/components/Page';
import { getMyUsage, type Days, type Dim, type Filters, type GroupRow, type Usage } from '../api';
import { DIMS, USAGE, dimLabel } from '../copy';

const DAYS: readonly Days[] = [7, 30, 90];
const usd = (v: number) => (v >= 100 ? `$${formatNumber(Math.round(v))}` : `$${v.toFixed(v >= 1 ? 2 : 4)}`);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const secs = (ms: number | null) => (ms === null ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}초`);

// 줄 이름 (서버가 이름을 비워 둔 것 = 화면이 붙인다: 내 스페이스 · 프로젝트 밖)
function nameOf(dim: Dim, g: GroupRow): string {
  if (dim === 'space' && g.kind === 'personal') return USAGE.personal;
  if (dim === 'project' && g.key === 'none') return USAGE.noProject;
  return g.label ?? g.key;
}

export function UsageScreen() {
  const [days, setDays] = useState<Days>(30);
  const [dim, setDim] = useState<Dim>('model');
  const [filters, setFilters] = useState<Filters>({});
  const [day, setDay] = useState<Usage | null>(null);
  const [groups, setGroups] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  // 합계 · 하루별 = 기간 · 거르개가 바뀔 때 / 세부 표 = 그에 더해 분류가 바뀔 때
  useEffect(() => {
    const ctl = new AbortController();
    setFailed(false);
    getMyUsage(days, 'day', filters, ctl.signal).then(setDay, (e) => {
      if (!isAbort(e)) setFailed(true);
    });
    return () => ctl.abort();
  }, [days, filters, tick]);
  useEffect(() => {
    const ctl = new AbortController();
    setGroups(null);
    getMyUsage(days, dim, filters, ctl.signal).then(setGroups, (e) => {
      if (!isAbort(e)) setFailed(true);
    });
    return () => ctl.abort();
  }, [days, dim, filters, tick]);

  const pick = (g: GroupRow) => setFilters((f) => ({ ...f, [dim]: { key: g.key, label: nameOf(dim, g) } }));
  const unpick = (d: Dim) => setFilters((f) => {
    const next = { ...f };
    delete next[d];
    return next;
  });
  const picked = DIMS.filter((d) => filters[d.id]);

  const columns: Column<GroupRow>[] = [
    {
      key: 'name', header: USAGE.col.name, rowHeader: true,
      cell: (g) => (
        <span className="usage-name" title={USAGE.pick(nameOf(dim, g))}>
          {dim === 'model' && g.provider && <ProviderIcon provider={g.provider} size="sm" />}
          <span className="ui-ell">{nameOf(dim, g)}</span>
          {g.sub && dim !== 'model' && <span className="usage-sub">{g.sub}</span>}
        </span>
      ),
    },
    { key: 'runs', header: USAGE.col.runs, cell: (g) => <span className="ui-num">{formatNumber(g.runs)}</span>, width: '80px' },
    { key: 'tokens', header: USAGE.col.tokens, cell: (g) => <span className="ui-num" title={formatNumber(g.tokens)}>{formatCompact(g.tokens)}</span>, width: '84px' },
    { key: 'cost', header: USAGE.col.cost, cell: (g) => <span className="ui-num">{g.cost_usd === null ? '—' : usd(g.cost_usd)}</span>, width: '96px', hideBelow: 'md' },
    { key: 'errors', header: USAGE.col.errors, cell: (g) => <span className="ui-num" data-bad={g.errors ? '' : undefined}>{pct(g.error_rate)}</span>, width: '72px', hideBelow: 'md' },
    { key: 'time', header: USAGE.col.time, cell: (g) => <span className="ui-num">{secs(g.avg_duration_ms)}</span>, width: '84px', hideBelow: 'lg' },
    {
      key: 'share', header: USAGE.col.share, width: '120px',
      cell: (g) => (
        <span className="usage-share" title={pct(g.share)}>
          <span className="bar" aria-hidden="true"><i style={{ width: `${Math.max(2, g.share * 100)}%` }} /></span>
          <span className="ui-num">{pct(g.share)}</span>
        </span>
      ),
    },
  ];

  const t = day?.totals;
  const prev = day?.previous;
  return (
    <Page id="settings/usage" sub={USAGE.sub}>
      <div className="usage-bar">
        {picked.length > 0 && (
          <div className="usage-chips" role="group" aria-label={USAGE.filtered}>
            {picked.map((d) => (
              <Chip key={d.id} selected icon="close" aria-label={USAGE.clear(filters[d.id]!.label)} onClick={() => unpick(d.id)}>
                {d.label}: {filters[d.id]!.label}
              </Chip>
            ))}
            {picked.length > 1 && <Button size="sm" variant="ghost" onClick={() => setFilters({})}>{USAGE.clearAll}</Button>}
          </div>
        )}
        <span className="grow" />
        <Segmented label={USAGE.period} size="sm" value={String(days)} onChange={(v) => setDays(Number(v) as Days)}
          options={DAYS.map((d) => ({ value: String(d), label: USAGE.days(d) }))} />
      </div>
      {failed && (
        <Callout tone="danger" action={<Button size="sm" onClick={() => setTick((x) => x + 1)}>{USAGE.retry}</Button>}>{USAGE.failed}</Callout>
      )}
      {!day || !t ? (
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
              <TimeSeriesChart label={USAGE.trend} x={day.series.map((r) => r.date)} xLabel={md} area
                series={[{ id: 'runs', label: USAGE.runs, values: day.series.map((r) => r.runs) }]} />
            )}
          </Section>

          <Section title={USAGE.detail} extra={<span className="usage-hint">{USAGE.detailHint}</span>}>
            <Tabs label={USAGE.detail} value={dim} onChange={setDim} className="usage-tabs"
              items={DIMS.map((d) => ({ id: d.id, label: d.label }))}>
              <Table label={USAGE.table(dimLabel(dim))} columns={columns} rows={groups?.groups ?? []} rowKey={(g) => g.key}
                loading={groups === null} density="compact" onRowClick={pick} activeKey={filters[dim]?.key}
                empty={<span className="usage-none">{USAGE.none}</span>} />
              {groups && groups.others > 0 && <p className="usage-none usage-more">{USAGE.others(groups.others)}</p>}
            </Tabs>
          </Section>
        </>
      )}
    </Page>
  );
}
