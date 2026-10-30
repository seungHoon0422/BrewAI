// 예약 작업 — 정해 둔 시간마다 맡길 일. 지금은 빈 상태 + 예시.
import { Button, Icon } from '@brewai/ui';
import { Empty, Ex, Page, Section } from '../../shell/components/Page';
import { SAMPLE_SCHEDULES, SCHEDULED } from '../copy';

export function ScheduledScreen() {
  return (
    <Page id="scheduled" sub={SCHEDULED.sub} soon>
      <Empty
        icon="clock"
        title={SCHEDULED.empty}
        text={SCHEDULED.emptyText}
        needs={SCHEDULED.emptyNeeds}
        action={<Button disabled title={SCHEDULED.soon}>{SCHEDULED.create}</Button>}
      />
      <Section title={SCHEDULED.examples} extra={<Ex />}>
        <ul className="rows">
          {SAMPLE_SCHEDULES.map((s) => (
            <li key={s.task} className="row">
              <span className="ui-tile"><Icon name="clock" /></span>
              <span className="row-main">
                <b>{s.task}</b>
                <span className="row-sub">{s.when}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </Page>
  );
}
