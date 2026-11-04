// 오른쪽 패널 문구 (대화 | 뷰어 | 오른쪽 패널 · 2026-11-04 사용자). UI 문구에 '·' 쓰지 않는다 (e2e/copy-rule.ts)
// 이름 = E2E 계약 (complementary '오른쪽 패널' · 탭 '진행 상황' '파일' · 닫기 · 폭 손잡이)
export const SIDE = {
  panel: '오른쪽 패널',
  close: '오른쪽 패널 닫기',
  tabs: '오른쪽 패널 보기',
  team: '진행 상황',
  files: '파일',
  filesToggle: '파일 열고 닫기',
  resize: '오른쪽 패널 폭',
  noTeam: '이 대화에는 아직 팀이 없어요',
  made: '만든 파일',
  sent: '보낸 첨부',
  empty: '이 대화에 파일이 없어요',
  emptyHint: '파일을 첨부하거나 Word, PDF 같은 문서를 만들어 달라고 하면 여기에 모여요.',
  loading: '불러오는 중',
} as const;
