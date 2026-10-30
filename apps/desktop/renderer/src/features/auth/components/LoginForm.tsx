// 로그인 — [Google로 계속](서버에 키가 있을 때만) · 이메일 · 비밀번호 · [로그인] · 초대 코드 · 비밀번호 잊음
import { useState, type FormEvent } from 'react';
import { Button, Callout, Field, Input, PasswordInput } from '@brewai/ui';
import { AUTH, errorText } from '../copy';
import { login, showView, useAuth } from '../hooks';
import { GoogleButton } from './GoogleButton';

export function LoginForm() {
  const reason = useAuth((s) => s.reason);
  const notice = useAuth((s) => s.notice);
  const google = useAuth((s) => s.server.info?.google ?? false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    const r = await login(email, password);
    setBusy(false);
    if (!r.ok) {
      setError(errorText(r.code, { wait: r.retryAfter }));
      setPassword('');
    }
  };

  return (
    <>
      <header className="auth-head">
        <h1 id="auth-title">{AUTH.loginTitle}</h1>
        <p className="auth-sub">{AUTH.loginSub}</p>
      </header>
      {reason === 'expired' && !error && <Callout tone="info" live>{AUTH.expired}</Callout>}
      {notice && !error && <Callout tone="ok" live>{notice}</Callout>}
      {error && <Callout tone="danger" live>{error}</Callout>}
      {google && (
        <>
          <GoogleButton label={AUTH.google} onError={setError} />
          <div className="auth-or"><span>{AUTH.or}</span></div>
        </>
      )}
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <Field label={AUTH.email}>
          <Input type="email" autoComplete="username" placeholder={AUTH.emailPlaceholder} value={email} data-autofocus autoFocus
            onChange={(e) => setEmail(e.target.value)} size="lg" />
        </Field>
        <Field label={AUTH.password}
          aside={<button type="button" className="auth-link" onClick={() => showView('reset')}>{AUTH.forgot}</button>}>
          <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} size="lg" />
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!email.trim() || !password}>{AUTH.login}</Button>
      </form>
      <p className="auth-alt">
        <button type="button" className="auth-link" onClick={() => showView('invite')}>{AUTH.haveInvite}</button>
      </p>
    </>
  );
}
