// 연결된 앱 — 에이전트가 쓰는 내 앱 연결. 지금은 흔한 연결 예시를 '미연결' 로만 보여 준다.
import { Button, Icon, StatusDot } from '@brewai/ui';
import { Ex, Notes, Page, Section } from '../../shell/components/Page';
import { CONNECTION_NOTES, CONNECTIONS, SAMPLE_APPS } from '../copy';

export function ConnectionsScreen() {
  return (
    <Page id="connections" sub={CONNECTIONS.sub} soon>
      <Section title={CONNECTIONS.available} extra={<Ex />}>
        <ul className="rows">
          {SAMPLE_APPS.map((a) => (
            <li key={a.id} className="row">
              <span className="ui-tile"><Icon name={a.icon} /></span>
              <span className="row-main">
                <b>{a.name}</b>
                <span className="row-sub">{a.can}</span>
              </span>
              <span className="state"><StatusDot state="idle" size="sm" />{CONNECTIONS.notConnected}</span>
              <Button disabled aria-label={CONNECTIONS.connectLabel(a.name)} title={CONNECTIONS.soon}>{CONNECTIONS.connect}</Button>
            </li>
          ))}
        </ul>
        <p className="needs">{CONNECTIONS.needs}</p>
        <Notes items={CONNECTION_NOTES} />
      </Section>
    </Page>
  );
}
