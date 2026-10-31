import { useMemo, useState } from 'react';
import { BarList, Button, Callout, Card, CardHeader, EmptyState, ProviderIcon, Segmented, Select, Table, Toolbar, ToolbarSpacer, type Column, type SortState } from '@brewai/ui';
import { modelHref } from '../../models/route';
import { COMMON_COPY } from '../../../shared/copy';
import { useLoad } from '../../../shared/load';
import { listOrgs } from '../../orgs/api';
import { listAdminSpaces } from '../../spaces/api';
import { listUsers } from '../../users/api';
import type { UsageRow } from '../api';
import {
  GROUP_LABEL, GROUP_ORDER, METRICS, METRIC_LABEL, METRIC_SORT, PERIODS, USAGE_COPY as C, USAGE_LOAD_FAILED, compact, count, percent, periodLabel, rangeText,
  type BreakdownGroup, type Metric,
} from '../copy';
import { useGatewayStatus, useUsage, useUsageRoute } from '../hooks';
import { COST_COLOR, CostCell, KindShare, MetricTrend, UsageKpis, metricText, metricValue, rowName } from './UsageParts';

// 사용량 메뉴 = 기간 · 묶음(조직 · 스페이스 · 사용자 · 모델) · 기준(호출 · 토큰 · 비용) · 거르개 → 숫자 카드 · 기준 흐름 · 종류별 · 묶음 막대 · 전체 표.
// 화면 상태는 모두 주소에 (#/usage?group=user&metric=cost&org=…) → 개요 · 모델 자세히의 상세보기가 그대로 연다.
// 줄을 누르면 한 칸 아래로 (조직 → 그 조직의 스페이스 → 그 스페이스의 사용자 → 그 사람의 모델 → 모델 자세히)
const DRILL: Record<BreakdownGroup, BreakdownGroup | null> = { org: 'space', space: 'user', user: 'model', model: null };
const LIMIT = 200; // 표 = 전체 (서버 최대). 넘으면 나머지 한 줄

// 표 정렬 (부품은 그리기만 · 정렬은 여기서). 기본 = 기준 큰 순 (서버 순서)
const SORT_VALUE: Record<string, (r: UsageRow) => number | string> = {
  name: (r) => (r.label ?? r.key ?? '').toLowerCase(),
  runs: (r) => r.runs, errors: (r) => r.error_rate, tokens: (r) => r.tokens, cacheRead: (r) => r.cache_read_tokens,
  cacheWrite: (r) => r.cache_write_tokens, tools: (r) => r.tool_calls, cost: (r) => r.cost_usd ?? -1, share: (r) => r.runs,
};

