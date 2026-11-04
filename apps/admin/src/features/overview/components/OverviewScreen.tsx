import { useState } from 'react';
import {
  Badge, Button, Callout, Card, CardHeader, EmptyState, Icon, InfoTip, LinkButton, ProviderIcon, Segmented, StatusDot, TimeSeriesChart, Toolbar, ToolbarSpacer, vizSlot,
  type ChartSeries,
} from '@brewai/ui';
import { hrefOf } from '../../../app/routes';
import { COMMON_COPY } from '../../../shared/copy';
import { ago } from '../../../shared/format';
import { modelHref } from '../../models/route';
import type { GatewayStatus, UsageRow, UsageTrend } from '../../usage/api';
import { TopTable, UsageKpis, exactMoney, rowName, topItem } from '../../usage/components/UsageParts';
import {
  GATEWAY_STATUS, GROUP_LABEL, METRICS, METRIC_LABEL, OVERVIEW_PERIODS, USAGE_COPY as U, USAGE_LOAD_FAILED, compact, count, dayLabel, moneyAxis, percent,
  periodLabel, rangeText, type BreakdownGroup, type Metric,
} from '../../usage/copy';
import { usageHref, type Kept } from '../../usage/hooks';
import type { DirectoryStats } from '../../usage/api';
import { OVERVIEW_COPY as C, QUICK_LINKS } from '../copy';
import { useOverview, useUnitTrend } from '../hooks';
import '../overview.css';

