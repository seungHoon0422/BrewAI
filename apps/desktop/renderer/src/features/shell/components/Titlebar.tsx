// 타이틀바 (40px · 창 끌기) — 사이드바 열고 닫기 · 뒤로 · 앞으로
import type { RefObject } from 'react';
import { IconButton } from '@brewai/ui';
import { useCanGo } from '../../../app/router';
import { SHELL } from '../copy';

export function Titlebar({ sidebar, toggleRef, onToggle }: {
  sidebar: boolean;
  toggleRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
}) {
  const can = useCanGo();
  return (
    <header className="titlebar">
      <IconButton ref={toggleRef} icon="panel" label={SHELL.toggleSidebar} title={SHELL.toggleSidebarTip}
        aria-controls="sidebar" aria-expanded={sidebar} onClick={onToggle} />
      <IconButton icon="chevron-left" label={SHELL.back} disabled={!can.back} onClick={() => history.back()} />
      <IconButton icon="chevron-right" label={SHELL.forward} disabled={!can.forward} onClick={() => history.forward()} />
    </header>
  );
}