export default function UsageScreen() {
  const route = useUsageRoute();
  const { days, group, metric, filter } = route;
  const usage = useUsage(days, group, filter, { limit: LIMIT, sort: METRIC_SORT[metric] });
  const options = useFilterOptions(days);
  const data = usage.data;
  const [sort, setSort] = useState<SortState>(null);

  const open = (r: UsageRow) => {
    if (!r.key) return;
    if (group === 'model') return window.location.assign(modelHref(r.key));
    const next = DRILL[group];
    route.set({ [group]: r.key, group: next ?? group });
  };

  const total = data ? metricValue(metric, data.totals) || 1 : 1;
  const rows = useMemo(() => {
    const list = data?.groups ?? [];
    if (!sort) return list;
    const val = SORT_VALUE[sort.key] ?? SORT_VALUE.runs;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [data, sort]);

  const columns: Column<UsageRow>[] = [
    {
      key: 'name', header: C.col.name, rowHeader: true, sortable: true,
      cell: (r) => {
        const { name, sub } = rowName(group, r);
        return (
          <span className="us-name">
            {group === 'model' && r.provider && <ProviderIcon provider={r.provider} size="sm" />}
            <span className="us-name-text"><b className="ui-ell">{name}</b>{sub && <span className="ui-ell">{sub}</span>}</span>
          </span>
        );
      },
    },
    { key: 'runs', header: C.col.runs, sortable: true, cell: (r) => <span className="ui-num">{count(r.runs)}</span> },
    { key: 'errors', header: C.col.errors, sortable: true, hideBelow: 'md', cell: (r) => <span className="ui-num" data-bad={r.errors ? '' : undefined}>{percent(r.error_rate)}</span> },
    { key: 'tokens', header: C.col.tokens, sortable: true, cell: (r) => <span className="ui-num">{compact(r.tokens)}</span> },
    { key: 'cacheRead', header: <span title={C.colTitle.cacheRead}>{C.col.cacheRead}</span>, sortable: true, hideBelow: 'lg', cell: (r) => <span className="ui-num">{compact(r.cache_read_tokens)}</span> },
    { key: 'cacheWrite', header: <span title={C.colTitle.cacheWrite}>{C.col.cacheWrite}</span>, sortable: true, hideBelow: 'lg', cell: (r) => <span className="ui-num">{compact(r.cache_write_tokens)}</span> },
    { key: 'tools', header: C.col.tools, sortable: true, hideBelow: 'lg', cell: (r) => <span className="ui-num">{count(r.tool_calls)}</span> },
    { key: 'cost', header: <span title={C.colTitle.cost}>{C.col.cost}</span>, sortable: true, cell: (r) => <CostCell t={r} /> },
    { key: 'share', header: C.shareOf(metric), hideBelow: 'md', cell: (r) => <span className="ui-num">{percent(metricValue(metric, r) / total)}</span> },
  ];

  return (
    <div className="us">
      <Toolbar label={C.filters}>
        <Segmented size="sm" label={C.period} value={String(days)} onChange={(v) => route.set({ days: Number(v) })}
          options={PERIODS.map((d) => ({ value: String(d), label: periodLabel(d) }))} />
        <Select size="sm" aria-label={C.orgFilter} value={filter.org ?? ''} onChange={(v) => route.set({ org: v || null, space: null })}
          options={[{ value: '', label: C.allOrgs }, ...options.orgs]} />
        <Select size="sm" aria-label={C.spaceFilter} value={filter.space ?? ''} onChange={(v) => route.set({ space: v || null })}
          options={[{ value: '', label: C.allSpaces }, { value: 'personal', label: C.personal }, ...options.spaces.filter((s) => !filter.org || s.org === filter.org)]} />
        <Select size="sm" aria-label={C.userFilter} value={filter.user ?? ''} onChange={(v) => route.set({ user: v || null })}
          options={[{ value: '', label: C.allUsers }, ...options.users]} />
        <Select size="sm" aria-label={C.modelFilter} value={filter.model ?? ''} onChange={(v) => route.set({ model: v || null })}
          options={[{ value: '', label: C.allModels }, ...options.models]} />
        {route.filtered && (
          <Button size="sm" variant="ghost" icon="close" onClick={() => route.set({ org: null, space: null, user: null, model: null })}>{C.clear}</Button>
        )}
        <ToolbarSpacer />
        {data && <span className="us-range ui-num">{rangeText(data.from, data.to)}</span>}
      </Toolbar>

      {usage.error && !data ? (
        <EmptyState icon="plug" title={<span role="alert">{USAGE_LOAD_FAILED[usage.error]}</span>} action={<Button onClick={usage.reload}>{COMMON_COPY.retry}</Button>} />
      ) : !data ? (
        <div className="us-loading" aria-busy="true" />
      ) : (
        <div className="us-body" data-stale={usage.loading ? '' : undefined} aria-busy={usage.loading || undefined}>
          <UsageKpis data={data} />
          {data.totals.runs === 0 ? (
            <EmptyState icon="receipt" title={route.filtered ? C.emptyFiltered : C.empty}>{!route.filtered && <p>{C.emptyHow}</p>}</EmptyState>
          ) : (
            <>
              <div className="us-grid-3">
                <MetricTrend data={data} metric={metric} />
                <Card as="section" aria-label={C.kinds(metric)}>
                  <CardHeader title={C.kinds(metric)} description={C.kindsHint} />
                  <KindShare totals={data.totals} cost={metric === 'cost'} label={C.kinds(metric)} />
                  <p className="us-note">{C.cacheHit} <b className="ui-num">{percent(data.totals.cache_hit_rate)}</b>, {C.cacheHitHint}</p>
                </Card>
              </div>
              <Card as="section" aria-label={C.breakdown(group)}>
                <CardHeader title={C.breakdown(group)} actions={
                  <span className="us-switch">
                    <Segmented size="sm" label={C.metric} value={metric} onChange={(m) => { setSort(null); route.set({ metric: m as Metric }); }}
                      options={METRICS.map((m) => ({ value: m, label: METRIC_LABEL[m] }))} />
                    <Segmented size="sm" label={C.groupBy} value={group} onChange={(g) => { setSort(null); route.set({ group: g }); }}
                      options={GROUP_ORDER.map((g) => ({ value: g, label: GROUP_LABEL[g] }))} />
                  </span>
                } />
                <BarList label={C.breakdown(group)} max={Math.max(0, ...data.groups.map((r) => metricValue(metric, r)))}
                  items={data.groups.slice(0, 8).map((r) => {
                    const { name, sub } = rowName(group, r);
                    return {
                      key: r.key ?? 'unknown', label: name, sub, value: metricValue(metric, r), valueText: metricText(metric, r),
                      aside: percent(metricValue(metric, r) / total), color: metric === 'cost' ? COST_COLOR : 1,
                      icon: group === 'model' && r.provider ? <ProviderIcon provider={r.provider} size="sm" /> : undefined,
                      onSelect: r.key ? () => open(r) : undefined,
                    };
                  })} />
                {data.others && <p className="us-note">{C.others(data.others.count)} {count(data.others.runs)}</p>}
              </Card>
              <Table label={C.table(group)} columns={columns} rows={rows} rowKey={(r) => r.key ?? 'unknown'} density="compact"
                sort={sort} onSortChange={setSort} onRowClick={(r) => open(r)} />
            </>
          )}
          <Callout icon="lock">{C.privacy}</Callout>
        </div>
      )}
    </div>
  );
}

// 거르개 고르기 칸 = 조직 · 공유 스페이스 · 사용자 목록 + 모델(게이트웨이 상태의 채팅 모델)
function useFilterOptions(days: number) {
  const orgs = useLoad(listOrgs);
  const spaces = useLoad(listAdminSpaces);
  const users = useLoad(listUsers);
  const gw = useGatewayStatus(days);
  return {
    orgs: (orgs.data ?? []).map((o) => ({ value: o.id, label: o.name })),
    spaces: (spaces.data?.shared ?? []).map((s) => ({ value: s.id, label: s.name, description: s.org_name, org: s.org_id })),
    users: (users.data ?? []).map((u) => ({ value: u.id, label: u.display_name, description: u.email })),
    models: (gw.data?.by_model ?? []).map((m) => ({ value: m.id, label: m.label, icon: <ProviderIcon provider={m.provider} size="sm" /> })),
  };
}
