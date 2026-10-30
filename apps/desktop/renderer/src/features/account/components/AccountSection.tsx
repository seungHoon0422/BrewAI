// 설정 › 계정 — 닉네임 [변경] · 이메일(로그인 ID · 읽기 전용) · 비밀번호 [변경] · Google [연결]/[해제] (마지막 로그인 방법은 해제 불가)
import { useState } from 'react';
import { Badge, Button, Callout, Dialog } from '@brewai/ui';
import { codeOf } from '../../../lib/api';
import { useAuth, useMe } from '../../auth/hooks';
import { Row, Section } from '../../shell/components/Page';
import { ACCOUNT, accountError } from '../copy';
import { disconnectGoogle, linkGoogle } from '../hooks';
import { NicknameDialog } from './NicknameDialog';
import { PasswordDialog } from './PasswordDialog';

export const ACCOUNT_ANCHOR = 'account'; // 계정 칩 › 설정 이 이 섹션으로

export function AccountSection() {
  const me = useMe();
  const googleOn = useAuth((s) => s.server.info?.google ?? false);
  const pending = useAuth((s) => s.googlePending);
  const [dialog, setDialog] = useState<'nickname' | 'password' | 'unlink' | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const lastMethod = !me.has_password; // Google 만 있으면 해제할 수 없다

  const connect = async () => {
    setNote(null);
    const r = await linkGoogle().catch((e) => ({ linked: false, error: accountError(codeOf(e)) }));
    setNote(r.error ? { tone: 'danger', text: r.error } : r.linked ? { tone: 'ok', text: ACCOUNT.googleLinked } : null);
  };
  const unlink = async () => {
    setBusy(true);
    try {
      await disconnectGoogle();
      setNote({ tone: 'ok', text: ACCOUNT.googleUnlinked });
    } catch (e) {
      setNote({ tone: 'danger', text: accountError(codeOf(e)) });
    } finally {
      setBusy(false);
      setDialog(null);
    }
  };

  return (
    <Section title={ACCOUNT.section} id={ACCOUNT_ANCHOR}>
      {note && <Callout tone={note.tone} live onDismiss={() => setNote(null)} className="sec-note">{note.text}</Callout>}
      <ul className="rows">
        <Row title={ACCOUNT.nickname} sub={ACCOUNT.nicknameSub}>
          <span className="val">{me.display_name}</span>
          <Button size="sm" onClick={() => setDialog('nickname')}>{ACCOUNT.change}</Button>
        </Row>
        <Row title={ACCOUNT.email} sub={ACCOUNT.emailSub}>
          <span className="val">{me.email}</span>
        </Row>
        <Row title={ACCOUNT.password} sub={ACCOUNT.passwordSub(me.has_password)}>
          <span className="val">{me.has_password ? ACCOUNT.passwordSet : ACCOUNT.passwordNone}</span>
          <Button size="sm" onClick={() => setDialog('password')}>{me.has_password ? ACCOUNT.change : ACCOUNT.create}</Button>
        </Row>
        {(googleOn || me.google) && (
          <Row title={ACCOUNT.google} sub={pending ? ACCOUNT.googleWait : ACCOUNT.googleSub(me.google?.email ?? null)}>
            {me.google ? (
              <>
                <Badge size="sm" tone="ok" dot>{me.google.email ?? ACCOUNT.google}</Badge>
                <Button size="sm" variant="ghost" disabled={lastMethod} title={lastMethod ? ACCOUNT.lastMethod : undefined}
                  onClick={() => setDialog('unlink')}>{ACCOUNT.disconnect}</Button>
              </>
            ) : (
              <>
                <span className="val">{ACCOUNT.googleOff}</span>
                <Button size="sm" iconEnd="external" loading={pending} onClick={() => void connect()}>{ACCOUNT.connect}</Button>
              </>
            )}
          </Row>
        )}
      </ul>
      <NicknameDialog open={dialog === 'nickname'} current={me.display_name} onClose={() => setDialog(null)}
        onSaved={() => setNote({ tone: 'ok', text: ACCOUNT.saved })} />
      <PasswordDialog open={dialog === 'password'} hasPassword={me.has_password} onClose={() => setDialog(null)}
        onSaved={() => setNote({ tone: 'ok', text: ACCOUNT.passwordChanged })} />
      <Dialog size="sm" open={dialog === 'unlink'} onClose={() => setDialog(null)} title={ACCOUNT.unlinkTitle} description={ACCOUNT.unlinkBody}
        footer={<>
          <Button variant="ghost" onClick={() => setDialog(null)}>{ACCOUNT.cancel}</Button>
          <Button variant="danger" loading={busy} onClick={() => void unlink()}>{ACCOUNT.disconnect}</Button>
        </>} />
    </Section>
  );
}
