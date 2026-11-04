// 작은 해시 라우터 (#/chat …). 라이브러리 없이 hashchange 만 본다.
import { useEffect, useSyncExternalStore } from 'react';
import { href, routeOf, type RouteId } from './menu';

// replaceState 는 hashchange 를 안 낸다 → 바꾼 뒤 직접 알린다 (안 그러면 같은 별칭 주소를 다시 눌렀을 때 그대로 남는다)
const REPLACED = 'brewai:hash';
function onHash(change: () => void) {
  window.addEventListener('hashchange', change);
  window.addEventListener(REPLACED, change);
  return () => {
    window.removeEventListener('hashchange', change);
    window.removeEventListener(REPLACED, change);
  };
}

export function useRoute(): RouteId {
  const hash = useSyncExternalStore(onHash, () => location.hash);
  const id = routeOf(hash);
  // 빈 주소·모르는 주소·별칭(#/settings · 예전 #/skills)은 화면과 같은 #/<id> 로 바꿔 둔다 (기록은 새로 쌓지 않음)
  useEffect(() => {
    if (hash === href(id)) return;
    history.replaceState(history.state, '', href(id));
    window.dispatchEvent(new Event(REPLACED));
  }, [hash, id]);
  return id;
}

export function go(id: RouteId) {
  location.hash = href(id);
}

// 뒤로·앞으로 버튼 상태 (Navigation API). 없는 브라우저에선 늘 누를 수 있게 둔다.
const nav = typeof navigation === 'undefined' ? null : navigation;

function onEntry(change: () => void) {
  nav?.addEventListener('currententrychange', change);
  return () => nav?.removeEventListener('currententrychange', change);
}

export function useCanGo() {
  const back = useSyncExternalStore(onEntry, () => nav?.canGoBack ?? true);
  const forward = useSyncExternalStore(onEntry, () => nav?.canGoForward ?? true);
  return { back, forward };
}
