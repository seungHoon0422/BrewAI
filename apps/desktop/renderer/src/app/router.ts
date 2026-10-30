// 작은 해시 라우터 (#/chat …). 라이브러리 없이 hashchange 만 본다.
import { useEffect, useSyncExternalStore } from 'react';
import { href, routeOf, type MenuId } from './menu';

function onHash(change: () => void) {
  window.addEventListener('hashchange', change);
  return () => window.removeEventListener('hashchange', change);
}

export function useRoute(): MenuId {
  const hash = useSyncExternalStore(onHash, () => location.hash);
  const id = routeOf(hash);
  // 빈 주소·모르는 주소는 화면과 같은 #/<id> 로 바꿔 둔다 (기록은 새로 쌓지 않음)
  useEffect(() => {
    if (hash !== href(id)) history.replaceState(history.state, '', href(id));
  }, [hash, id]);
  return id;
}

export function go(id: MenuId) {
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
