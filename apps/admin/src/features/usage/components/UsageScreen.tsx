import { BarList, Button, Callout, Card, CardHeader, EmptyState, ProviderIcon, Segmented, Select, Table, Toolbar, ToolbarSpacer, type Column } from '@brewai/ui';
import { modelHref } from '../../models/route';
import { COMMON_COPY } from '../../../shared/copy';
import { useLoad } from '../../../shared/load';
import { listOrgs } from '../../orgs/api';
import { listAdminSpaces } from '../../spaces/api';
import { listUsers } from '../../users/api';
import type { UsageRow } from '../api';
import { GROUP_LABEL, GROUP_ORDER, PERIODS, USAGE_COPY as C, USAGE_LOAD_FAILED, compact, count, money, percent, periodLabel, rangeText, type BreakdownGroup } from '../copy';
import { useGatewayStatus, useUsage, useUsageRoute } from '../hooks';
import { UsageKpis, UsageTrends, rowName } from './UsageParts';

// 사용량 메뉴 = 기간 · 묶음(조직 · 스페이스 · 사용자 · 모델) · 거르개 → 숫자 카드 · 흐름 · 묶음 막대 · 표. 화면 상태는 모두 주소에 (#/usage?org=…)
// 줄을 누르면 한 칸 아래로 (조직 → 그 조직의 스페이스 → 그 스페이스의 사용자 → 그 사람의 모델 → 모델 자세히)
const DRILL: Record<BreakdownGroup, BreakdownGroup | null> = { org: 'space', space: 'user', user: 'model', model: null };

export default function UsageScreen() {
  const route = useUsageRoute();
  const { days, group, filter } = route;
  const usage = useUsage(days, group, filter);
  const options = useFilterOptions(days);
  const data = usage.data;

  const open = (r: UsageRow) => {
    if (!r.key) return;
    if (group === 'model') return window.location.assign(modelHref(r.key));
    const next = DRILL[group];
    route.set({ [group]: r.key, group: next ?? group });
  };

  const columns: Column<UsageRow>[] = [
    {
      key: 'name', header: C.col.name, rowHeader: true,
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
    { key: 'runs', header: C.col.runs, cell: (r) => <span className="ui-num">{count(r.runs)}</span> },
    { key: 'errors', header: C.col.errors, cell: (r) => <span className="ui-num" data-bad={r.errors ? '' : undefined}>{percent(r.error_rate)}</span> },
    { key: 'tokens', header: C.col.tokens, cell: (r) => <span className="ui-num">{compact(r.tokens)}</span> },
    { key: 'tools', header: C.col.tools, hideBelow: 'lg', cell: (r) => <span className="ui-num">{count(r.tool_calls)}</span> },
    { key: 'cost', header: C.col.cost, hideBelow: 'md', cell: (r) => <span className="ui-num">{money(r.cost_usd)}</span> },
    { key: 'share', header: C.col.share, hideBelow: 'md', cell: (r) => <span className="ui-num">{percent(r.share)}</span> },
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
              <UsageTrends data={data} />
              <Card as="section" aria-label={C.breakdown(group)}>
                <CardHeader title={C.breakdown(group)} actions={
                  <Segmented size="sm" label={C.groupBy} value={group} onChange={(g) => route.set({ group: g })}
                    options={GROUP_ORDER.map((g) => ({ value: g, label: GROUP_LABEL[g] }))} />
                } />
                <BarList label={C.breakdown(group)} items={data.groups.slice(0, 8).map((r) => {
                  const { name, sub } = rowName(group, r);
                  return {
                    key: r.key ?? 'unknown', label: name, sub, value: r.runs, aside: percent(r.share),
                    icon: group === 'model' && r.provider ? <ProviderIcon provider={r.provider} size="sm" /> : undefined,
                    onSelect: r.key ? () => open(r) : undefined,
                  };
                })} />
                {data.others && <p className="us-note">{C.others(data.others.count)} {count(data.others.runs)}</p>}
              </Card>
              <Table label={C.table(group)} columns={columns} rows={data.groups} rowKey={(r) => r.key ?? 'unknown'} density="compact"
                onRowClick={(r) => open(r)} />
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
