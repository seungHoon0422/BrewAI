import { EmptyTable } from '../ui';

export default function Users() {
  return (
    <EmptyTable label="사용자 목록" cols={['사용자', '역할', '월 예산', '사용량']} icon="people">
      사용자 없음 — P6에서 예산 · 정책과 함께
    </EmptyTable>
  );
}
