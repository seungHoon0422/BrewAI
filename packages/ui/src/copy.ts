// 부품이 스스로 붙이는 말 (한국어 기본값). 기능 문구는 여기 두지 않는다 → features/<이름>/copy.ts (ADR-0012).
// 부품마다 prop 으로 바꿀 수 있다 (예: <PasswordInput showLabel="…" />).
export const UI_COPY = {
  info: '설명',
  close: '닫기',
  loading: '불러오는 중',
  required: '필수',
  showPassword: '비밀번호 보기',
  hidePassword: '비밀번호 숨기기',
  strength: '비밀번호 강도',
  // 강도 0~4 (0 = 비어 있음) — 조합 규칙 없이 길이 중심 (ADR-0010: 15~128자)
  strengthLevels: ['', '짧아요', '쓸 수 있어요', '좋아요', '아주 좋아요'],
  sortAsc: '오름차순으로 정렬됨',
  sortDesc: '내림차순으로 정렬됨',
  selectAll: '모두 선택',
  selectRow: '이 줄 선택',
  breadcrumb: '위치',
  showMore: '숨긴 위치 보기',
  notifications: '알림',
  dismiss: '알림 닫기',
  // 차트 (charts.tsx)
  chartDate: '날짜',
  chartLegend: '범례',
  chartShowTable: '표로 보기',
  chartShowChart: '차트로 보기',
  chartKeys: '왼쪽 오른쪽 화살표로 날짜를 옮겨요',
  deltaNew: '새로',
} as const;
