import { Menu } from '@brewai/ui';
import { DecorAvatar } from '../../../shared/components/parts';
import { AUTH_COPY as C } from '../copy';
import { useSession } from '../hooks';

// 화면 머리 오른쪽 = 로그인한 관리자 (닉네임) · 로그아웃
export function SessionMenu() {
  const { session, logout } = useSession();
  if (session.status !== 'signed_in') return null;
  const { user } = session;
  return (
    <Menu
      label={C.account}
      placement="bottom-end"
      items={[
        { kind: 'heading', label: user.email },
        { id: 'logout', label: C.logout, icon: 'logout' },
      ]}
      onSelect={(id) => {
        if (id === 'logout') void logout();
      }}
      trigger={(t) => (
        <button {...t} type="button" className="who" title={C.signedInAs(user.display_name)}>
          <DecorAvatar name={user.display_name} size="xs" />
          <span className="ui-ell">{user.display_name}</span>
        </button>
      )}
    />
  );
}
