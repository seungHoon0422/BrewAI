import { Icon } from '../icons';
import { EmptyTable } from '../ui';

// 트레이스 화면은 Langfuse 로 가는 입구다. 여기에 trace 를 복제해 두지 않는다
export default function Traces() {
  return (
    <>
      <div className="panel">
        <p>
          에이전트 · LLM · 툴 호출이 span으로 남고, 모든 span에 <code>user.id</code> · <code>session.id</code>가
          붙습니다. 이 값으로 찾아 Langfuse에서 엽니다.
        </p>
        <div className="row">
          <button type="button" className="btn" disabled>
            <Icon name="external" />
            Langfuse 열기
          </button>
          <span className="hint">P1-3 연결 후</span>
        </div>
      </div>
      <div className="filters" role="group" aria-label="필터">
        <span>필터</span>
        <button type="button" className="fchip" disabled>
          <Icon name="plus" />
          user.id
        </button>
        <button type="button" className="fchip" disabled>
          <Icon name="plus" />
          session.id
        </button>
      </div>
      <EmptyTable label="트레이스 목록" cols={['시각', '이름', 'user.id', 'session.id', '비용']} icon="waterfall">
        트레이스 없음 — P1-3 Langfuse 연결 후 표시
      </EmptyTable>
    </>
  );
}
