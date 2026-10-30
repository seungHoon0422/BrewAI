// 앱 틀 — 로그인 게이트 → 40px 타이틀바 · 48px 레일 · 256px 사이드바 · 메인 (design/prototype.html 프레임). 화면 = features/*/components.
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { ToastRegion, useToastQueue } from '@brewai/ui';
import { ActivityScreen } from '../features/activity/components/ActivityScreen';
import { AuthGate } from '../features/auth/components/AuthGate';
import { ChatScreen } from '../features/chat/components/ChatScreen';
import { useChat } from '../features/chat/hooks';
import { ConnectionsScreen } from '../features/connections/components/ConnectionsScreen';
import { ScheduledScreen } from '../features/scheduled/components/ScheduledScreen';
import { clearNotice, useScopeState } from '../features/scope/hooks';
import { SettingsScreen } from '../features/settings/components/SettingsScreen';
import { Rail } from '../features/shell/components/Rail';
import { Sidebar } from '../features/shell/components/Sidebar';
import { Titlebar } from '../features/shell/components/Titlebar';
import { SkillsScreen } from '../features/skills/components/SkillsScreen';
import { boot } from './boot';
import type { MenuId } from './menu';
import { useRoute } from './router';

const PAGES: Record<MenuId, ComponentType> = {
  chat: ChatScreen,
  activity: ActivityScreen,
  scheduled: ScheduledScreen,
  skills: SkillsScreen,
  connections: ConnectionsScreen,
  settings: SettingsScreen,
};

export function App() {
  return (
    <AuthGate>
      <Workspace />
    </AuthGate>
  );
}

function Workspace() {
  const route = useRoute();
  const [sidebar, setSidebar] = useState(true);
  const current = useChat((s) => s.current);
  const nonce = useChat((s) => s.nonce);
  const projectId = useScopeState((s) => s.projectId);
  const notice = useScopeState((s) => s.notice);
  const toasts = useToastQueue();
  const { push } = toasts;
  const toggleRef = useRef<HTMLButtonElement>(null);
  const Page = PAGES[route];

  useEffect(boot, []); // 로그인한 뒤에만 그려진다 (AuthGate)
  useEffect(() => {
    if (!notice) return;
    push({ tone: 'info', title: notice });
    clearNotice();
  }, [notice, push]);

  const closeSidebar = () => {
    setSidebar(false);
    toggleRef.current?.focus(); // 접은 버튼이 사라지므로 타이틀바 버튼으로
  };

  return (
    <div className={sidebar ? 'app' : 'app sb-hidden'}>
      <Titlebar sidebar={sidebar} toggleRef={toggleRef} onToggle={() => setSidebar((v) => !v)} />
      <div className="body">
        <Rail route={route} />
        <Sidebar open={sidebar} onClose={closeSidebar} onError={(title) => push({ tone: 'danger', title })}
          thread={route === 'chat' ? current : null} project={route === 'chat' && !current ? projectId : null} />
        <main className="main">
          <Page key={route === 'chat' ? `chat-${current ?? 'new'}-${nonce}` : route} />
        </main>
      </div>
      <ToastRegion toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </div>
  );
}
