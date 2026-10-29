import { EmptyTable, Note } from '../ui';

// 모델을 등록하는 입력(가격 · 컨텍스트 · provider)은 만들지 않는다 (ADR-0006)
export default function Models() {
  return (
    <>
      <Note icon="lock">모델은 게이트웨이(LiteLLM)에서만 등록됩니다. 여기서는 노출 · 표시 이름 · 순서만 정합니다.</Note>
      <div className="legend">
        <span>상태</span>
        <span className="chip">
          <i className="dot on" />
          노출 0
        </span>
        <span className="chip">
          <i className="dot" />
          숨김 0
        </span>
        <span className="chip">
          <i className="dot new" />
          후보 0
        </span>
        <span>새 모델은 후보로 들어오고 기본은 숨김</span>
      </div>
      <EmptyTable label="모델 목록" cols={['표시 이름', '게이트웨이 ID', '상태', '순서']} icon="plug">
        게이트웨이 미연결 — P2에서 <code>/model_group/info</code> 동기화
      </EmptyTable>
    </>
  );
}
