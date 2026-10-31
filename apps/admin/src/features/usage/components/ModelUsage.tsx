import { useId, useState } from 'react';
import { Callout, Card, CardHeader, LinkButton, Segmented, ShareBar, Skeleton, StatTile, vizColor, vizSlot } from '@brewai/ui';
import { TOKEN_KINDS, type UsageRow, type UsageTotals } from '../api';
import { MODEL_USAGE_COPY as M, PERIODS, TOKEN_KIND_HINT, TOKEN_KIND_LABEL, USAGE_COPY as C, USAGE_LOAD_FAILED, compact, count, money, percent, periodLabel, rangeText } from '../copy';
import { usageHref, useUsage } from '../hooks';
import { TopCard, TrendPair, kindItems, topItem } from './UsageParts';
import '../usage.css';

// 모델 자세히 페이지의 '사용량' 칸 (읽기만 · 숫자만 — 대화 내용 없음). 기간 = 이 칸 안에서만 (7 · 30 · 90일, 주소는 그대로)
// 숫자 카드(호출 · 실패율 · 토큰 · 캐시 적중률 · 추정 비용) → 종류별 토큰과 비용 표(캐시 읽기 · 쓰기 포함) → 작은 호출 · 비용 흐름
// → 이 모델을 많이 쓴 조직 · 사용자 Top 5 (상세보기 = 사용량 메뉴, 이 모델로 거른 값 · 줄 = 한 칸 아래: 조직 → 사용자 · 사용자 → 스페이스)
export function ModelUsage({ id }: { id: string }) {
  const [days, setDays] = useState<number>(30);
  const filter = { model: id };
  const byOrg = useUsage(days, 'org', filter, { limit: 5 });
  const byUser = useUsage(days, 'user', filter, { limit: 5, series: false });
  const d = byOrg.data;
  const titleId = useId();

  return (
    <Card as="section" padding="lg" className="us-model" aria-labelledby={titleId} data-stale={byOrg.loading && d ? '' : undefined}>
      <CardHeader level={2} title={<span id={titleId}>{M.title}</span>} description={d ? `${M.hint} ${rangeText(d.from, d.to)}` : M.hint}
        actions={
          <span className="us-switch">
            <Segmented size="sm" label={C.period} value={String(days)} onChange={(v) => setDays(Number(v))}
              options={PERIODS.map((p) => ({ value: String(p), label: periodLabel(p) }))} />
            <LinkButton size="sm" variant="ghost" iconEnd="arrow-right" href={usageHref({ days, model: id, group: 'org', metric: 'cost' })}>{C.openUsage}</LinkButton>
          </span>
        } />
      {!d ? (
        byOrg.error ? <Callout tone="danger"><span role="alert">{USAGE_LOAD_FAILED[byOrg.error]}</span></Callout> : <Skeleton lines={3} />
      ) : d.totals.runs === 0 ? (
        <p className="us-note">{M.empty(days)}</p>
      ) : (
        <div className="us-model-body">
          <Kpis t={d.totals} />
          <div className="us-grid">
            <KindTable t={d.totals} />
            <div className="us-model-trend">
              <p className="us-sub">{M.trend}</p>
              <TrendPair data={d} height={88} />
            </div>
          </div>
          <div className="us-grid">
            <TopCard title={M.topOrgs} empty={C.topEmptyShort} items={d.groups.map((r) => topItem('org', r, usageHref({ days, model: id, org: r.key, group: 'user' })))}
              others={d.others} more={usageHref({ days, model: id, group: 'org' })} />
            <TopCard title={M.topUsers} empty={byUser.error && !byUser.data ? USAGE_LOAD_FAILED[byUser.error] : C.topEmptyShort}
              items={(byUser.data?.groups ?? []).map((r: UsageRow) => topItem('user', r, usageHref({ days, model: id, user: r.key, group: 'space' })))}
              others={byUser.data?.others} more={usageHref({ days, model: id, group: 'user' })} />
          </div>
        </div>
      )}
    </Card>
  );
}

function Kpis({ t }: { t: UsageTotals }) {
  const tiles = [
    { key: 'runs', label: C.kpi.runs, value: count(t.runs), sub: C.errorsSub(t.errors, t.cancelled) },
    { key: 'errors', label: C.kpi.errors, value: percent(t.error_rate), sub: M.okRuns(t.ok) },
    { key: 'tokens', label: C.kpi.tokens, value: compact(t.tokens), sub: C.tokensSub(compact(t.input_tokens), compact(t.output_tokens)) },
    { key: 'cache', label: C.cacheHit, value: percent(t.cache_hit_rate), sub: M.cacheSub(compact(t.cache_read_tokens), compact(t.cache_write_tokens)) },
    { key: 'cost', label: C.kpi.cost, value: money(t.cost_usd), sub: t.cost_usd === null ? C.costNone : t.cost_estimated_runs ? M.estimatedShort : C.costSub(Math.max(0, t.ok - t.cost_runs)) },
  ];
  return (
    <div className="us-kpis">
      {tiles.map((k) => <StatTile key={k.key} data-kpi={`model-${k.key}`} label={k.label} value={k.value} sub={k.sub} />)}
    </div>
  );
}

// 종류별 토큰 · 비용 표 (겹치지 않게 나눈 값 · 합계 = 토큰 · 추정 비용). 막대 = 비용 비중 (비용을 모르면 토큰 비중)
function KindTable({ t }: { t: UsageTotals }) {
  const cost = t.cost_by_kind;
  return (
    <div className="us-kinds">
      <p className="us-sub">{M.kinds} <span className="us-sub-hint">{cost ? M.barCost : M.barTokens}</span></p>
      <ShareBar label={cost ? M.costShare : M.tokenShare} items={cost ? kindItems(cost, money) : kindItems(t.tokens_by_kind, compact)} format={cost ? money : compact}
        legend={false} />
      <table className="ui-table us-kind-table" data-density="compact" aria-label={M.kinds}>
        <thead>
          <tr>
            <th scope="col">{M.col.kind}</th>
            <th scope="col" data-align="end">{M.col.tokens}</th>
            <th scope="col" data-align="end">{M.col.share}</th>
            <th scope="col" data-align="end">{M.col.cost}</th>
          </tr>
        </thead>
        <tbody>
          {TOKEN_KINDS.map((k, i) => (
            <tr key={k} data-kind={k}>
              <th scope="row" title={TOKEN_KIND_HINT[k]}>
                <span className="us-kind-name"><i className="ui-legend-key" data-shape="rect" style={{ background: vizColor(vizSlot(i)) }} aria-hidden="true" />{TOKEN_KIND_LABEL[k]}</span>
              </th>
              <td data-align="end" className="ui-num">{count(t.tokens_by_kind[k])}</td>
              <td data-align="end" className="ui-num">{percent(t.tokens ? t.tokens_by_kind[k] / t.tokens : 0)}</td>
              <td data-align="end" className="ui-num">{cost ? money(cost[k]) : '—'}</td>
            </tr>
          ))}
          <tr data-kind="total" className="us-kind-total">
            <th scope="row">{M.total}</th>
            <td data-align="end" className="ui-num">{count(t.tokens)}</td>
            <td data-align="end" className="ui-num">{percent(t.tokens ? 1 : 0)}</td>
            <td data-align="end" className="ui-num">{money(t.cost_usd)}</td>
          </tr>
        </tbody>
      </table>
      {t.cost_estimated_runs > 0 && <p className="us-note">{C.estimated(t.cost_estimated_runs)}</p>}
    </div>
  );
}
