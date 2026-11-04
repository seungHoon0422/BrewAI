// 설정 세부 메뉴 — 설정 화면에서 사이드바 자리 (E2E 계약: navigation '설정 메뉴' · 묶음 머리 · 링크 이름 · #/settings/<id> · 지금 화면에만 aria-current)
import { Icon } from '@brewai/ui';
import { SETTINGS_MENU, settingsHref, type RouteId } from '../../../app/menu';
import { SETTINGS } from '../copy';

export function SettingsNav({ route }: { route: RouteId }) {
  return (
    <nav className="settings-nav" aria-label={SETTINGS.nav}>
      {SETTINGS_MENU.map((g) => (
        <div key={g.label} role="group" aria-label={g.label}>
          <div className="label" aria-hidden="true">{g.label}</div>
          <ul className="list">
            {g.items.map((m) => (
              <li key={m.id}>
                <a className="item" href={settingsHref(m.id)} aria-current={route === `settings/${m.id}` ? 'page' : undefined}>
                  <Icon name={m.icon} /><span className="t">{m.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