// 개요 = 운영자가 보는 한 장: 기간 → 숫자 카드(작은 흐름 · 지난 기간 대비 · 줄인 값은 마우스로 실제 값) → 사용 현황(넓게: 모델 · 조직 · 사용자 · 스페이스 탭 ×
// 호출 · 토큰 · 비용 · 다섯 + 그 밖 선) + 그 단위 Top 5(좁게) → 게이트웨이 · 사람 수 → 바로 가기. 설명 글 = 제목 옆 i (글을 줄인다).
// 비용 분해는 사용량 메뉴로 (2026-11-04 사용자). 숫자만 (대화 내용 없음). 개발 진행은 문서 메뉴에만
export default function OverviewScreen() {
  const ov = useOverview();
  const { days, usage } = ov;
  const data = usage.data;
  const hrefs = {
    runs: usageHref({ days }), tokens: usageHref({ days, group: 'model', metric: 'tokens' }), cost: usageHref({ days, group: 'model', metric: 'cost' }),
    users: usageHref({ days, group: 'user' }), errors: usageHref({ days, group: 'model' }),
  };

  return (
    <div className="ov">
      <Toolbar label={C.period}>
        <Segmented size="sm" label={C.period} value={String(days)} onChange={(v) => ov.setDays(Number(v))}
          options={OVERVIEW_PERIODS.map((d) => ({ value: String(d), label: periodLabel(d) }))} />
        {data && <span className="ov-range ui-num">{rangeText(data.from, data.to)}</span>}
        <ToolbarSpacer />
        <LinkButton size="sm" variant="ghost" iconEnd="arrow-right" href={usageHref({ days })}>{C.toUsage}</LinkButton>
      </Toolbar>

      {usage.error && !data ? (
        <Callout tone="danger" live action={<Button size="sm" onClick={usage.reload}>{COMMON_COPY.retry}</Button>}>{USAGE_LOAD_FAILED[usage.error]}</Callout>
      ) : (
        <div className="ov-usage" data-stale={usage.loading && data ? '' : undefined} aria-busy={usage.loading || undefined}>
          {data ? <UsageKpis data={data} hrefs={hrefs} /> : <div className="ov-kpi-hold" />}
          {data && data.totals.runs === 0 ? (
            <EmptyState icon="receipt" title={C.empty}>
              <p>{C.emptyHow}</p>
            </EmptyState>
          ) : (
            data && (
              <>
                <UsageNow days={days} />
              </>
            )
          )}
        </div>
      )}

      <div className="us-grid">
        <GatewayCard load={ov.gateway} />
        <PeopleCard load={ov.stats} />
      </div>

      <section className="ov-links" aria-labelledby="ov-links-title">
        <h2 id="ov-links-title">{C.links}</h2>
        <ul>
          {QUICK_LINKS.map((l) => (
            <li key={l.id}>
              <a className="ov-link" href={hrefOf(l.id)}>
                <span className="ui-tile"><Icon name={l.icon} /></span>
                <span className="ov-link-text">
                  <b>{l.label}{l.later && <Badge size="sm">{C.later}</Badge>}</b>
                  <span>{l.desc}</span>
                </span>
                <Icon name="chevron-right" size="sm" />
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// 줄을 누르면 한 칸 아래 (조직 → 그 조직의 스페이스 · 사용자 → 그 사람의 모델 · 스페이스 → 그 스페이스의 사용자 · 모델 → 모델 자세히)
function rowHref(group: BreakdownGroup, r: UsageRow, days: number): string | undefined {
  if (!r.key) return undefined;
  if (group === 'org') return usageHref({ days, org: r.key, group: 'space' });
  if (group === 'user') return usageHref({ days, user: r.key, group: 'model' });
  if (group === 'space') return usageHref({ days, space: r.key, group: 'user' });
  return modelHref(r.key);
}

const UNITS: readonly BreakdownGroup[] = ['model', 'org', 'user', 'space'];

function pick(metric: Metric, t: UsageTrend | undefined): number[] {
  if (!t) return [];
  return metric === 'cost' ? t.cost_usd.map((v) => v ?? 0) : metric === 'tokens' ? t.tokens : t.runs;
}

// 사용 현황 (2026-11-04 사용자: 이름 · 설명은 i 로 · 호출과 비용 추이 카드 없앰) = 왼쪽 차트 + 오른쪽 그 단위 Top 5 · 탭 하나를 둘이 같이 본다.
// 차트 = 고른 단위의 다섯(기준 큰 순 · 서버가 자름) + 그 밖 = 하루별 선 (색 = 순위 칸 1~5 · 그 밖 = 회색) · 풍선 = 실제 값.
// 상세보기 = 사용량 메뉴에 같은 단위(group) · 기준(metric) · 기간 그대로. 줄 = 한 칸 아래로. 탭은 화면 안 상태 (주소 그대로)
function UsageNow({ days }: { days: number }) {
  const [unit, setUnit] = useState<BreakdownGroup>('model');
  const [metric, setMetric] = useState<Metric>('calls');
  const load = useUnitTrend(days, unit, metric);
  const d = load.data;
  const groups = d?.groups ?? [];
  const others = d?.others ?? null;
  const series: ChartSeries[] = groups.map((g, i) => ({ id: g.key ?? `unknown-${i}`, label: rowName(unit, g).name, values: pick(metric, g.trend), color: vizSlot(i) }));
  if (others?.trend) series.push({ id: 'others', label: C.rest(others.count), values: pick(metric, others.trend), color: 'other' });
  const cost = metric === 'cost';
  const more = usageHref({ days, group: unit, metric });
  const stale = load.loading && d ? '' : undefined;
  return (
    <div className="ov-split" data-unit={unit} data-metric={metric}>
      <Card as="section" aria-label={C.unitTrend} className="ov-unit">
        <CardHeader title={C.unitTrend} info={C.unitHint}
          actions={<LinkButton size="sm" variant="ghost" iconEnd="arrow-right" href={more}>{U.more}</LinkButton>} />
        <div className="ov-unit-tabs">
          <Segmented size="sm" label={C.unitTabs} value={unit} onChange={setUnit} options={UNITS.map((u) => ({ value: u, label: GROUP_LABEL[u] }))} />
          <Segmented size="sm" label={C.metricTabs} value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m, label: METRIC_LABEL[m] }))} />
        </div>
        <div className="ov-unit-body" data-stale={stale} aria-busy={load.loading || undefined}>
          {load.error && !d ? (
            <p className="ov-muted" role="alert">{USAGE_LOAD_FAILED[load.error]}</p>
          ) : !d ? (
            <div className="ov-unit-hold" />
          ) : groups.length === 0 ? (
            <p className="ov-muted">{C.topEmpty}</p>
          ) : (
            <TimeSeriesChart label={C.unitChart(GROUP_LABEL[unit], METRIC_LABEL[metric])} x={d.dates} xLabel={dayLabel} height={232} series={series} legend
              integer={!cost} format={cost ? exactMoney : count} axisFormat={cost ? moneyAxis : compact} />
          )}
        </div>
      </Card>
      <Card as="section" aria-label={C.top[unit]} className="ov-top" data-stale={stale}>
        <CardHeader title={C.top[unit]} info={C.topHint}
          actions={<LinkButton size="sm" variant="ghost" iconEnd="arrow-right" href={more}>{U.more}</LinkButton>} />
        <TopTable label={C.top[unit]} items={groups.map((r) => topItem(unit, r, rowHref(unit, r, days)))} others={others} metric={metric}
          empty={load.error && !d ? USAGE_LOAD_FAILED[load.error] : C.topEmpty} />
      </Card>
    </div>
  );
}

function GatewayCard({ load }: { load: Kept<GatewayStatus> }) {
  const g = load.data;
  const state = load.error && !g ? 'error' : !g ? 'loading' : g.status === 'ok' ? 'ok' : 'error';
  const status = g ? GATEWAY_STATUS[g.status] : null;
  const look = g?.by_model.filter((m) => m.state !== 'hidden' && (m.health === 'error' || m.errors > 0)).slice(0, 4) ?? [];
  const counts = g ? (['exposed', 'candidate', 'hidden', 'missing', 'failing'] as const) : [];
  return (
    <Card as="section" aria-label={C.gateway} className="ov-gw" data-state={state} data-status={g?.status}>
      <CardHeader title={C.gateway} icon="plug" description={g ? (g.last_sync_at ? C.lastSync(ago(g.last_sync_at) ?? '') : C.neverSynced) : C.litellm}
        actions={
          load.error && !g ? <Badge dot tone="danger">{USAGE_LOAD_FAILED[load.error]}</Badge>
          : status ? <Badge dot tone={status.tone} className="ov-gw-status">{status.text}</Badge>
          : <Badge>{COMMON_COPY.none}</Badge>
        } />
      {g && g.status !== 'ok' && <Callout tone={g.status === 'auth' ? 'warn' : 'danger'}>{C.gatewayHow[g.status]}</Callout>}
      {g && (
        <dl className="ov-gw-counts">
          {counts.map((k) => (
            <div key={k} data-count={k}>
              <dt>{C.modelCounts[k]}</dt>
              <dd className="ui-num" data-bad={k === 'failing' && g.models[k] ? '' : undefined}>{g.models[k]}</dd>
            </div>
          ))}
        </dl>
      )}
      {g && (
        look.length ? (
          <div className="ov-gw-look">
            <p className="ov-gw-cap"><b>{C.failingTitle}</b> <InfoTip text={C.failingHint} /></p>
            <ul className="ov-gw-list" aria-label={C.failingTitle}>
              {look.map((m) => (
                <li key={m.id}>
                  <a href={modelHref(m.id)}>
                    <ProviderIcon provider={m.provider} size="sm" />
                    <b className="ui-ell">{m.label}</b>
                    <span className="ov-muted ui-num">{C.modelLine(count(m.runs), percent(m.error_rate))}</span>
                    <span className="ov-gw-health"><StatusDot state={m.health === 'error' ? 'fail' : m.health === 'ok' ? 'ok' : 'idle'} />{C.health[m.health]}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="ov-muted ov-gw-fine"><StatusDot state="ok" />{C.allHealthy}</p>
        )
      )}
      <LinkButton size="sm" variant="ghost" iconEnd="arrow-right" href={hrefOf('models')} className="ov-more">{C.gatewayLink}</LinkButton>
    </Card>
  );
}

function PeopleCard({ load }: { load: Kept<DirectoryStats> }) {
  const s = load.data;
  const tiles = s ? [
    { key: 'users', href: hrefOf('users'), label: C.counts.users, value: C.unit.people(s.users.total), sub: C.counts.usersSub(s.users.active, s.users.disabled) },
    { key: 'orgs', href: hrefOf('users', 'orgs'), label: C.counts.orgs, value: C.unit.count(s.orgs) },
    { key: 'spaces', href: hrefOf('users', 'spaces'), label: C.counts.spaces, value: C.unit.count(s.spaces.shared), sub: C.counts.spacesSub(s.spaces.personal, s.spaces.archived) },
    { key: 'active', href: usageHref({ days: 7, group: 'user' }), label: C.counts.active, value: C.unit.people(s.active_users.d7), sub: C.counts.activeSub(s.active_users.d30) },
    { key: 'invites', href: hrefOf('users', 'invites'), label: C.counts.invites, value: C.unit.count(s.invites_active) },
  ] : [];
  return (
    <Card as="section" aria-label={C.people}>
      <CardHeader title={C.people} icon="people" actions={<LinkButton size="sm" variant="ghost" href={hrefOf('users')}>{C.peopleLink}</LinkButton>} />
      {load.error && !s && <p className="ov-muted" role="alert">{USAGE_LOAD_FAILED[load.error]}</p>}
      <ul className="ov-people">
        {tiles.map((t) => (
          <li key={t.key} data-count={t.key}>
            <a href={t.href}>
              <span className="ov-people-label">{t.label}</span>
              <b className="ui-num">{t.value}</b>
              {t.sub && <span className="ov-muted">{t.sub}</span>}
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
