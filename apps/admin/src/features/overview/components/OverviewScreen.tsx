import { Badge, BarList, Button, Callout, Card, CardHeader, EmptyState, Icon, LinkButton, ProviderIcon, Segmented, ShareBar, StatusDot, Toolbar, ToolbarSpacer, vizSlot, type ShareItem } from '@brewai/ui';
import { hrefOf } from '../../../app/routes';
import { COMMON_COPY } from '../../../shared/copy';
import { ago } from '../../../shared/format';
import { modelHref } from '../../models/route';
import type { GatewayStatus, UsageSummary } from '../../usage/api';
import { UsageKpis, UsageTrends } from '../../usage/components/UsageParts';
import { GATEWAY_STATUS, OVERVIEW_PERIODS, USAGE_COPY as U, USAGE_LOAD_FAILED, count, percent, periodLabel, rangeText } from '../../usage/copy';
import { usageHref, type Kept } from '../../usage/hooks';
import type { DirectoryStats } from '../../usage/api';
import { OVERVIEW_COPY as C, QUICK_LINKS } from '../copy';
import { useOverview } from '../hooks';
import '../overview.css';

// 개요 = 운영자가 보는 한 장: 기간 → 숫자 카드(작은 흐름 · 지난 기간 대비) → 호출 · 토큰 흐름 → 조직별 · 모델별 → 게이트웨이 · 사람 수 → 바로 가기.
// 카드 · 줄을 누르면 그 메뉴(사용량 · 모델 · 사용자와 조직)로. 숫자만 (대화 내용 없음). 개발 진행(슬라이스 · 보드)은 문서 메뉴에만
export default function OverviewScreen() {
  const ov = useOverview();
  const { days, usage } = ov;
  const data = usage.data;
  const hrefs = {
    runs: usageHref({ days }), tokens: usageHref({ days, group: 'model' }), cost: usageHref({ days, group: 'model' }),
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
            data && <UsageTrends data={data} height={180} />
          )}
          {data && data.totals.runs > 0 && (
            <div className="us-grid">
              <OrgCard load={ov.orgs} days={days} />
              <ModelCard load={ov.models} />
            </div>
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

function OrgCard({ load, days }: { load: Kept<UsageSummary>; days: number }) {
  const d = load.data;
  return (
    <Card as="section" aria-label={C.orgs} data-stale={load.loading && d ? '' : undefined}>
      <CardHeader title={C.orgs} description={C.orgsHint} actions={<LinkButton size="sm" variant="ghost" href={usageHref({ days })}>{U.openUsage}</LinkButton>} />
      {d && d.groups.length === 0 && <p className="ov-muted">{C.orgsEmpty}</p>}
      {d && (
        <BarList label={C.orgs} items={d.groups.map((g) => ({
          key: g.key ?? 'unknown', label: g.label ?? U.unknown, value: g.runs, aside: percent(g.share),
          href: g.key ? usageHref({ days, org: g.key, group: 'space' }) : undefined,
        }))} />
      )}
      {d?.others && <p className="ov-muted">{U.others(d.others.count)} {count(d.others.runs)}</p>}
    </Card>
  );
}

function ModelCard({ load }: { load: Kept<UsageSummary> }) {
  const d = load.data;
  // 색 = 모델을 따라간다 (호출 순위가 아니라 id 순서로 칸을 정한다 → 기간을 바꿔 순위가 바뀌어도 같은 모델 = 같은 색)
  const ids = [...(d?.groups ?? [])].map((g) => g.key ?? '').sort();
  const items: ShareItem[] = (d?.groups ?? []).map((g) => ({
    key: g.key ?? 'unknown', label: g.label ?? g.key ?? U.unknown, value: g.runs, color: vizSlot(ids.indexOf(g.key ?? '')),
    href: g.key ? modelHref(g.key) : undefined, icon: g.provider ? <ProviderIcon provider={g.provider} size="sm" /> : undefined,
  }));
  if (d?.others) items.push({ key: 'others', label: C.modelsOther(d.others.count), value: d.others.runs, color: 'other' });
  return (
    <Card as="section" aria-label={C.models} data-stale={load.loading && d ? '' : undefined}>
      <CardHeader title={C.models} description={C.modelsHint} />
      {d && <ShareBar label={C.models} items={items} />}
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
