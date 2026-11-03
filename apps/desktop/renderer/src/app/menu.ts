// 사용자 앱 메뉴. E2E 계약이다 — 이름·순서·주소를 바꾸면 e2e/ 도 같이 고친다.
// 관리자 메뉴는 apps/admin 에만 둔다 (사용자 앱에 관리자 화면·경로 금지).
import type { IconName } from '@brewai/ui';

export type MenuId = 'chat' | 'activity' | 'scheduled' | 'skills' | 'files' | 'connections' | 'settings';
export type MenuItem = { id: MenuId; label: string; icon: IconName };

export const MENU: readonly MenuItem[] = [
  { id: 'chat', label: '대화', icon: 'chat' },
  { id: 'activity', label: '진행 상황', icon: 'team' },
  { id: 'scheduled', label: '예약 작업', icon: 'clock' },
  { id: 'skills', label: '스킬', icon: 'layers' },
  { id: 'files', label: '파일', icon: 'file' },
  { id: 'connections', label: '연결된 앱', icon: 'link' },
];

// 레일 구분선 아래
export const MENU_END: readonly MenuItem[] = [{ id: 'settings', label: '설정', icon: 'gear' }];

const ALL = [...MENU, ...MENU_END];

export const href = (id: MenuId) => `#/${id}`;
export const labelOf = (id: MenuId) => ALL.find((m) => m.id === id)?.label ?? '';

// '' · '#/' · 모르는 주소 → 대화
export function routeOf(hash: string): MenuId {
  const id = hash.replace(/^#\/?/, '');
  return ALL.find((m) => m.id === id)?.id ?? 'chat';
}
