// 아이콘 한 벌 — 두 앱(icons.tsx)에 따로 있던 것을 합쳤다. 24 격자 · 선 1.8 · 둥근 끝 (design/prototype.html 의 결).
// 직접 그린 것만. 외부 아이콘 세트 · Codex 자산은 쓰지 않는다 (ADR-0005). 새 아이콘도 같은 결로 그려 여기에만 더한다.
// 이름이 겹치던 것은 뜻으로 나눴다: chevron-* = 꺾쇠(펼침 · 다음) · arrow-* = 화살표(옮기기 · 보내기).
import type { ReactElement, ReactNode } from 'react';
import { cx } from './cx';

const PATHS = {
  // 틀 · 이동
  panel: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 4v16" /></>,
  'chevron-left': <path d="M15 18l-6-6 6-6" />,
  'chevron-right': <path d="M9 18l6-6-6-6" />,
  'chevron-down': <path d="M7 10l5 5 5-5" />,
  'chevron-up': <path d="M7 14l5-5 5 5" />,
  'arrow-up': <path d="M12 19V5M6 11l6-6 6 6" />,
  'arrow-down': <path d="M12 4.5v15M7 14.5l5 5 5-5" />,
  'arrow-right': <path d="M4.5 12h15M14.5 7l5 5-5 5" />,
  external: <path d="M13.5 4.5h6v6M19.5 4.5 11 13M17.5 13.5v4a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h4" />,
  grip: <><circle cx="9" cy="6" r=".9" /><circle cx="15" cy="6" r=".9" /><circle cx="9" cy="12" r=".9" /><circle cx="15" cy="12" r=".9" /><circle cx="9" cy="18" r=".9" /><circle cx="15" cy="18" r=".9" /></>,
  more: <><circle cx="6" cy="12" r=".9" /><circle cx="12" cy="12" r=".9" /><circle cx="18" cy="12" r=".9" /></>,
  // 동작
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
  pen: <><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M14 8l2 2" /></>,
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></>,
  trash: <path d="M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7M10.5 11v5M13.5 11v5" />,
  logout: <path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M10 16.5 5.5 12 10 7.5M5.5 12h10" />,
  eye: <><path d="M2.8 12S6.2 5.5 12 5.5 21.2 12 21.2 12 17.8 18.5 12 18.5 2.8 12 2.8 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  'eye-off': <><path d="M10 5.8A9 9 0 0 1 12 5.5c5.8 0 9.2 6.5 9.2 6.5a16 16 0 0 1-2.6 3.4M14.1 14.1a2.8 2.8 0 0 1-4-4M6.4 7.3A15.6 15.6 0 0 0 2.8 12s3.4 6.5 9.2 6.5a8.6 8.6 0 0 0 4.4-1.2" /><path d="M4 4l16 16" /></>,
  // 대화 · 작업
  chat: <path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.4-4.3A7.5 7.5 0 1 1 20 11.5z" />,
  think: (
    <>
      <path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.4-4.3A7.5 7.5 0 1 1 20 11.5z" />
      <path d="M8.8 11.5h.01M12.3 11.5h.01M15.8 11.5h.01" />
    </>
  ),
  team: (
    <>
      <circle cx="12" cy="5.5" r="2.5" /><circle cx="5.5" cy="17.5" r="2.5" /><circle cx="18.5" cy="17.5" r="2.5" />
      <path d="M10.7 7.7 6.8 15.3M13.3 7.7l3.9 7.6M8 17.5h8" />
    </>
  ),
  mic: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  calendar: <><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M4 10h16M9 3.5v4M15 3.5v4" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-.9.9" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l.9-.9" />
    </>
  ),
  // 도구
  calc: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
      <path d="M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01" />
    </>
  ),
  wrench: <path d="M14.5 5.5a4 4 0 0 0-5.2 5.2L4.5 15.5a2.1 2.1 0 0 0 3 3l4.8-4.8a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.4-.6-.6-2.4z" />,
  ruler: <><rect x="3" y="8" width="18" height="8" rx="1.5" /><path d="M7 8v3M11 8v4M15 8v3M19 8v2" /></>,
  text: <path d="M5 6.5h14M5 11h14M5 15.5h9" />,
  // 모델 기능 (관리자 모델 표 · 서랍) — 텍스트는 위 text · 도구는 wrench
  image: <><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m4.5 17 5-5 3.5 3.5 2.5-2.5 4 4" /></>,
  bulb: <path d="M9.5 17.5h5M10.5 20.5h3M12 3.5a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9v1.2h5v-1.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3.5z" />,
  embed: <><circle cx="6" cy="17.5" r="2" /><circle cx="18" cy="6.5" r="2" /><circle cx="17.5" cy="17.5" r="2" /><path d="M7.5 16.1 16.5 7.9M8 17.5h7.5" /></>,
  // 범위 (조직 · 스페이스 · 프로젝트) — 층 이름과 짝은 앱의 scope 모듈이 정한다
  building: <><path d="M5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 15 5v15.5M15 9.5h3a1.5 1.5 0 0 1 1.5 1.5v9.5M3.5 20.5h17" /><path d="M8.5 7.5h3M8.5 11h3M8.5 14.5h3" /></>,
  layers: <><path d="M12 3.5 20.5 8 12 12.5 3.5 8z" /><path d="M3.5 12.5 12 17l8.5-4.5" /></>,
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  people: (
    <>
      <circle cx="9.5" cy="8.5" r="3.2" />
      <path d="M3.8 19.5a5.7 5.7 0 0 1 11.4 0M15.5 5.6a3 3 0 0 1 0 5.8M17.8 14.3a5.6 5.6 0 0 1 2.6 5.2" />
    </>
  ),
  // 관리 메뉴
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
    </>
  ),
  cube: <><path d="M12 3.5 19.5 7.7v8.6L12 20.5l-7.5-4.2V7.7z" /><path d="M4.8 7.9 12 12l7.2-4.1M12 12v8.3" /></>,
  box: <><rect x="3.5" y="4.5" width="17" height="4.5" rx="1.3" /><path d="M5 9v8.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" /></>,
  shield: <><path d="M12 3.5 18.5 6v5.6c0 4-2.7 7.3-6.5 8.9-3.8-1.6-6.5-4.9-6.5-8.9V6z" /><path d="m9.2 12 2 2 3.8-3.9" /></>,
  waterfall: <path d="M4 4v16M7.5 7h6M10.5 12h7M13.5 17h6.5" />,
  sliders: (
    <>
      <path d="M4 7.5h8.5M16.5 7.5H20M4 16.5h3.5M11.5 16.5H20" />
      <circle cx="14.5" cy="7.5" r="2" /><circle cx="9.5" cy="16.5" r="2" />
    </>
  ),
  gear: (
    <>
      <path d="M10.47 5.37L10.75 3.09A9 9 0 0 1 13.25 3.09L13.53 5.37A6.8 6.8 0 0 1 15.6 6.23L17.42 4.81A9 9 0 0 1 19.19 6.58L17.77 8.4A6.8 6.8 0 0 1 18.63 10.47L20.91 10.75A9 9 0 0 1 20.91 13.25L18.63 13.53A6.8 6.8 0 0 1 17.77 15.6L19.19 17.42A9 9 0 0 1 17.42 19.19L15.6 17.77A6.8 6.8 0 0 1 13.53 18.63L13.25 20.91A9 9 0 0 1 10.75 20.91L10.47 18.63A6.8 6.8 0 0 1 8.4 17.77L6.58 19.19A9 9 0 0 1 4.81 17.42L6.23 15.6A6.8 6.8 0 0 1 5.37 13.53L3.09 13.25A9 9 0 0 1 3.09 10.75L5.37 10.47A6.8 6.8 0 0 1 6.23 8.4L4.81 6.58A9 9 0 0 1 6.58 4.81L8.4 6.23A6.8 6.8 0 0 1 10.47 5.37Z" />
      <circle cx="12" cy="12" r="2.9" />
    </>
  ),
  book: (
    <>
      <path d="M5.5 18V6a2.5 2.5 0 0 1 2.5-2.5h10.5v12H8a2.5 2.5 0 0 0-2.5 2.5" />
      <path d="M5.5 18A2.5 2.5 0 0 0 8 20.5h10.5v-5M9.5 7.5h5.5M9.5 10.5h3.5" />
    </>
  ),
  plug: <path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0zM12 16v4.5" />,
  receipt: <path d="M6 3.5h12v17l-2.4-1.5-1.8 1.5-1.8-1.5-1.8 1.5-1.8-1.5L6 20.5zM9 8.5h6M9 12h6" />,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  inbox: <path d="M4 13.5h4.5l1.5 2h4l1.5-2H20M4 13.5v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4l-2.4-7a2 2 0 0 0-1.9-1.4H8.3a2 2 0 0 0-1.9 1.4z" />,
  // 상태
  alert: <><path d="M10.3 5 3.9 16.6A2 2 0 0 0 5.6 19.5h12.8a2 2 0 0 0 1.7-2.9L13.7 5a2 2 0 0 0-3.4 0z" /><path d="M12 9.5v4M12 16.5v.01" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>,
  circle: <circle cx="12" cy="12" r="7" />,
  sun: <><circle cx="12" cy="12" r="3.8" /><path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M5.6 18.4l1.3-1.3M17.1 6.9l1.3-1.3" /></>,
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];
export type IconSize = 'xs' | 'sm' | 'md' | 'lg';

