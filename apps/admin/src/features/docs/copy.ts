// 문서 화면 틀 문구 (탭 이름 = 주소 조각 · E2E 가 읽는다). 탭 안 글은 레포 파일에서 온다 (docs-plugin.ts)
export const DOC_TABS = [
  { id: 'board', label: '보드' },
  { id: 'progress', label: '진행 현황' },
  { id: 'architecture', label: '아키텍처' },
  { id: 'stack', label: '구성' },
  { id: 'adr', label: '결정 기록' },
  { id: 'report', label: '보고서' },
] as const;

export const DOCS_COPY = {
  tabs: '문서 종류',
  unreadable: (list: string) => `읽지 못한 것: ${list}`,
} as const;
