// 비밀번호 바꾸기 · 만들기 — 지금 비밀번호(있을 때만) + 새 비밀번호(강도). 바꾸면 다른 기기의 로그인이 끊긴다
import { useState, type FormEvent } from 'react';
import { Button, Dialog, Field, PasswordInput, passwordStrength } from '@brewai/ui';
import { codeOf } from '../../../lib/api';
import { usePasswordMin } from '../../auth/hooks';
import { ACCOUNT, accountError } from '../copy';
import { savePassword } from '../hooks';

export function PasswordDialog({ open, hasPassword, onClose, onSaved }: { open: boolean; hasPassword: boolean; onClose: () => void; onSaved: () => void }) {
  return open ? <PasswordForm hasPassword={hasPassword} onClose={onClose} onSaved={onSaved} /> : null;
}

function PasswordForm({ hasPassword, onClose, onSaved }: { hasPassword: boolean; onClose: () => void; onSaved: () => void }) {
  const min = usePasswordMin();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<{ field: 'current' | 'next'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = (!hasPassword || current.length > 0) && [...next].length >= min;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      await savePassword(hasPassword ? current : null, next);
      onSaved();
      onClose();
    } catch (err) {
      const code = codeOf(err);
      setError({ field: code === 'wrong_password' ? 'current' : 'next', text: accountError(code, min) });
      setBusy(false);
    }
  };
  return (
    <Dialog size="sm" open onClose={onClose} title={ACCOUNT.passwordTitle(hasPassword)} dismissible={!busy}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>{ACCOUNT.cancel}</Button>
        <Button variant="primary" type="submit" form="password" loading={busy} disabled={!ok}>{ACCOUNT.save}</Button>
      </>}>
      <form id="password" className="form" onSubmit={submit} noValidate>
        {hasPassword && (
          <Field label={ACCOUNT.current} error={error?.field === 'current' ? error.text : undefined}>
            <PasswordInput value={current} autoFocus autoComplete="current-password" onChange={(e) => setCurrent(e.target.value)} />
          </Field>
        )}
        <Field label={ACCOUNT.next} hint={ACCOUNT.nextHint(min)} error={error?.field === 'next' ? error.text : undefined}>
          <PasswordInput value={next} autoFocus={!hasPassword} autoComplete="new-password" strength={passwordStrength(next, min)}
            onChange={(e) => setNext(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
