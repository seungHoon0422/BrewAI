import type { IconName } from './icons';

// 관리 메뉴 = E2E 계약. 라벨 · 순서 · 해시를 바꾸면 e2e 스펙도 같이 바꾼다.
// 라벨은 링크 이름이자 그 화면의 h1 이다.
export type RouteId = 'overview' | 'models' | 'catalog' | 'approvals' | 'traces' | 'users' | 'docs' | 'settings';

export type MenuItem = {
  id: RouteId;
  label: string;
  desc: string; // h1 아래 한 줄
  icon: IconName;
  sep?: true; // 이 칸 위에 구분선 (그룹 시작)
};

export const MENU: readonly MenuItem[] = [
  { id: 'overview', label: '개요', desc: '게이트웨이 · 모델 · 승인 · 비용 상태를 한눈에 봅니다.', icon: 'grid' },
  { id: 'models', label: '모델', desc: '사용자 앱 모델 목록에 무엇을 보일지 정합니다.', icon: 'cube' },
  { id: 'catalog', label: '카탈로그', desc: '에이전트가 찾아 설치할 수 있는 MCP 서버와 Skill입니다.', icon: 'box' },
  { id: 'approvals', label: '승인 기록', desc: '승인 카드에서 내린 허용 · 거절 기록입니다.', icon: 'shield' },
  { id: 'traces', label: '트레이스', desc: '트레이스 원본은 Langfuse에 있습니다.', icon: 'waterfall' },
  { id: 'users', label: '사용자·예산', desc: '사용자별 역할과 월 예산 · 사용량입니다.', icon: 'people' },
  { id: 'docs', label: '문서', desc: '개발 진행 · 구조 · 구성 — 레포 파일에서 바로 읽습니다.', icon: 'book', sep: true },
  { id: 'settings', label: '설정', desc: '읽기 전용입니다. 값은 서버 설정에서 옵니다.', icon: 'sliders' },
];

export const hrefOf = (id: RouteId) => `#/${id}`;

// '#/models' → 모델 · '#/docs/adr/0007' → 문서. 빈 해시 · '#/' · 모르는 해시 → 개요
export function routeFromHash(hash: string): MenuItem {
  const id = hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return MENU.find((m) => m.id === id) ?? MENU[0];
}
