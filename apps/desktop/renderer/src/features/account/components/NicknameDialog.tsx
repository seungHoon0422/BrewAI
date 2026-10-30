// 닉네임 바꾸기 — 1~40자 · 중복 허용 (서버가 공백을 하나로 접는다)
import { useState, type FormEvent } from 'react';
import { Button, Dialog, Field, Input } from '@brewai/ui';
import { codeOf } from '../../../lib/api';
import { ACCOUNT, accountError } from '../copy';
import { saveNickname } from '../hooks';

export function NicknameDialog({ open, current, onClose, onSaved }: { open: boolean; current: string; onClose: () => void; onSaved: () => void }) {
  return open ? <NicknameForm current={current} onClose={onClose} onSaved={onSaved} /> : null;
}

// 열 때마다 새로 (지금 닉네임에서 시작)
function NicknameForm({ current, onClose, onSaved }: { current: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = name.trim().replace(/\s+/g, ' ');
  const ok = value.length >= 1 && [...value].length <= 40 && value !== current;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveNickname(value);
      onSaved();
      onClose();
    } catch (err) {
      setError(accountError(codeOf(err)));
      setBusy(false);
    }
  };
  return (
    <Dialog size="sm" open onClose={onClose} title={ACCOUNT.nicknameTitle} dismissible={!busy}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>{ACCOUNT.cancel}</Button>
        <Button variant="primary" type="submit" form="nickname" loading={busy} disabled={!ok}>{ACCOUNT.save}</Button>
      </>}>
      <form id="nickname" className="form" onSubmit={submit} noValidate>
        <Field label={ACCOUNT.nickname} hint={ACCOUNT.nicknameHint} error={error ?? undefined}>
          <Input value={name} maxLength={40} autoFocus autoComplete="nickname" onChange={(e) => setName(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
