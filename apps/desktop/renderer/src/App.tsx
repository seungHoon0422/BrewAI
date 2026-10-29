// 앱 틀 — design/prototype.html 의 프레임: 40px 타이틀바 · 48px 레일 · 256px 사이드바 · 메인.
import { useRef, useState, type ComponentType, type RefObject } from 'react';
import { Icon } from './icons';
import { MENU, MENU_END, href, type MenuId, type MenuItem } from './menu';
import { go, useCanGo, useRoute } from './router';
import { SAMPLE_PROJECTS, SAMPLE_RECENTS } from './sample';
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
  const toggleRef = useRef<HTMLButtonElement>(null);
  const Page = PAGES[route];

  const newChat = () => {
    setChatKey((k) => k + 1); // 입력창을 비우고 다시 포커스
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
        <Sidebar open={sidebar} onClose={closeSidebar} onNewChat={newChat} />
        <main className="main">
          <Page key={route === 'chat' ? `chat-${chatKey}` : route} />
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

// 최근 · 프로젝트는 예시 (sample.ts). 대화 기록이 연결되면 실제 목록으로 바꾼다.
function Sidebar({ open, onClose, onNewChat }: { open: boolean; onClose: () => void; onNewChat: () => void }) {
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

      <div className="label">최근<span className="ex">예시</span></div>
      <ul className="list">
        {SAMPLE_RECENTS.map((r) => (
          <li key={r.title} className="item">
            <span className="t">{r.title}</span>
            <span className="tag">{r.project}</span>
            {r.unread && <span className="udot" role="img" aria-label="새 소식" />}
          </li>
        ))}
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
