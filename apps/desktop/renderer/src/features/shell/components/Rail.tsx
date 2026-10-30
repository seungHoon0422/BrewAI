// 레일 (48px) — 메뉴 링크 (E2E 계약: navigation '메뉴' · 링크 이름 · #/id · 지금 화면에만 aria-current)
import { Icon } from '@brewai/ui';
import { MENU, MENU_END, href, type MenuId, type MenuItem } from '../../../app/menu';
import { SHELL } from '../copy';

export function Rail({ route }: { route: MenuId }) {
  const link = (m: MenuItem) => (
    <a key={m.id} className="rail-link" href={href(m.id)} aria-label={m.label} title={m.label}
      aria-current={m.id === route ? 'page' : undefined}>
      <Icon name={m.icon} size="lg" />
    </a>
  );
  return (
    <nav className="rail" aria-label={SHELL.nav}>
      {MENU.map(link)}
      <span className="sep" aria-hidden="true" />
      {MENU_END.map(link)}
    </nav>
  );
}
