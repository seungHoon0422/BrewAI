// 예약 작업 문구 (한국어) + 예시. 예약 실행이 생기면 SAMPLE_SCHEDULES 를 지운다.
export const SCHEDULED = {
  sub: '정해 둔 시간마다 에이전트에게 일을 맡겨요.',
  empty: '예약된 작업이 없어요',
  emptyText: '반복할 일과 시간을 정해 두면 여기에 모여요. 실행할 때마다 결과와 기록이 남아요.',
  emptyNeeds: '대화 연결 · 예약 실행',
  create: '예약 만들기',
  soon: '준비 중',
  examples: '이렇게 쓸 수 있어요',
} as const;

export const SAMPLE_SCHEDULES: readonly { when: string; task: string }[] = [
  { when: '매주 월요일 9:00', task: '지난주 메일에서 할 일만 정리' },
  { when: '매일 18:00', task: '오늘 회의 메모를 한 장으로 요약' },
  { when: '매월 1일 9:00', task: '지난달 가계부 분류' },
];
