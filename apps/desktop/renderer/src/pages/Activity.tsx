// 진행 상황 — 에이전트 팀(총괄 → 담당 → 도구) 이 일하는 모습이 뜰 자리. 지금은 빈 상태 + 상태 표시 안내.
import { href } from '../menu';
import { Empty, Page, Section } from './Page';

// 색은 프로토타입 팀 패널과 같다
const STATES = [
  { state: 'run', label: '작업 중' },
  { state: 'wait', label: '내 확인 필요' },
  { state: 'ok', label: '완료' },
  { state: 'fail', label: '실패' },
  { state: 'stop', label: '멈춤' },
] as const;

export function Activity() {
  return (
    <Page id="activity" sub="맡긴 일을 누가 어디까지 했는지 보여요." soon>
      <Empty
        icon="team"
        title="진행 중인 작업이 없어요"
        text="대화에서 일을 맡기면 총괄이 일을 나누고, 담당별 진행과 도구 사용 기록이 여기에 실시간으로 쌓여요."
        needs="대화 연결"
        action={<a className="btn primary" href={href('chat')}>일 맡기기</a>}
      />
      <Section title="상태 표시">
        <ul className="legend">
          {STATES.map((s) => (
            <li key={s.state}>
              <span className="dot" data-state={s.state} />
              {s.label}
            </li>
          ))}
        </ul>
      </Section>
    </Page>
  );
}
