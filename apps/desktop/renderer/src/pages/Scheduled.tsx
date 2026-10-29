// 예약 작업 — 정해 둔 시간마다 맡길 일. 지금은 빈 상태 + 예시.
import { Icon } from '../icons';
import { SAMPLE_SCHEDULES } from '../sample';
import { Empty, Ex, Page, Section } from './Page';

export function Scheduled() {
  return (
    <Page id="scheduled" sub="정해 둔 시간마다 에이전트에게 일을 맡겨요." soon>
      <Empty
        icon="clock"
        title="예약된 작업이 없어요"
        text="반복할 일과 시간을 정해 두면 여기에 모여요. 실행할 때마다 결과와 기록이 남아요."
        needs="대화 연결 · 예약 실행"
        action={<button className="btn" type="button" disabled title="준비 중">예약 만들기</button>}
      />
      <Section title="이렇게 쓸 수 있어요" extra={<Ex />}>
        <ul className="rows">
          {SAMPLE_SCHEDULES.map((s) => (
            <li key={s.task} className="row">
              <span className="tile"><Icon name="clock" /></span>
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
