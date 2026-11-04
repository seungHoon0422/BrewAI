// 사용자 앱 메뉴. E2E 계약이다 — 이름·순서·주소를 바꾸면 e2e/ 도 같이 고친다.
// 관리자 메뉴는 apps/admin 에만 둔다 (사용자 앱에 관리자 화면·경로 금지).
import type { IconName } from '@brewai/ui';

export type MenuId = 'chat' | 'activity' | 'scheduled' | 'files' | 'settings';
export type MenuItem = { id: MenuId; label: string; icon: IconName };

export const MENU: readonly MenuItem[] = [
  { id: 'chat', label: '대화', icon: 'chat' },
  { id: 'activity', label: '진행 상황', icon: 'team' },
  { id: 'scheduled', label: '예약 작업', icon: 'clock' },
  { id: 'files', label: '파일', icon: 'file' },
];

// 레일 구분선 아래
export const MENU_END: readonly MenuItem[] = [{ id: 'settings', label: '설정', icon: 'gear' }];

// 설정 세부 메뉴 (설정 화면에선 사이드바 자리에) — 묶음 = 영역. 주소 = #/settings/<id>
export type SettingsId = 'account' | 'general' | 'model' | 'skills' | 'connections' | 'about';
export type SettingsItem = { id: SettingsId; label: string; icon: IconName };
export const SETTINGS_MENU: readonly { label: string; items: readonly SettingsItem[] }[] = [
  { label: '내 계정', items: [
    { id: 'account', label: '계정', icon: 'user' },
    { id: 'general', label: '일반', icon: 'sliders' },
  ] },
  { label: 'AI 작업', items: [
    { id: 'model', label: '모델', icon: 'sparkle' },
    { id: 'skills', label: '스킬', icon: 'layers' },
    { id: 'connections', label: '연결된 앱', icon: 'link' },
  ] },
  { label: '정보', items: [{ id: 'about', label: '앱 정보', icon: 'info' }] },
];
const SUBS = SETTINGS_MENU.flatMap((g) => g.items);

// 화면 하나 = 주소 하나. 설정은 늘 세부 메뉴 하나로 연다
export type RouteId = Exclude<MenuId, 'settings'> | `settings/${SettingsId}`;
const ALL: readonly { id: MenuId | RouteId; label: string }[] = [
  ...MENU, ...MENU_END, ...SUBS.map((s) => ({ id: `settings/${s.id}` as const, label: s.label })),
];
// 예전 주소 (레일에 있던 메뉴) · 설정만 = 첫 세부 메뉴
const ALIAS: Record<string, RouteId> = {
  settings: 'settings/account', skills: 'settings/skills', connections: 'settings/connections',
};

export const href = (id: MenuId | RouteId) => `#/${id}`;
export const settingsHref = (id: SettingsId) => href(`settings/${id}`);
export const labelOf = (id: MenuId | RouteId) => ALL.find((m) => m.id === id)?.label ?? '';
export const menuOf = (route: RouteId): MenuId => (route.startsWith('settings/') ? 'settings' : (route as MenuId));

// '' · '#/' · 모르는 주소 → 대화
export function routeOf(hash: string): RouteId {
  const id = hash.replace(/^#\/?/, '');
  if (ALIAS[id]) return ALIAS[id];
  const hit = ALL.find((m) => m.id === id && m.id !== 'settings');
  return (hit?.id as RouteId | undefined) ?? 'chat';
}
