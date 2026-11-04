// 레일 (48px) — 메뉴 링크 (E2E 계약: navigation '메뉴' · 링크 이름 · #/id · 지금 화면에만 aria-current)
// 이름은 마우스를 올리면 바로 오른쪽에 (툴팁 · 기다림 없음)
import { Icon, Tooltip } from '@brewai/ui';
import { MENU, MENU_END, href, type MenuId, type MenuItem } from '../../../app/menu';
import { SHELL } from '../copy';

export function Rail({ current }: { current: MenuId }) {
  const link = (m: MenuItem) => (
    <Tooltip key={m.id} content={m.label} side="right" instant>
      <a className="rail-link" href={href(m.id)} aria-label={m.label}
        aria-current={m.id === current ? 'page' : undefined}>
        <Icon name={m.icon} size="lg" />
      </a>
    </Tooltip>
  );
  return (
    <nav className="rail" aria-label={SHELL.nav}>
      {MENU.map(link)}
      <span className="sep" aria-hidden="true" />
      {MENU_END.map(link)}
    </nav>
  );
}
