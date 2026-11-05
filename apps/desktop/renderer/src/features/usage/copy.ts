// 설정 › 사용량 문구 (한국어 · 가운뎃점 구분자 없음)
import type { Dim } from './api';

export const USAGE = {
  sub: '이 계정으로 한 대화의 호출, 토큰, 추정 비용이에요. 나만 볼 수 있어요.',
  period: '기간', // e2e 계약 (radiogroup 이름)
  days: (d: number) => `${d}일`,
  failed: '사용량을 불러오지 못했어요',
  retry: '다시',
  runs: '호출', // e2e 계약 (카드 이름)
  runsSub: (errors: number) => (errors ? `실패 ${errors}회` : '실패 없음'),
  tokens: '토큰',
  tokensSub: (input: string, output: string) => `입력 ${input}, 출력 ${output}`,
  cost: '추정 비용',
  costSub: (n: number) => (n ? `가격을 아는 호출 ${n}회` : '가격을 아는 호출이 없어요'),
  cache: '캐시 적중률',
  cacheSub: '입력 중 캐시에서 읽은 비율',
  vsPrev: (d: number) => `지난 ${d}일 대비`,
  trend: '하루별 호출',
  none: '이 기간에 쓴 기록이 없어요',
  // 세부 보기
  detail: '세부 보기', // e2e 계약 (섹션 · 탭 줄 이름)
  detailHint: '줄을 누르면 그 항목만 걸러서 위 숫자와 차트가 바뀌어요',
  filtered: '거른 항목', // e2e 계약 (칩 묶음 이름)
  clear: (label: string) => `${label} 거르기 해제`,
  clearAll: '모두 해제',
  table: (dim: string) => `${dim}별 사용량`, // e2e 계약 (표 이름)
  col: { name: '이름', runs: '호출', tokens: '토큰', cost: '추정 비용', errors: '실패율', time: '평균 시간', share: '비중' },
  others: (n: number) => `그 밖의 ${n}개는 줄였어요`,
  personal: '내 스페이스',
  noProject: '프로젝트 밖 대화',
  appChats: '앱에서 한 대화',
  revoked: '폐기됨',
  pick: (label: string) => `${label}만 보기`,
} as const;

export const DIMS: readonly { id: Dim; label: string }[] = [
  { id: 'model', label: '모델' },
  { id: 'project', label: '프로젝트' },
  { id: 'space', label: '스페이스' },
  { id: 'org', label: '조직' },
  { id: 'key', label: 'API 키' },
];
export const dimLabel = (d: Dim) => DIMS.find((x) => x.id === d)?.label ?? d;
