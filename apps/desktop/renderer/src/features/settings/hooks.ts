// 설정 화면 상태 — 지금 테마(OS 설정) · 실행 환경
import { useSyncExternalStore } from 'react';
import { SETTINGS } from './copy';

const dark = matchMedia('(prefers-color-scheme: dark)');

function onScheme(change: () => void) {
  dark.addEventListener('change', change);
  return () => dark.removeEventListener('change', change);
}

export const useIsDark = () => useSyncExternalStore(onScheme, () => dark.matches);

export function runtimeLabel() {
  const ua = navigator.userAgent;
  const os = /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  const shell = ua.includes('Electron/') ? SETTINGS.desktop : SETTINGS.browser;
  const build = import.meta.env.DEV ? SETTINGS.devServer : SETTINGS.localBuild;
  return [os, shell, build].filter(Boolean).join(', ');
}
