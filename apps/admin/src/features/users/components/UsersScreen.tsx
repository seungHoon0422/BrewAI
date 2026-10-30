import type { ComponentType } from 'react';
import { Tabs, type TabItem } from '@brewai/ui';
import { useHash } from '../../../app/hash';
import { hrefOf, subOf } from '../../../app/routes';
import InvitesTab from '../../invites/components/InvitesTab';
import OrgsTab from '../../orgs/components/OrgsTab';
import { roleIcon, roleLabel } from '../../scope/model';
import SpacesTab from '../../spaces/components/SpacesTab';
import { DIRECTORY_TABS, USERS_COPY as C, type DirectoryTab } from '../copy';
import PeopleTab from './PeopleTab';

// 사용자·조직 = 탭 넷 (사용자 · 조직 · 스페이스 · 초대). 탭은 해시 두 번째 칸 ('#/users/orgs') — 새로 고쳐도 · 링크로도 그 탭.
// 조직 · 스페이스 탭 이름 = 범위 모델의 층 이름 (층 이름이 바뀌면 같이). 예산은 P6
const TAB_ITEMS: readonly TabItem<DirectoryTab>[] = [
  { id: 'people', label: C.people, icon: 'user' },
  { id: 'orgs', label: roleLabel('tenant'), icon: roleIcon('tenant') },
  { id: 'spaces', label: roleLabel('membership'), icon: roleIcon('membership') },
  { id: 'invites', label: C.invites, icon: 'mail' },
];
const PANELS: Record<DirectoryTab, ComponentType> = { people: PeopleTab, orgs: OrgsTab, spaces: SpacesTab, invites: InvitesTab };

export default function UsersScreen() {
  const sub = subOf(useHash());
  const tab = DIRECTORY_TABS.find((t) => t === sub) ?? 'people';
  const Panel = PANELS[tab];
  return (
    <Tabs label={C.tabs} items={TAB_ITEMS} value={tab} onChange={(t) => window.location.assign(hrefOf('users', t === 'people' ? undefined : t))}>
      <Panel />
    </Tabs>
  );
}
