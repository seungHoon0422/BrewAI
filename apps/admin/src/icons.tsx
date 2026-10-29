import type { ReactNode } from 'react';

// 직접 그린 24px 선 아이콘 (stroke 1.8). 외부 아이콘 세트·Codex 자산은 쓰지 않는다 (ADR-0005)
const PATHS = {
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
    </>
  ),
  cube: (
    <>
      <path d="M12 3.5 19.5 7.7v8.6L12 20.5l-7.5-4.2V7.7z" />
      <path d="M4.8 7.9 12 12l7.2-4.1M12 12v8.3" />
    </>
  ),
  box: (
    <>
      <rect x="3.5" y="4.5" width="17" height="4.5" rx="1.3" />
      <path d="M5 9v8.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 18.5 6v5.6c0 4-2.7 7.3-6.5 8.9-3.8-1.6-6.5-4.9-6.5-8.9V6z" />
      <path d="m9.2 12 2 2 3.8-3.9" />
    </>
  ),
  waterfall: <path d="M4 4v16M7.5 7h6M10.5 12h7M13.5 17h6.5" />,
  people: (
    <>
      <circle cx="9.5" cy="8.5" r="3.2" />
      <path d="M3.8 19.5a5.7 5.7 0 0 1 11.4 0M15.5 5.6a3 3 0 0 1 0 5.8M17.8 14.3a5.6 5.6 0 0 1 2.6 5.2" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7.5h8.5M16.5 7.5H20M4 16.5h3.5M11.5 16.5H20" />
      <circle cx="14.5" cy="7.5" r="2" />
      <circle cx="9.5" cy="16.5" r="2" />
    </>
  ),
  book: (
    <>
      <path d="M5.5 18V6a2.5 2.5 0 0 1 2.5-2.5h10.5v12H8a2.5 2.5 0 0 0-2.5 2.5" />
      <path d="M5.5 18A2.5 2.5 0 0 0 8 20.5h10.5v-5M9.5 7.5h5.5M9.5 10.5h3.5" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 5 3.9 16.6A2 2 0 0 0 5.6 19.5h12.8a2 2 0 0 0 1.7-2.9L13.7 5a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4M12 16.5v.01" />
    </>
  ),
  check: <path d="m5.5 12.5 4 4 9-9" />,
  circle: <circle cx="12" cy="12" r="7" />,
  down: <path d="M12 4.5v15M7 14.5l5 5 5-5" />,
  right: <path d="M4.5 12h15M14.5 7l5 5-5 5" />,
  plug: <path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0zM12 16v4.5" />,
  receipt: <path d="M6 3.5h12v17l-2.4-1.5-1.8 1.5-1.8-1.5-1.8 1.5-1.8-1.5L6 20.5zM9 8.5h6M9 12h6" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  inbox: (
    <path d="M4 13.5h4.5l1.5 2h4l1.5-2H20M4 13.5v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4l-2.4-7a2 2 0 0 0-1.9-1.4H8.3a2 2 0 0 0-1.9 1.4z" />
  ),
  external: <path d="M13.5 4.5h6v6M19.5 4.5 11 13M17.5 13.5v4a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h4" />,
  plus: <path d="M12 6v12M6 12h12" />,
  up: <path d="M12 19.5v-15M7 9.5l5-5 5 5" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  pen: (
    <>
      <path d="M4.5 19.5h4l10.2-10.2a2.1 2.1 0 0 0-3-3L5.5 16.5z" />
      <path d="m14.5 7.5 2 2" />
    </>
  ),
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
  // 검색 · 끌기 손잡이 (같은 결 · 데스크톱 search 와 같은 모양)
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
  chev: <path d="M9.5 6l6 6-6 6" />,
  grip: <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

// BrewAI 마크 = 우리 로고 (design/prototype.html · apps/web 과 같은 모양)
export function Mark() {
  return (
    <svg className="mark" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M17 4h14a13 13 0 0 1 13 13v14a13 13 0 0 1-13 13H17A13 13 0 0 1 4 31V17A13 13 0 0 1 17 4zM13 26a7 7 0 1 0 14 0a7 7 0 1 0-14 0zM29 15.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0z"
      />
    </svg>
  );
}
