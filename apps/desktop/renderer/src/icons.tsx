// 아이콘 — design/prototype.html 의 SVG symbol 을 옮겼다 (24 격자 · 선 1.8). gear 만 같은 방식으로 새로 그렸다.
import type { ReactNode } from 'react';

const PATHS = {
  panel: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 4v16" /></>,
  left: <path d="M15 18l-6-6 6-6" />,
  right: <path d="M9 18l6-6-6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chat: <path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.4-4.3A7.5 7.5 0 1 1 20 11.5z" />,
  team: (
    <>
      <circle cx="12" cy="5.5" r="2.5" /><circle cx="5.5" cy="17.5" r="2.5" /><circle cx="18.5" cy="17.5" r="2.5" />
      <path d="M10.7 7.7 6.8 15.3M13.3 7.7l3.9 7.6M8 17.5h8" />
    </>
  ),
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  layers: <><path d="M12 3.5 20.5 8 12 12.5 3.5 8z" /><path d="M3.5 12.5 12 17l8.5-4.5" /></>,
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-.9.9" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l.9-.9" />
    </>
  ),
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
  pen: <><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M14 8l2 2" /></>,
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  down: <path d="M7 10l5 5 5-5" />,
  mic: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></>,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  cal: <><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M4 10h16M9 3.5v4M15 3.5v4" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  // 아래 넷은 같은 결(24 격자 · 선 1.8)로 새로 그렸다
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  calc: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
      <path d="M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01" />
    </>
  ),
  wrench: <path d="M14.5 5.5a4 4 0 0 0-5.2 5.2L4.5 15.5a2.1 2.1 0 0 0 3 3l4.8-4.8a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.4-.6-.6-2.4z" />,
  // 생각 = 말풍선 속 점 셋
  think: (
    <>
      <path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.4-4.3A7.5 7.5 0 1 1 20 11.5z" />
      <path d="M8.8 11.5h.01M12.3 11.5h.01M15.8 11.5h.01" />
    </>
  ),
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
  // 자 (단위 변환) · 글 (글자 수) — 같은 결로 새로 그렸다
  ruler: <><rect x="3" y="8" width="18" height="8" rx="1.5" /><path d="M7 8v3M11 8v4M15 8v3M19 8v2" /></>,
  text: <path d="M5 6.5h14M5 11h14M5 15.5h9" />,
  // 톱니 8개 (끝 r9 · 뿌리 r6.8) + 가운데 구멍
  gear: (
    <>
      <path d="M10.47 5.37L10.75 3.09A9 9 0 0 1 13.25 3.09L13.53 5.37A6.8 6.8 0 0 1 15.6 6.23L17.42 4.81A9 9 0 0 1 19.19 6.58L17.77 8.4A6.8 6.8 0 0 1 18.63 10.47L20.91 10.75A9 9 0 0 1 20.91 13.25L18.63 13.53A6.8 6.8 0 0 1 17.77 15.6L19.19 17.42A9 9 0 0 1 17.42 19.19L15.6 17.77A6.8 6.8 0 0 1 13.53 18.63L13.25 20.91A9 9 0 0 1 10.75 20.91L10.47 18.63A6.8 6.8 0 0 1 8.4 17.77L6.58 19.19A9 9 0 0 1 4.81 17.42L6.23 15.6A6.8 6.8 0 0 1 5.37 13.53L3.09 13.25A9 9 0 0 1 3.09 10.75L5.37 10.47A6.8 6.8 0 0 1 6.23 8.4L4.81 6.58A9 9 0 0 1 6.58 4.81L8.4 6.23A6.8 6.8 0 0 1 10.47 5.37Z" />
      <circle cx="12" cy="12" r="2.9" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, small }: { name: IconName; small?: boolean }) {
  return (
    <svg className={small ? 'i s' : 'i'} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

// 브랜드 마크 (채움 도형)
export function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M17 4h14a13 13 0 0 1 13 13v14a13 13 0 0 1-13 13H17A13 13 0 0 1 4 31V17A13 13 0 0 1 17 4zM13 26a7 7 0 1 0 14 0a7 7 0 1 0-14 0zM29 15.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0z"
      />
    </svg>
  );
}
