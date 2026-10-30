// 사이드바 아래 계정 칩 — 아바타 + 닉네임 ▾ → 이메일 · 설정 › 계정 · 로그아웃
import { Avatar, Icon, Menu } from '@brewai/ui';
import { logout, useMe } from '../../auth/hooks';
import { ACCOUNT } from '../copy';

export function AccountChip({ onSettings }: { onSettings: () => void }) {
  const me = useMe();
  return (
    <Menu label={ACCOUNT.chip} placement="top-start" width={232} onSelect={(id) => (id === 'logout' ? void logout() : onSettings())}
      items={[
        { kind: 'heading', label: me.email },
        { id: 'settings', label: ACCOUNT.settings, icon: 'gear' },
        { kind: 'separator' },
        { id: 'logout', label: ACCOUNT.logout, icon: 'logout' },
      ]}
      trigger={(t) => (
        <button {...t} type="button" className="account-chip" title={me.email}>
          <Avatar name={me.display_name} size="sm" />
          <span className="account-name">{me.display_name}</span>
          <Icon name="chevron-up" size="sm" />
        </button>
      )} />
  );
}
