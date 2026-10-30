// 비밀번호 재설정 — 담당자에게 받은 bwp_ 코드 + 새 비밀번호 → 모든 세션 폐기 → 로그인 화면 (메일 서버 없음 · slice 04)
import { useState, type FormEvent } from 'react';
import { Button, Callout, Field, Input, PasswordInput, passwordStrength } from '@brewai/ui';
import { AUTH, INVITE, RESET, errorText } from '../copy';
import { resetWithCode, showView, usePasswordMin } from '../hooks';

export function ResetForm() {
  const min = usePasswordMin();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await resetWithCode(code, password);
    if (r.ok) return showView('login', RESET.done);
    setError(errorText(r.code, { min }));
    setBusy(false);
  };

  return (
    <>
      <header className="auth-head">
        <h1 id="auth-title">{RESET.title}</h1>
        <p className="auth-sub">{RESET.sub}</p>
      </header>
      {error && <Callout tone="danger" live>{error}</Callout>}
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label={RESET.code}>
          <Input placeholder={RESET.codePlaceholder} value={code} autoFocus autoComplete="off" spellCheck={false}
            onChange={(e) => setCode(e.target.value)} size="lg" />
        </Field>
        <Field label={RESET.password} hint={INVITE.passwordHint(min)}>
          <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} size="lg"
            strength={passwordStrength(password, min)} />
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy}
          disabled={!code.trim() || [...password].length < min}>{RESET.submit}</Button>
      </form>
      <p className="auth-alt">
        <button type="button" className="auth-link" onClick={() => showView('login')}>{AUTH.back}</button>
      </p>
    </>
  );
}
