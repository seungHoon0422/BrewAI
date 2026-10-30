import { useEffect, useState } from 'react';
import { Button, Field, Input, Segmented, Sheet, Switch } from '@brewai/ui';
import { Row, Section } from '../../../shared/components/parts';
import { COMMON_COPY } from '../../../shared/copy';
import { usePublishScopePath } from '../../scope/hooks';
import type { AdminOrg, JoinPolicy, OrgPatch } from '../api';
import { JOIN_TEXT, ORGS_COPY as C } from '../copy';
import { OrgMembers } from './OrgMembers';

type Props = {
  org: AdminOrg | null;
  busy: boolean;
  onChange: (org: AdminOrg, patch: OrgPatch, done: string) => Promise<boolean>;
  onMembersChanged: () => Promise<void>;
  onClose: () => void;
};

const JOIN_OPTIONS = (['invite', 'domain_auto'] as const).map((value) => ({ value, label: JOIN_TEXT[value] }));

// 조직 서랍 = 이름 · 가입 방식(초대만 | + Google Workspace 도메인 자동) · 멤버가 스페이스를 만들 수 있나 · 멤버 역할
export function OrgSheet({ org, onClose, ...rest }: Props) {
  usePublishScopePath(org?.path); // 열린 동안 화면 머리 위치 줄 = 이 조직
  return (
    <Sheet open={org !== null} onClose={onClose} title={org?.name ?? ''} description={org?.slug}>
      {org && <SheetBody key={org.id} org={org} {...rest} />}
    </Sheet>
  );
}

function SheetBody({ org, busy, onChange, onMembersChanged }: Omit<Props, 'org' | 'onClose'> & { org: AdminOrg }) {
  const [name, setName] = useState(org.name);
  const [join, setJoin] = useState<JoinPolicy>(org.join_policy);
  const [hd, setHd] = useState(org.google_hd ?? '');
  useEffect(() => setName(org.name), [org.name]);
  useEffect(() => {
    setJoin(org.join_policy);
    setHd(org.google_hd ?? '');
  }, [org.join_policy, org.google_hd]);

  const trimmed = name.trim();
  const cleanHd = hd.trim().toLowerCase();
  const joinChanged = join !== org.join_policy || (join === 'domain_auto' && cleanHd !== (org.google_hd ?? ''));

  return (
    <>
      <Section>
        <form className="part-row part-inline" onSubmit={(e) => {
          e.preventDefault();
          if (trimmed && trimmed !== org.name) void onChange(org, { name: trimmed }, C.done.renamed(trimmed));
        }}>
          <Field label={C.nameField}>
            <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </Field>
          <Button type="submit" disabled={!trimmed || trimmed === org.name || busy}>{COMMON_COPY.save}</Button>
        </form>
        <p className="part-hint">{C.nameHint}</p>
      </Section>

      <Section title={C.partJoin} hint={C.joinHint[join]}>
        <form className="part-stack" onSubmit={(e) => {
          e.preventDefault();
          if (!joinChanged) return;
          // 도메인은 domain_auto 일 때만 보낸다 (invite 로 돌아가도 도메인은 남겨 둔다 — 다시 켤 때 그대로)
          const patch: OrgPatch = join === 'domain_auto' ? { join_policy: join, google_hd: cleanHd || null } : { join_policy: join };
          void onChange(org, patch, C.done.join);
        }}>
          <Segmented label={C.joinLabel} options={JOIN_OPTIONS} value={join} onChange={setJoin} disabled={busy} block />
          {join === 'domain_auto' && (
            <Field label={C.hdField} hint={C.hdHint} required>
              <Input value={hd} placeholder={C.hdPlaceholder} autoComplete="off" spellCheck={false} onChange={(e) => setHd(e.target.value)} disabled={busy} />
            </Field>
          )}
          <Row>
            <Button type="submit" disabled={!joinChanged || busy || (join === 'domain_auto' && !cleanHd)}>{C.saveJoin}</Button>
          </Row>
        </form>
      </Section>

      <Section title={C.partSpaces} hint={C.membersCreateHint}>
        <Switch label={C.membersCreate} checked={org.members_can_create_spaces} disabled={busy}
          onCheckedChange={(on) => void onChange(org, { members_can_create_spaces: on }, on ? C.done.spacesOn : C.done.spacesOff)} />
      </Section>

      <Section title={C.partMembers}>
        <OrgMembers orgId={org.id} onChanged={onMembersChanged} />
      </Section>
    </>
  );
}
