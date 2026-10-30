import type { IconName } from '@brewai/ui';
import { MENU_COPY } from './copy';

// 관리 메뉴 = E2E 계약. 라벨 · 순서 · 해시를 바꾸면 e2e 스펙도 같이 바꾼다. 라벨 · 설명 글 = copy.ts MENU_COPY
// 라벨은 링크 이름이자 그 화면의 h1 이다. 화면(컴포넌트)은 App.tsx 의 SCREENS 가 잇는다.
export type RouteId = 'overview' | 'models' | 'catalog' | 'approvals' | 'traces' | 'users' | 'docs' | 'settings';

export type MenuItem = {
  id: RouteId;
  label: string;
  desc: string; // h1 아래 한 줄
  icon: IconName;
  sep?: true; // 이 칸 위에 구분선 (그룹 시작)
};

const ITEMS: readonly Omit<MenuItem, 'label' | 'desc'>[] = [
  { id: 'overview', icon: 'grid' },
  { id: 'models', icon: 'cube' },
  { id: 'catalog', icon: 'box' },
  { id: 'approvals', icon: 'shield' },
  { id: 'traces', icon: 'waterfall' },
  { id: 'users', icon: 'people' },
  { id: 'docs', icon: 'book', sep: true },
  { id: 'settings', icon: 'sliders' },
];
export const MENU: readonly MenuItem[] = ITEMS.map((m) => ({ ...m, ...MENU_COPY[m.id] }));

// '#/users/orgs' 처럼 화면 안 탭까지 (sub = 화면이 정한 탭 id)
export const hrefOf = (id: RouteId, sub?: string) => (sub ? `#/${id}/${sub}` : `#/${id}`);
const segments = (hash: string) => hash.replace(/^#\/?/, '').split('?')[0].split('/');

// '#/models' → 모델 · '#/docs/adr/0007' → 문서. 빈 해시 · '#/' · 모르는 해시 → 개요
export function routeFromHash(hash: string): MenuItem {
  const id = segments(hash)[0];
  return MENU.find((m) => m.id === id) ?? MENU[0];
}

// 화면 안 탭 = 해시의 두 번째 칸 ('#/users/orgs' → 'orgs'). 없으면 ''
export const subOf = (hash: string): string => segments(hash)[1] ?? '';
