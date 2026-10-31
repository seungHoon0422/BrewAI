// 앱 틀 문구 (한국어) — 타이틀바 · 레일 · 사이드바 · 메뉴 화면 공통. 메뉴 이름은 app/menu.ts (E2E 계약).
export const SHELL = {
  toggleSidebar: '사이드바 열고 닫기',
  toggleSidebarTip: '사이드바',
  back: '뒤로',
  forward: '앞으로',
  nav: '메뉴', // e2e 계약 (레일 navigation 이름)
  sidebar: '사이드바',
  search: '검색',
  searchSoon: '검색 (준비 중)',
  collapse: '사이드바 접기',
  newChat: '새 대화',
} as const;

export const PAGE = {
  soon: '준비 중',
  needs: (what: string) => `필요: ${what}`,
  sample: '예시',
} as const;
