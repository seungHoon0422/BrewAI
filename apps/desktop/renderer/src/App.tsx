// 앱 틀 — design/prototype.html 의 프레임: 40px 타이틀바 · 48px 레일 · 256px 사이드바 · 메인.
import { useEffect, useMemo, useRef, useState, type ComponentType, type RefObject } from 'react';
import { Icon } from './icons';
import { MENU, MENU_END, href, type MenuId, type MenuItem } from './menu';
import { go, useCanGo, useRoute } from './router';
import { SAMPLE_PROJECTS } from './sample';
import { boot, loadThreads, newChat as startNewChat, openThread, recents, useSession } from './chat/session';
import { Activity } from './pages/Activity';
import { Chat } from './pages/Chat';
import { Connections } from './pages/Connections';
import { Scheduled } from './pages/Scheduled';
import { Settings } from './pages/Settings';
import { Skills } from './pages/Skills';

const PAGES: Record<MenuId, ComponentType> = {
  chat: Chat,
  activity: Activity,
  scheduled: Scheduled,
  skills: Skills,
  connections: Connections,
  settings: Settings,
};

export function App() {
  const route = useRoute();
  const [sidebar, setSidebar] = useState(true);
  const [chatKey, setChatKey] = useState(0);
  const current = useSession((s) => s.current);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const Page = PAGES[route];

  useEffect(boot, []); // 모델 · 최근 대화 · 툴 이름

  const newChat = () => {
    startNewChat(); // 진행 중인 답은 끊지 않는다 (그 대화는 최근 목록에서 계속 돈다)
    setChatKey((k) => k + 1); // 입력창을 비우고 다시 포커스
    go('chat');
  };
  const open = (id: string) => {
    openThread(id);
    setChatKey((k) => k + 1);
    go('chat');
  };
  const closeSidebar = () => {
    setSidebar(false);
    toggleRef.current?.focus(); // 접은 버튼이 사라지므로 타이틀바 버튼으로
  };

  return (
    <div className={sidebar ? 'app' : 'app sb-hidden'}>
      <Titlebar sidebar={sidebar} toggleRef={toggleRef} onToggle={() => setSidebar((v) => !v)} />
      <div className="body">
        <Rail route={route} />
        <Sidebar open={sidebar} onClose={closeSidebar} onNewChat={newChat} onOpen={open} current={route === 'chat' ? current : null} />
        <main className="main">
          <Page key={route === 'chat' ? `chat-${current ?? 'new'}-${chatKey}` : route} />
        </main>
      </div>
    </div>
  );
}

function Titlebar({ sidebar, toggleRef, onToggle }: {
  sidebar: boolean;
  toggleRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
}) {
  const can = useCanGo();
  return (
    <header className="titlebar">
      <button ref={toggleRef} className="ib" type="button" aria-label="사이드바 열고 닫기" title="사이드바"
        aria-controls="sidebar" aria-expanded={sidebar} onClick={onToggle}>
        <Icon name="panel" />
      </button>
      <button className="ib" type="button" aria-label="뒤로" title="뒤로" disabled={!can.back} onClick={() => history.back()}>
        <Icon name="left" />
      </button>
      <button className="ib" type="button" aria-label="앞으로" title="앞으로" disabled={!can.forward} onClick={() => history.forward()}>
        <Icon name="right" />
      </button>
    </header>
  );
}

function Rail({ route }: { route: MenuId }) {
  const link = (m: MenuItem) => (
    <a key={m.id} className="ib" href={href(m.id)} aria-label={m.label} title={m.label}
      aria-current={m.id === route ? 'page' : undefined}>
      <Icon name={m.icon} />
    </a>
  );
  return (
    <nav className="rail" aria-label="메뉴">
      {MENU.map(link)}
      <span className="sep" aria-hidden="true" />
      {MENU_END.map(link)}
    </nav>
  );
}

// 최근 = conductor 대화 기록 (GET /api/threads) + 이 창에서 막 시작한 대화. 프로젝트는 아직 예시 (sample.ts)
const RECENT_FIRST = 12; // 처음엔 12개, '더 보기' 로 전부 (최대 50)

function Sidebar({ open, onClose, onNewChat, onOpen, current }: {
  open: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onOpen: (id: string) => void;
  current: string | null;
}) {
  const s = useSession((x) => x);
  const items = useMemo(() => recents(s), [s.threads, s.convs]);
  const [more, setMore] = useState(false);
  const shown = more ? items : items.slice(0, RECENT_FIRST);
  const status = s.threads.status;
  return (
    <aside id="sidebar" className="sidebar" aria-label="사이드바" inert={!open}>
      <div className="sb-head">
        <span className="brand">BrewAI</span>
        <button className="ib" type="button" aria-label="검색" title="검색 · 준비 중" disabled>
          <Icon name="search" />
        </button>
        <button className="ib" type="button" aria-label="사이드바 접기" title="사이드바 접기" onClick={onClose}>
          <Icon name="panel" />
        </button>
      </div>
      <button className="row-btn" type="button" onClick={onNewChat}>
        <Icon name="pen" />새 대화
      </button>

      <div className="label" id="recent-label">최근</div>
      <ul className="list" aria-labelledby="recent-label">
        {shown.map((r) => (
          <li key={r.id}>
            <button className={r.id === current ? 'item on' : 'item'} type="button" title={r.title}
              aria-current={r.id === current ? 'true' : undefined} onClick={() => onOpen(r.id)}>
              <span className="t">{r.title}</span>
              {r.running && <span className="spin" role="img" aria-label="답 쓰는 중" />}
            </button>
          </li>
        ))}
        {items.length > RECENT_FIRST && (
          <li>
            <button className="item more" type="button" onClick={() => setMore((v) => !v)}>
              {more ? '접기' : `더 보기 · ${items.length - RECENT_FIRST}개`}
            </button>
          </li>
        )}
        {items.length === 0 && status === 'loading' && <li className="item muted">불러오는 중…</li>}
        {items.length === 0 && status === 'ready' && <li className="item muted">아직 대화가 없어요</li>}
        {status === 'error' && (
          <li className="item muted">
            <span className="t">기록을 불러오지 못했어요</span>
            <button className="link" type="button" onClick={() => void loadThreads()}>다시</button>
          </li>
        )}
      </ul>

      <div className="label">프로젝트<span className="ex">예시</span></div>
      <ul className="list">
        {SAMPLE_PROJECTS.map((p) => (
          <li key={p} className="item">
            <Icon name="folder" small />
            <span className="t">{p}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
