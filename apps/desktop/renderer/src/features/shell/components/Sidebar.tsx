// 사이드바 (256px · 흰 면) — 머리(스페이스 전환기 · 검색 · 접기) · 새 대화 · 프로젝트 · 최근 대화 · 아래 계정 칩.
// 목록은 각 기능의 부품이 그린다. 어디로 갈지는 app/navigate.ts
import { Icon, IconButton } from '@brewai/ui';
import { openChat, openProject, startChat } from '../../../app/navigate';
import { go } from '../../../app/router';
import { AccountChip } from '../../account/components/AccountChip';
import { RecentList } from '../../chat/components/RecentList';
import { ProjectList } from '../../projects/components/ProjectList';
import { SpaceSwitcher } from '../../scope/components/SpaceSwitcher';
import { SHELL } from '../copy';

export function Sidebar({ open, onClose, onError, thread, project }: {
  open: boolean;
  onClose: () => void;
  onError: (text: string) => void;
  thread: string | null; // 지금 연 대화 (최근 목록에 표시)
  project: string | null; // 지금 연 프로젝트 화면
}) {
  return (
    <aside id="sidebar" className="sidebar ui-scroll" aria-label={SHELL.sidebar} inert={!open}>
      <div className="sb-head">
        <SpaceSwitcher onError={onError} />
        <IconButton icon="search" label={SHELL.search} title={SHELL.searchSoon} disabled />
        <IconButton icon="panel" label={SHELL.collapse} onClick={onClose} />
      </div>
      <button className="row-btn" type="button" onClick={startChat}>
        <Icon name="pen" />{SHELL.newChat}
      </button>
      <ProjectList current={project} onOpen={openProject} />
      <RecentList current={thread} onOpen={openChat} />
      <div className="sb-foot">
        <AccountChip onSettings={() => go('settings')} />
      </div>
    </aside>
  );
}
