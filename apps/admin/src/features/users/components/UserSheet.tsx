import { useEffect, useState } from 'react';
import { Badge, Button, Callout, Field, Input, KeyValue, Sheet, Switch } from '@brewai/ui';
import { OneTimeCode } from '../../../shared/components/OneTimeCode';
import { ConfirmDialog, DecorAvatar, Muted, Row, Section, TitleWith } from '../../../shared/components/parts';
import { COMMON_COPY } from '../../../shared/copy';
import { ago, dateText, left } from '../../../shared/format';
import { toOrgRole } from '../../orgs/api';
import { UsageSection } from '../../usage/components/UsageSection';
import { orgMembershipText } from '../../orgs/copy';
import { roleLabel } from '../../scope/model';
import type { AdminUserRow, ResetCode, UserPatch } from '../api';
import { ROLE_TEXT, USERS_COPY as C } from '../copy';
import { LoginBadges, StatusBadge } from './UserBadges';

type Props = {
  user: AdminUserRow | null;
  self: boolean; // 지금 로그인한 관리자 = 끄기 · 권한 빼기 없음 (서버도 409)
  busy: boolean;
  onChange: (u: AdminUserRow, patch: UserPatch, done: (r: AdminUserRow) => string) => Promise<boolean>;
  onRevoke: (u: AdminUserRow, done: (n: number) => string) => Promise<boolean>;
  onResetCode: (u: AdminUserRow) => Promise<ResetCode | null>;
  onClose: () => void;
};

// 사용자 서랍 = 닉네임 · 권한 · 계정(세션 · 비활성화) · 비밀번호 재설정 코드 (1회 표시)
export function UserSheet({ user, onClose, ...rest }: Props) {
  return (
    <Sheet open={user !== null} onClose={onClose}
      title={user ? <TitleWith lead={<DecorAvatar name={user.display_name} />}>{user.display_name}</TitleWith> : C.sheetTitle}
      description={user?.email}>
      {user && <SheetBody key={user.id} user={user} {...rest} />}
    </Sheet>
  );
}

function SheetBody({ user: u, self, busy, onChange, onRevoke, onResetCode }: Omit<Props, 'user' | 'onClose'> & { user: AdminUserRow }) {
  const [name, setName] = useState(u.display_name);
  const [confirmOff, setConfirmOff] = useState(false);
  const [code, setCode] = useState<ResetCode | null>(null);
  const [making, setMaking] = useState(false);
  useEffect(() => setName(u.display_name), [u.display_name]);

  const trimmed = name.trim().replace(/\s+/g, ' ');
  const nameChanged = trimmed !== u.display_name;
  const isAdmin = u.instance_role === 'admin';
  const google = u.providers.includes('google');
  const password = u.providers.includes('password');

  const makeCode = async () => {
    setMaking(true);
    setCode(await onResetCode(u));
    setMaking(false);
  };

  return (
    <>
      <Row>
        <StatusBadge status={u.status} />
        {isAdmin && <Badge size="sm">{ROLE_TEXT.admin}</Badge>}
        {self && <Badge size="sm" tone="accent">{C.me}</Badge>}
      </Row>

      <Section>
        <form className="part-row part-inline" onSubmit={(e) => {
          e.preventDefault();
          if (nameChanged && trimmed) void onChange(u, { display_name: trimmed }, (r) => C.done.renamed(r.display_name));
        }}>
          <Field label={C.nameField}>
            <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </Field>
          <Button type="submit" disabled={!nameChanged || !trimmed || busy}>{COMMON_COPY.save}</Button>
        </form>
        <p className="part-hint">{C.nameHint}</p>
      </Section>

      <Section title={C.partAccess} hint={self ? C.selfHint : C.adminHint}>
        <Switch label={C.adminSwitch} checked={isAdmin} disabled={self || busy}
          onCheckedChange={(on) => void onChange(u, { instance_role: on ? 'admin' : 'user' },
            () => (on ? C.done.adminOn(u.display_name) : C.done.adminOff(u.display_name)))} />
      </Section>

      <Section title={C.partAccount}>
        <KeyValue variant="plain" items={[
          { key: 'login', label: C.kv.login, value: <LoginBadges providers={u.providers} /> },
          {
            key: 'orgs', label: roleLabel('tenant'),
            value: u.orgs.length ? u.orgs.map((o) => orgMembershipText(o.name, toOrgRole(o.role))).join(', ') : <Muted>{C.noOrg}</Muted>,
          },
          { key: 'created', label: C.kv.created, value: dateText(u.created_at) ?? COMMON_COPY.none },
          { key: 'seen', label: C.kv.lastSeen, value: ago(u.last_login_at) ?? C.never },
          { key: 'sessions', label: C.kv.sessions, value: C.sessions(u.session_count) },
        ]} />
        {u.status === 'disabled' && <Callout>{C.disabledNote}</Callout>}
        <Row>
          <Button icon="logout" disabled={busy || u.session_count === 0} title={C.revokeHint}
            onClick={() => void onRevoke(u, (n) => C.done.revoked(n))}>{C.revoke}</Button>
          {u.status === 'active' ? (
            <Button variant="danger" disabled={self || busy} onClick={() => setConfirmOff(true)}>{C.disable}</Button>
          ) : (
            <Button disabled={busy} onClick={() => void onChange(u, { status: 'active' }, () => C.done.enabled(u.display_name))}>{C.enable}</Button>
          )}
        </Row>
      </Section>

      <UsageSection filter={{ user: u.id }} />

      <Section title={C.partReset} hint={google && !password ? C.resetGoogleOnly : C.resetHint}>
        {code ? (
          <OneTimeCode code={code.code} label={C.resetLabel}>
            <p className="part-hint">{C.resetExpires(left(code.expires_at) ?? '')}</p>
          </OneTimeCode>
        ) : (
          <Row>
            <Button icon="lock" loading={making} disabled={busy || u.status === 'disabled'} onClick={() => void makeCode()}>{C.resetBtn}</Button>
          </Row>
        )}
      </Section>

      <ConfirmDialog open={confirmOff} title={C.disableTitle(u.display_name)} confirm={C.disable} busy={busy}
        onClose={() => setConfirmOff(false)}
        onConfirm={async () => {
          if (await onChange(u, { status: 'disabled' }, () => C.done.disabled(u.display_name))) setConfirmOff(false);
        }}>
        {C.disableBody}
      </ConfirmDialog>
    </>
  );
}