// 장식용 = aria-hidden (옆에 글이 있을 때). 글 없이 아이콘만 둘 땐 label → role=img
export function Icon({ name, size = 'md', label, className }: { name: IconName; size?: IconSize; label?: string; className?: string }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return (
    <svg className={cx('ui-icon', className)} data-size={size} data-icon={name} viewBox="0 0 24 24" focusable="false" {...a11y}>
      {PATHS[name]}
    </svg>
  );
}

// 부품의 icon prop = 아이콘 이름 또는 직접 만든 요소 (예: <ProviderIcon />)
export type IconLike = IconName | ReactElement;
export const renderIcon = (icon: IconLike | undefined, size: IconSize = 'md') =>
  icon === undefined ? null : typeof icon === 'string' ? <Icon name={icon} size={size} /> : icon;

// BrewAI 마크 (채움 도형 · 48 격자) — 우리 로고
export const MARK_PATH =
  'M17 4h14a13 13 0 0 1 13 13v14a13 13 0 0 1-13 13H17A13 13 0 0 1 4 31V17A13 13 0 0 1 17 4zM13 26a7 7 0 1 0 14 0a7 7 0 1 0-14 0zM29 15.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0z';

export function Mark({ size = 22, className, label }: { size?: number; className?: string; label?: string }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return (
    <svg className={cx('ui-mark', className)} width={size} height={size} viewBox="0 0 48 48" focusable="false" {...a11y}>
      <path fill="currentColor" fillRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}
