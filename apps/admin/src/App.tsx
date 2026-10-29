import { useEffect, useRef, type ComponentType } from 'react';
import { useHash } from './hash';
import { Icon, Mark } from './icons';
import { MENU, hrefOf, routeFromHash, type RouteId } from './menu';
import Approvals from './pages/Approvals';
import Catalog from './pages/Catalog';
import Docs from './pages/Docs';
import Models from './pages/Models';
import Overview from './pages/Overview';
import Settings from './pages/Settings';
import Traces from './pages/Traces';
import Users from './pages/Users';

const PAGES: Record<RouteId, ComponentType> = {
  overview: Overview,
  models: Models,
  catalog: Catalog,
  approvals: Approvals,
  traces: Traces,
  users: Users,
  docs: Docs,
  settings: Settings,
};

export default function App() {
  const route = routeFromHash(useHash());
  const Page = PAGES[route.id];
  const listRef = useRef<HTMLUListElement>(null);
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const shown = useRef(route.id);

  useEffect(() => {
    // 좁은 화면(가로 메뉴)에서 현재 메뉴가 잘려 있으면 보이게 민다
    const list = listRef.current;
    const cur = list?.querySelector('[aria-current="page"]');
    if (list && cur && list.scrollWidth > list.clientWidth) {
      const l = list.getBoundingClientRect();
      const r = cur.getBoundingClientRect();
      if (r.left < l.left) list.scrollLeft -= l.left - r.left + 16;
      else if (r.right > l.right) list.scrollLeft += r.right - l.right + 16;
    }
    // 화면이 바뀌면 맨 위에서 제목에 포커스 (첫 로드는 그대로 둔다)
    if (shown.current === route.id) return;
    shown.current = route.id;
    window.scrollTo(0, 0);
    h1Ref.current?.focus({ preventScroll: true });
  }, [route.id]);

  return (
    <div className="shell">
      <header className="side">
        <div className="brand">
          <Mark />
          BrewAI
          <span className="tag">관리자</span>
        </div>
        <nav className="nav" aria-label="관리 메뉴">
          <ul ref={listRef}>
            {MENU.map((m) => (
              <li key={m.id} className={m.sep ? 'sep' : undefined}>
                <a href={hrefOf(m.id)} aria-current={m.id === route.id ? 'page' : undefined}>
                  <Icon name={m.icon} />
                  {m.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <p className="side-foot">사용자 앱과 분리된 콘솔</p>
      </header>

      <main className="main">
        <div className="top">
          <div className="wrap top-in">
            <div className="title">
              <h1 ref={h1Ref} tabIndex={-1}>
                {route.label}
              </h1>
              <p>{route.desc}</p>
            </div>
            <div className="meta">
              <span className="env" title="실행 환경">
                로컬
              </span>
              <button type="button" className="login" disabled>
                관리자 로그인 (P2)
              </button>
            </div>
          </div>
        </div>
        <div className="wrap content">
          <Page />
        </div>
      </main>
    </div>
  );
}
