import { useSyncExternalStore } from 'react';

// 라우터 라이브러리 없이 hashchange 만 구독한다
function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}
const readHash = () => window.location.hash;

export const useHash = () => useSyncExternalStore(subscribe, readHash);
