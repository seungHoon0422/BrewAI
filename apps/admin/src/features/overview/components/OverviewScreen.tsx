import data from 'virtual:brewai-docs';
import { Badge, Icon, cx } from '@brewai/ui';
import { GATEWAY, LATER, NEXT, OVERVIEW_COPY as C } from '../copy';
import { gatewayStats, useGateway } from '../hooks';
import '../overview.css';

export default function OverviewScreen() {
  const gateway = useGateway();
  const stats = [...gatewayStats(gateway), ...LATER];

  return (
    <div className="overview">
      {/* 숫자 카드 = @brewai/ui StatCard 와 같은 모양(ui-stat*) · 뜻은 dl (E2E: .stat · dt · .v · .sub · data-state) */}
      <dl className="ov-stats">
        {stats.map((s) => (
          <div className="ui-stat stat" key={s.label} data-state={s.label === GATEWAY ? gateway.kind : undefined}>
            <dt className="ui-stat-label">
              <Icon name={s.icon} size="sm" />
              {s.label}
            </dt>
            <dd className={cx('ui-stat-value ui-num v', s.value === '—' && 'none')}>{s.value}</dd>
            <dd className="ui-stat-sub sub">{s.sub}</dd>
          </div>
        ))}
      </dl>

      <a className="tome" href="#/docs/board">
        <span>
          <span aria-hidden="true">👤</span> {C.mine} <b className="ui-num">{data.board.mine.length}</b>
        </span>
        <span>
          <span aria-hidden="true">❓</span> {C.confirm} <b className="ui-num">{data.board.confirm.length}</b>
        </span>
        <span className="go">
          {C.toBoard}
          <Icon name="arrow-right" size="sm" />
        </span>
      </a>

      <section className="ov-sec" aria-labelledby="next-title">
        <h2 id="next-title">{C.next}</h2>
        <ol className="todo">
          {NEXT.map((n) => (
            <li key={n.id}>
              <Badge mono variant="outline" size="sm">{n.id}</Badge>
              <b>{n.what}</b>
              <span className="how">{n.how}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
