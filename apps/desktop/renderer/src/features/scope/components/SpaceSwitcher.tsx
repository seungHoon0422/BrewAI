// 스페이스 전환기 (사이드바 맨 위) — 내 스페이스 → 참여한 공유 → 둘러보기(open · 참여) → 새로 만들기 · 스페이스 설정.
// 조직이 2개 이상일 때만 조직 머리글. 그리기 = @brewai/ui Menu (유리 · 키보드 화살표).
import { useState } from 'react';
import { Icon, Menu, type MenuEntry } from '@brewai/ui';
import { codeOf } from '../../../lib/api';
import { SPACES, scopeError, spaceName } from '../copy';
import { join, switchSpace, useCurrentSpace, useScopeState, useTenants } from '../hooks';
import { kindIcon, MEMBERSHIP } from '../model';
import type { Space } from '../api';
import { SpaceDialog } from './SpaceDialog';
import { SpaceSheet } from './SpaceSheet';

const icon = (s: Space) => (s.kind === 'personal' ? 'user' : kindIcon(MEMBERSHIP) ?? 'people');

export function SpaceSwitcher({ onError }: { onError: (text: string) => void }) {
  const current = useCurrentSpace();
  const spaces = useScopeState((s) => s.spaces);
  const browse = useScopeState((s) => s.browse);
  const orgs = useScopeState((s) => s.orgs);
  const tenants = useTenants();
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);

  const row = (s: Space): MenuEntry => ({
    id: `space:${s.id}`, label: spaceName(s), icon: icon(s), checked: s.id === current?.id,
    hint: s.archived_at ? SPACES.archived : s.kind === 'shared' ? SPACES.members(s.member_count) : undefined,
  });
  const items: MenuEntry[] = [];
  const personal = spaces.list.filter((s) => s.kind === 'personal');
  items.push(...personal.map(row));
  const groups = tenants > 1 ? orgs.map((o) => ({ id: o.id, name: o.name })) : [{ id: null, name: SPACES.joined }];
  for (const g of groups) {
    const mine = spaces.list.filter((s) => s.kind === 'shared' && (g.id === null || s.org_id === g.id));
    if (!mine.length) continue;
    items.push({ kind: 'heading', label: g.name }, ...mine.map(row));
  }
  if (browse.length) {
    items.push(
      { kind: 'heading', label: SPACES.browse },
      ...browse.map((s): MenuEntry => ({ id: `join:${s.id}`, label: s.name, icon: icon(s), hint: SPACES.join })),
    );
  }
  items.push({ kind: 'separator' });
  if (orgs.some((o) => o.can_create_spaces)) items.push({ id: 'create', label: SPACES.create, icon: 'plus' });
  if (current?.kind === 'shared') items.push({ id: 'settings', label: SPACES.settings, icon: 'gear' });

  const onSelect = (id: string) => {
    const [what, sid] = id.split(':');
    if (what === 'space') switchSpace(sid);
    else if (what === 'join') join(sid).catch((e) => onError(scopeError(codeOf(e))));
    else if (what === 'create') setCreating(true);
    else if (what === 'settings') setSettings(true);
  };

  const name = current ? spaceName(current) : spaces.status === 'error' ? SPACES.failed : SPACES.loading;
  return (
    <>
      <Menu label={SPACES.switcher} placement="bottom-start" width={240} items={items} onSelect={onSelect}
        trigger={(t) => (
          <button {...t} type="button" className="space-switch" title={SPACES.switcher}>
            <Icon name={current ? icon(current) : 'people'} size="sm" />
            <span className="space-switch-t">{name}</span>
            <Icon name="chevron-down" size="sm" />
          </button>
        )} />
      <SpaceDialog open={creating} onClose={() => setCreating(false)} />
      {current?.kind === 'shared' && <SpaceSheet key={current.id} space={current} open={settings} onClose={() => setSettings(false)} />}
    </>
  );
}
