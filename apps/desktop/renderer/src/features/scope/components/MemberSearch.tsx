// 조직 사람 찾기 → 고르기 (스페이스 만들기 · 설정의 멤버 넣기). 이미 있는 사람은 뺀다. 조직 밖 사람은 찾을 수 없다
import { useState } from 'react';
import { Avatar, Button, Field, Input } from '@brewai/ui';
import type { Person } from '../api';
import { SPACES } from '../copy';
import { usePeopleSearch } from '../hooks';

export function MemberSearch({ orgId, exclude, onPick }: { orgId?: string; exclude: ReadonlySet<string>; onPick: (p: Person) => void }) {
  const [q, setQ] = useState('');
  const found = usePeopleSearch(q, orgId);
  const shown = found?.filter((p) => !exclude.has(p.user_id)) ?? null;
  return (
    <Field label={SPACES.addMember} hint={SPACES.notInOrg}>
      <Input icon="search" placeholder={SPACES.addMemberPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
      {shown && (
        <ul className="people" aria-label={SPACES.addMember}>
          {shown.map((p) => (
            <li key={p.user_id} className="person">
              <Avatar name={p.display_name} size="sm" />
              <span className="person-main"><b className="ui-ell">{p.display_name}</b><span className="ui-ell">{p.email}</span></span>
              <Button size="sm" onClick={() => { onPick(p); setQ(''); }}>{SPACES.add}</Button>
            </li>
          ))}
          {shown.length === 0 && <li className="person muted">{SPACES.noMatch}</li>}
        </ul>
      )}
    </Field>
  );
}
