// 트레이스 화면 문구 (Langfuse 로 가는 입구 — trace 를 여기에 복제하지 않는다)
export const TRACES_COPY = {
  about: ['에이전트 · LLM · 툴 호출이 span으로 남고, 모든 span에 ', 'user.id', ' · ', 'session.id', '가 붙어요. 이 값으로 찾아 Langfuse에서 열어요.'],
  open: 'Langfuse 열기',
  later: 'P1-3 연결 후',
  filters: '필터',
  filterKeys: ['user.id', 'session.id'],
  table: '트레이스 목록',
  cols: ['시각', '이름', 'user.id', 'session.id', '비용'],
  empty: '트레이스 없음',
  when: 'P1-3 Langfuse 연결 후 표시',
} as const;
