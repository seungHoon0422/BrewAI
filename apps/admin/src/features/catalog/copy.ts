// 카탈로그 화면 문구. 탭 · 표 이름 · 머리글은 E2E 가 읽는다 (e2e/admin.spec.ts '카탈로그 › Skill')

export type CatalogTab = 'mcp' | 'skill';
export const TABS: { id: CatalogTab; label: string }[] = [
  { id: 'mcp', label: 'MCP 서버' },
  { id: 'skill', label: 'Skill' },
];
export const MCP_COLS = ['이름', '등급', '허용', '버전/해시 고정'];
export const SKILL_COLS = ['이름', '설명', '쓰는 도구', '출처', '버전 (sha256)', '사용'];

export const CATALOG_COPY = {
  rule: '설치는 허용 목록 · 버전/해시 고정 · 사람 승인을 모두 거쳐요.',
  tabs: '카탈로그 종류',
  mcpTable: 'MCP 서버 목록',
  mcpEmpty: '등록된 MCP 서버 없음',
  mcpWhen: 'P3에서 허용 목록부터',
  skillTable: 'Skill 목록',
  conductorDown: 'conductor 에 연결할 수 없어요 — npm run api',
  loadFailed: 'Skill 목록을 읽지 못했어요',
  retry: '다시 시도',
  skillEmpty: '스킬 없음',
  skillHow: (source: string) => [`${source}/<이름>/SKILL.md`, ' 를 넣고 conductor 를 다시 켜요'] as const,
  builtin: '내장',
  versionTitle: (lines: number) => `SKILL.md sha256 앞 12자 · ${lines}줄`,
  unreadable: (n: number, list: string) => `읽지 못한 스킬 ${n}개 — ${list}`,
  foot: (source: string) => ['읽기 전용 · 출처 ', source, ' (레포에 든 제품 스킬, 개발 루틴 ', '.claude/skills', ' 와 별개) · 바꾸면 버전이 바뀌어요. 새 스킬 저장·등록(격리 → 테스트 → 승인)은 P5.'] as const,
} as const;
