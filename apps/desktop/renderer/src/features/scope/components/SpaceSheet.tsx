// 스페이스 설정 서랍 (공유 스페이스만) — 운영: 이름 · 설명 · 공개 범위 · 멤버(조직 사람만) · 보관 / 멤버: 읽기 + [나가기]
import { useState, type FormEvent } from 'react';
import { Avatar, Badge, Button, Callout, Dialog, Field, IconButton, Input, KeyValue, Segmented, Select, Sheet, Spinner, Textarea } from '@brewai/ui';
import { codeOf } from '../../../lib/api';
import { useMe } from '../../auth/hooks';
import type { Space, SpaceRole, Visibility } from '../api';
import { SPACES, scopeError } from '../copy';
import { addMember, dropMember, leave, updateSpace, useMembers } from '../hooks';
import { MemberSearch } from './MemberSearch';
import { VISIBILITY_OPTIONS } from './SpaceDialog';

const ROLE_OPTIONS = (['admin', 'member'] as const).map((r) => ({ value: r, label: SPACES.role[r] }));

export function SpaceSheet({ space, open, onClose }: { space: Space; open: boolean; onClose: () => void }) {
  const me = useMe();
  const members = useMembers(space.id, open);
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description);
  const [visibility, setVisibility] = useState<Visibility>(space.visibility ?? 'open');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'leave' | 'archive' | null>(null);
  const manage = space.can_manage;
  const dirty = name.trim() !== space.name || description.trim() !== space.description || visibility !== space.visibility;

  // 실패는 서랍 위 한 줄로 · 성공 = 목록 다시
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(scopeError(codeOf(e)));
    } finally {
      setBusy(false);
    }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || !name.trim()) return;
    void run(() => updateSpace(space.id, { name: name.trim(), description: description.trim(), visibility }), () => setSaved(true));
  };
  const archived = !!space.archived_at;

  return (
    <Sheet open={open} onClose={onClose} title={SPACES.settings} description={space.name}
      footer={<>
        {!space.implicit && <Button variant="ghost" onClick={() => setConfirm('leave')} disabled={busy}>{SPACES.leave}</Button>}
        {manage && <Button variant="danger" onClick={() => (archived ? void run(() => updateSpace(space.id, { archived: false })) : setConfirm('archive'))}
          disabled={busy}>{archived ? SPACES.unarchive : SPACES.archive}</Button>}
        <span className="grow" />
        {manage && <Button variant="primary" type="submit" form="space-edit" loading={busy} disabled={!dirty || !name.trim()}>{SPACES.save}</Button>}
      </>}>
      <div className="form">
        {error && <Callout tone="danger" live onDismiss={() => setError(null)}>{error}</Callout>}
        {saved && <Callout tone="ok" live onDismiss={() => setSaved(false)}>{SPACES.saved}</Callout>}
        {manage ? (
          <form id="space-edit" className="form" onSubmit={save} noValidate>
            <Field label={SPACES.name} required>
              <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={SPACES.description}>
              <Textarea value={description} maxLength={500} rows={2} placeholder={SPACES.descriptionPlaceholder} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label={SPACES.access} hint={SPACES.visibilityHint[visibility]}>
              <Segmented label={SPACES.access} block value={visibility} onChange={setVisibility} options={VISIBILITY_OPTIONS} />
            </Field>
          </form>
        ) : (
          <>
            <KeyValue items={[
              { label: SPACES.name, value: space.name },
              { label: SPACES.description, value: space.description || '—' },
              { label: SPACES.access, value: space.visibility ? SPACES.visibility[space.visibility] : '—' },
            ]} />
            <p className="form-note">{SPACES.memberOnly}</p>
          </>
        )}

        <section className="form-sec" aria-label={SPACES.memberList}>
          <h3 className="form-sec-t">{SPACES.memberList} <span className="ui-num">{members.list.length || space.member_count}</span></h3>
          {members.status === 'loading' && <Spinner size="sm" />}
          <ul className="people">
            {members.list.map((m) => {
              const self = m.user_id === me.id;
              return (
                <li key={m.user_id} className="person">
                  <Avatar name={m.display_name} size="sm" />
                  <span className="person-main">
                    <b className="ui-ell">{m.display_name}{self && <Badge size="sm">{SPACES.you}</Badge>}</b>
                    <span className="ui-ell">{m.email}</span>
                  </span>
                  {m.implicit ? <span className="person-role">{SPACES.implicit}</span>
                    : manage && !self ? (
                      <>
                        <Select size="sm" aria-label={SPACES.memberRole(m.display_name)} value={m.role} options={ROLE_OPTIONS} disabled={busy}
                          onChange={(v) => void run(() => addMember(space.id, m.user_id, v as SpaceRole), members.reload)} />
                        <IconButton icon="close" size="sm" label={SPACES.removeMember(m.display_name)} disabled={busy}
                          onClick={() => void run(() => dropMember(space.id, m.user_id), members.reload)} />
                      </>
                    ) : <span className="person-role">{SPACES.role[m.role]}</span>}
                </li>
              );
            })}
          </ul>
          {manage && (
            <MemberSearch orgId={space.org_id} exclude={new Set(members.list.map((m) => m.user_id))}
              onPick={(p) => void run(() => addMember(space.id, p.user_id, 'member'), members.reload)} />
          )}
        </section>
      </div>

      <Dialog size="sm" open={confirm !== null} onClose={() => setConfirm(null)}
        title={confirm === 'archive' ? SPACES.archiveTitle : SPACES.leaveTitle}
        description={confirm === 'archive' ? SPACES.archiveBody : SPACES.leaveBody}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirm(null)}>{SPACES.cancel}</Button>
          <Button variant="danger" loading={busy} onClick={() => void run(
            () => (confirm === 'archive' ? updateSpace(space.id, { archived: true }) : leave(space.id)),
            () => { setConfirm(null); if (confirm === 'leave') onClose(); },
          )}>{confirm === 'archive' ? SPACES.archive : SPACES.leave}</Button>
        </>} />
    </Sheet>
  );
}
