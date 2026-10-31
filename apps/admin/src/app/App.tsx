import { lazy, Suspense, useEffect, useRef, type ComponentType } from 'react';
import { Badge, Icon, Mark, PageHeader } from '@brewai/ui';
import ApprovalsScreen from '../features/approvals/components/ApprovalsScreen';
import { LoginScreen, SessionChecking } from '../features/auth/components/LoginScreen';
import { SessionMenu } from '../features/auth/components/SessionMenu';
import { useSession } from '../features/auth/hooks';
import { SessionProvider } from '../features/auth/session';
import CatalogScreen from '../features/catalog/components/CatalogScreen';
import { TABS as CATALOG_TABS } from '../features/catalog/copy';
import { catalogTabHref, isCatalogDetail } from '../features/catalog/route';
import DocsScreen from '../features/docs/components/DocsScreen';
import ModelsScreen from '../features/models/components/ModelsScreen';
import { MODEL_TABS } from '../features/models/copy';
import { isModelDetail, tabHref } from '../features/models/route';
import OverviewScreen from '../features/overview/components/OverviewScreen';
import { ScopeBreadcrumb } from '../features/scope/components/ScopeBreadcrumb';
import { ScopeProvider } from '../features/scope/context';
import SettingsScreen from '../features/settings/components/SettingsScreen';
import TracesScreen from '../features/traces/components/TracesScreen';
import UsageScreen from '../features/usage/components/UsageScreen';
import UsersScreen from '../features/users/components/UsersScreen';
import { ToastProvider } from '../shared/toast';
import { SHELL_COPY as C } from './copy';
import { useHash } from './hash';
import { MENU, hrefOf, queryOf, restOf, routeFromHash, type RouteId } from './routes';

// 화면 = 기능 폴더의 *Screen (features/<이름>/components). 틀은 사이드바 + 화면 머리(h1 하나)만 그린다
const SCREENS: Record<RouteId, ComponentType> = {
  overview: OverviewScreen,
  models: ModelsScreen,
  usage: UsageScreen,
  catalog: CatalogScreen,
  approvals: ApprovalsScreen,
  traces: TracesScreen,
  users: UsersScreen,
  docs: DocsScreen,
  settings: SettingsScreen,
};

// 자세히 페이지 (예: '#/models/<id>') = 그 화면이 머리(h1 = 그 대상 이름)를 그린다. 틀은 위 줄(← 목록 · 환경 · 세션)만
// is = 해시 두 번째 칸부터(restOf)가 자세히인지 (길 표는 그 기능 폴더의 route.ts) · back = 돌아갈 목록 (링크 글 · 주소)
// from = 해시 '?from=<탭 id>' 로 온 곳이 따로 있으면 그 탭으로 (카탈로그: 사용자 추가 서버 표 → 자세히 → 그 표로)
type Detail = { is: (sub: string) => boolean; back: string; href: string; from?: (tab: string) => { back: string; href: string } | null };
const DETAILS: Partial<Record<RouteId, Detail>> = {
  models: { is: isModelDetail, back: MODEL_TABS[0].label, href: tabHref(MODEL_TABS[0].id) },
  catalog: {
    is: isCatalogDetail, back: CATALOG_TABS[0].label, href: catalogTabHref(CATALOG_TABS[0].id),
    from: (tab) => {
      const t = CATALOG_TABS.find((x) => x.id === tab);
      return t ? { back: t.label, href: catalogTabHref(t.id) } : null;
    },
  },
};

// UI 부품 모음 (#/ui, ADR-0012) = 개발 서버에서만. 빌드에선 import.meta.env.DEV 가 false → 통째로 빠진다 (메뉴 · E2E 계약 밖)
const UiGallery = import.meta.env.DEV ? lazy(() => import('@brewai/ui/gallery')) : null;
const isGalleryHash = (hash: string) => /^#\/ui(\/|$)/.test(hash);

// 문 = 관리자 세션 (쿠키 + CSRF, ADR-0010). 확인 중 → 로그인 화면 | 콘솔. 부품 모음(#/ui)은 개발 서버 전용이라 문 밖
export default function App() {
  const hash = useHash();
  if (UiGallery && isGalleryHash(hash)) {
    return (
      <Suspense fallback={null}>
        <UiGallery backHref="#/overview" />
      </Suspense>
    );
  }
  return (
    <SessionProvider>
      <Gate />
    </SessionProvider>
  );
}

function Gate() {
  const { session } = useSession();
  if (session.status === 'checking') return <SessionChecking />;
  if (session.status === 'signed_out') return <LoginScreen notice={session.notice} />;
  return (
    <ToastProvider>
      <Console />
    </ToastProvider>
  );
}

function Console() {
  const hash = useHash();
  const route = routeFromHash(hash);
  const Screen = SCREENS[route.id];
  const sub = restOf(hash); // 자세히 id 에 '/' 가 들어도 통째로
  const detail = DETAILS[route.id];
  const isDetail = !!detail?.is(sub);
  const back = (isDetail && detail?.from?.(queryOf(hash).get('from') ?? '')) || detail;
  const page = isDetail ? `${route.id}/${sub}` : route.id; // 화면이 바뀌었는지 = 메뉴 + (자세히면) 그 대상
  const listRef = useRef<HTMLUListElement>(null);
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const shown = useRef(page);

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
    // 화면이 바뀌면 맨 위에서 제목에 포커스 (첫 로드는 그대로 둔다). 자세히 페이지의 h1 은 그 화면이 그린다
    if (shown.current === page) return;
    shown.current = page;
    window.scrollTo(0, 0);
    (h1Ref.current ?? document.querySelector<HTMLElement>('.main h1'))?.focus({ preventScroll: true });
  }, [page]);

  const actions = (
    <>
      <Badge dot tone="info" title={C.envTitle}>{C.env}</Badge>
      <SessionMenu />
    </>
  );

  return (
    <ScopeProvider>
      <div className="shell">
        <header className="side">
          <div className="brand">
            <Mark />
            {C.brand}
            <Badge tone="accent" size="sm">{C.brandTag}</Badge>
          </div>
          <nav className="nav" aria-label={C.nav}>
            <ul ref={listRef}>
              {MENU.map((m) => (
                <li key={m.id} data-sep={m.sep ? '' : undefined}>
                  <a href={hrefOf(m.id)} aria-current={m.id === route.id ? 'page' : undefined}>
                    <Icon name={m.icon} />
                    {m.label}
                  </a>
                </li>
              ))}
              {UiGallery && (
                <li data-sep="">
                  <a href="#/ui">
                    <Icon name="grid" />
                    {C.gallery}
                  </a>
                </li>
              )}
            </ul>
          </nav>
        </header>

        <main className="main">
          <div className="wrap">
            {detail && isDetail ? (
              <div className="topbar">
                <a className="back" href={back?.href ?? detail.href}>
                  <Icon name="chevron-left" size="sm" />
                  {back?.back ?? detail.back}
                </a>
                <div className="ui-page-actions">{actions}</div>
              </div>
            ) : (
              <PageHeader
                divider
                titleRef={h1Ref}
                title={route.label}
                description={route.desc}
                breadcrumb={<ScopeBreadcrumb />}
                actions={actions}
              />
            )}
            <Screen />
          </div>
        </main>
      </div>
    </ScopeProvider>
  );
}
