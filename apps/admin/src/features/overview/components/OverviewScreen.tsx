import { Badge, BarList, Button, Callout, Card, CardHeader, EmptyState, Icon, LinkButton, ProviderIcon, Segmented, StatusDot, Toolbar, ToolbarSpacer, type BarItem } from '@brewai/ui';
import { hrefOf } from '../../../app/routes';
import { COMMON_COPY } from '../../../shared/copy';
import { ago } from '../../../shared/format';
import { modelHref } from '../../models/route';
import type { GatewayStatus, UsageRow, UsageSummary } from '../../usage/api';
import { COST_COLOR, KindShare, TopCard, TrendPair, UsageKpis, topItem } from '../../usage/components/UsageParts';
import { GATEWAY_STATUS, OVERVIEW_PERIODS, USAGE_COPY as U, USAGE_LOAD_FAILED, count, money, percent, periodLabel, rangeText, type BreakdownGroup } from '../../usage/copy';
import { usageHref, type Kept } from '../../usage/hooks';
import type { DirectoryStats } from '../../usage/api';
import { OVERVIEW_COPY as C, QUICK_LINKS } from '../copy';
import { useOverview } from '../hooks';
import '../overview.css';

// 개요 = 운영자가 보는 한 장: 기간 → 숫자 카드(작은 흐름 · 지난 기간 대비) → 비용 분해(넓게) + 작은 호출 · 비용 흐름(좁게) → Top 5 넷(조직 · 사용자 · 모델 · 스페이스)
// → 게이트웨이 · 사람 수 → 바로 가기. 카드마다 상세보기 = 사용량 메뉴(그 묶음 · 기간). 숫자만 (대화 내용 없음). 개발 진행은 문서 메뉴에만
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
                <div className="ov-split">
                  <CostCard data={data} models={ov.modelsByCost} days={days} />
                  <Card as="section" aria-label={C.trend} className="ov-trend">
                    <CardHeader title={C.trend} description={C.trendHint} />
                    <TrendPair data={data} height={88} />
                  </Card>
                </div>
                <div className="us-grid">
                  <Top group="org" load={ov.orgs} days={days} />
                  <Top group="user" load={ov.users} days={days} />
                  <Top group="model" load={ov.models} days={days} />
                  <Top group="space" load={ov.spaces} days={days} />
                </div>
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

// Top 5 카드 하나 (호출 많은 순 · 서버가 다섯으로 자르고 나머지 = others)
function Top({ group, load, days }: { group: BreakdownGroup; load: Kept<UsageSummary>; days: number }) {
  const d = load.data;
  const shown = d?.groups ?? [];
  const others = d?.others ?? null;
  return (
    <div className="ov-top" data-stale={load.loading && d ? '' : undefined} data-group={group}>
      <TopCard title={C.top[group]} hint={C.topHint} empty={load.error && !d ? USAGE_LOAD_FAILED[load.error] : C.topEmpty}
        items={shown.map((r) => topItem(group, r, rowHref(group, r, days)))} others={others} more={usageHref({ days, group })} />
    </div>
  );
}

// 비용 분해 = 토큰 종류별 비중(캐시 아닌 입력 · 생각 뺀 출력 · 생각 · 캐시 읽기 · 캐시 쓰기) + 모델별 비용(서버가 비용 순으로 자른 Top 5 막대 + 나머지).
// 상세보기 = 사용량(모델 · 비용 기준). 모델별은 비용 색 한 칸 (종류 막대와 색이 겹쳐 다른 뜻으로 읽히지 않게). 넓으면 종류 · 모델을 나란히
function CostCard({ data, models, days }: { data: UsageSummary; models: Kept<UsageSummary>; days: number }) {
  const t = data.totals;
  const total = t.cost_usd ?? 0;
  const byCost = (models.data?.groups ?? []).filter((g) => (g.cost_usd ?? 0) > 0);
  const items: BarItem[] = byCost.map((g) => ({
    key: g.key ?? 'unknown', label: g.label ?? g.key ?? U.unknown, value: g.cost_usd ?? 0, valueText: money(g.cost_usd),
    aside: total ? percent((g.cost_usd ?? 0) / total) : undefined, color: COST_COLOR, href: g.key ? modelHref(g.key) : undefined,
    icon: g.provider ? <ProviderIcon provider={g.provider} size="sm" /> : undefined,
  }));
  const tail = models.data?.others;
  const tailCost = tail?.cost_usd ?? 0;
  return (
    <Card as="section" aria-label={C.cost} className="ov-cost">
      <CardHeader title={C.cost} description={C.costHint}
        actions={<LinkButton size="sm" variant="ghost" iconEnd="arrow-right" href={usageHref({ days, group: 'model', metric: 'cost' })}>{U.more}</LinkButton>} />
      <div className="ov-cost-total">
        <b className="ui-num">{money(t.cost_usd)}</b>
        <span className="ov-muted">{U.kpi.cost}, {U.cacheHit} {percent(t.cache_hit_rate)}</span>
      </div>
      <div className="ov-cost-body">
        <div className="ov-cost-part">
          <p className="us-sub">{C.costKinds}</p>
          <KindShare totals={t} cost label={C.costKinds} />
        </div>
        {items.length > 0 && (
          <div className="ov-cost-part">
            <p className="us-sub">{C.costModels} <span className="ov-muted">{C.costModelsHint}</span></p>
            <BarList label={C.costModels} items={items} format={money} />
            {tail && tailCost > 0 && <p className="ov-muted">{C.modelsOther(tail.count)} {money(tailCost)}</p>}
          </div>
        )}
      </div>
      {t.runs > 0 && t.cost_runs < t.ok && <p className="ov-muted">{U.costSub(t.ok - t.cost_runs)}</p>}
    </Card>
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
            <p className="ov-gw-cap"><b>{C.failingTitle}</b> {C.failingHint}</p>
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
