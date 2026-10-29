import { EmptyTable } from '../ui';

export default function Approvals() {
  return (
    <EmptyTable label="승인 감사 기록" cols={['시각', '사용자', '요청', '결정', '근거']} icon="shield">
      기록 없음 — P1-2 승인 카드부터 기록
    </EmptyTable>
  );
}
