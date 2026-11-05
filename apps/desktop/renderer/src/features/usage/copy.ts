// 설정 › 사용량 문구 (한국어 · 가운뎃점 구분자 없음)
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
  byModel: '모델별', // e2e 계약 (list 이름)
  bySpace: '스페이스별', // e2e 계약 (list 이름)
  personal: '내 스페이스',
  none: '이 기간에 쓴 기록이 없어요',
  runsUnit: (n: string) => `${n}회`,
} as const;
