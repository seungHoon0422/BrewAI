// 새 스페이스 — 이름 · 설명 · 공개 범위 · (조직 2개 이상이면 조직) · 멤버. 만들면 그 스페이스로 바뀐다
import { useState, type FormEvent } from 'react';
import { Avatar, Button, Callout, Dialog, Field, IconButton, Input, Segmented, Select, Textarea } from '@brewai/ui';
import { codeOf } from '../../../lib/api';
import { useMe } from '../../auth/hooks';
import type { Person, Visibility } from '../api';
import { SPACES, scopeError } from '../copy';
import { makeSpace, useScopeState } from '../hooks';
import { MemberSearch } from './MemberSearch';

export const VISIBILITY_OPTIONS = (['open', 'private'] as const).map((v) => ({ value: v, label: SPACES.visibility[v] }));

export function SpaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const orgs = useScopeState((s) => s.orgs).filter((o) => o.can_create_spaces);
  const [orgId, setOrgId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('open');
  const [members, setMembers] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const org = orgId || orgs[0]?.id;

  const close = () => {
    setName('');
    setDescription('');
    setMembers([]);
    setError(null);
    onClose();
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await makeSpace({
        name: name.trim(), description: description.trim(), visibility, org_id: org,
        members: members.map((m) => ({ user_id: m.user_id, role: 'member' })),
      });
      close();
    } catch (err) {
      setError(scopeError(codeOf(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} title={SPACES.createTitle} description={SPACES.createSub} dismissible={!busy}
      footer={<>
        <Button variant="ghost" onClick={close} disabled={busy}>{SPACES.cancel}</Button>
        <Button variant="primary" type="submit" form="space-new" loading={busy} disabled={!name.trim()}>{SPACES.createAction}</Button>
      </>}>
      <form id="space-new" className="form" onSubmit={submit} noValidate>
        {error && <Callout tone="danger" live>{error}</Callout>}
        {orgs.length > 1 && (
          <Field label={SPACES.org}>
            <Select value={org} onChange={setOrgId} options={orgs.map((o) => ({ value: o.id, label: o.name }))} />
          </Field>
        )}
        <Field label={SPACES.name} required>
          <Input value={name} maxLength={60} placeholder={SPACES.namePlaceholder} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={SPACES.description}>
          <Textarea value={description} maxLength={500} rows={2} placeholder={SPACES.descriptionPlaceholder} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={SPACES.access} hint={SPACES.visibilityHint[visibility]}>
          <Segmented label={SPACES.access} block value={visibility} onChange={setVisibility} options={VISIBILITY_OPTIONS} />
        </Field>
        {members.length > 0 && (
          <ul className="people" aria-label={SPACES.memberList}>
            {members.map((m) => (
              <li key={m.user_id} className="person">
                <Avatar name={m.display_name} size="sm" />
                <span className="person-main"><b className="ui-ell">{m.display_name}</b><span className="ui-ell">{m.email}</span></span>
                <IconButton icon="close" size="sm" label={SPACES.removeMember(m.display_name)}
                  onClick={() => setMembers((list) => list.filter((x) => x.user_id !== m.user_id))} />
              </li>
            ))}
          </ul>
        )}
        <MemberSearch orgId={org} exclude={new Set([me.id, ...members.map((m) => m.user_id)])} onPick={(p) => setMembers((list) => [...list, p])} />
      </form>
    </Dialog>
  );
}
