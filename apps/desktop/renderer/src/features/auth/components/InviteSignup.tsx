// 초대 코드로 가입 — 1) 코드 → 미리보기(조직 · 초대한 사람 · 역할 · 스페이스 · 가린 이메일) 2) [Google로 가입] 또는 이메일 · 닉네임 · 비밀번호
import { useState, type FormEvent } from 'react';
import { Badge, Button, Callout, Card, Field, Icon, Input, PasswordInput, passwordStrength } from '@brewai/ui';
import { tidyInvite, type InvitePreview } from '../api';
import { AUTH, INVITE, dateText, errorText } from '../copy';
import { previewCode, showView, signup, usePasswordMin } from '../hooks';
import { GoogleButton } from './GoogleButton';

export function InviteSignup() {
  const min = usePasswordMin();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    const r = await previewCode(tidyInvite(code));
    setBusy(false);
    if (r.ok) setPreview(r.data);
    else setError(errorText(r.code));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await signup({ code: tidyInvite(code), email, password, display_name: nickname.trim() || undefined });
    setBusy(false);
    if (!r.ok) setError(errorText(r.code, { min, wait: r.retryAfter }));
  };

  const head = (
    <header className="auth-head">
      <h1 id="auth-title">{INVITE.title}</h1>
      {!preview && <p className="auth-sub">{INVITE.sub}</p>}
    </header>
  );
  const back = (
    <p className="auth-alt">
      <button type="button" className="auth-link" onClick={() => showView('login')}>{AUTH.back}</button>
    </p>
  );

  if (!preview) {
    return (
      <>
        {head}
        {error && <Callout tone="danger" live>{error}</Callout>}
        <form className="auth-form" onSubmit={check} noValidate>
          <Field label={INVITE.code}>
            <Input className="auth-code" placeholder={INVITE.codePlaceholder} value={code} autoFocus autoComplete="off" spellCheck={false}
              onChange={(e) => setCode(e.target.value)} size="lg" />
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!code.trim()}>{INVITE.check}</Button>
        </form>
        {back}
      </>
    );
  }

  const strength = passwordStrength(password, min);
  return (
    <>
      {head}
      <Card variant="sunken" padding="md" className="auth-invite">
        <p className="auth-invite-org"><Icon name="building" size="sm" />{preview.org.name}</p>
        <p className="auth-sub">
          {preview.inviter_name && <>{INVITE.invitedBy(preview.inviter_name)} · </>}
          {INVITE.joinAs(INVITE.orgRole[preview.org_role])}
          {preview.expires_at && <> · {INVITE.expires(dateText(preview.expires_at))}</>}
        </p>
        {preview.spaces.length > 0 && (
          <p className="auth-invite-spaces" aria-label={INVITE.spaces}>
            {preview.spaces.map((s) => <Badge key={s.id} size="sm">{s.name}</Badge>)}
          </p>
        )}
        {preview.email_hint && <p className="auth-sub">{INVITE.emailOnly(preview.email_hint)}</p>}
      </Card>
      {error && <Callout tone="danger" live>{error}</Callout>}
      {preview.google && (
        <>
          <GoogleButton label={AUTH.googleSignup} invite={tidyInvite(code)} onError={setError} />
          <div className="auth-or"><span>{AUTH.or}</span></div>
        </>
      )}
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label={AUTH.email} required>
          <Input type="email" autoComplete="username" placeholder={preview.email_hint ?? AUTH.emailPlaceholder} value={email}
            onChange={(e) => setEmail(e.target.value)} size="lg" />
        </Field>
        <Field label={INVITE.nickname} hint={INVITE.nicknameHint}>
          <Input autoComplete="nickname" placeholder={INVITE.nicknamePlaceholder} value={nickname} maxLength={40}
            onChange={(e) => setNickname(e.target.value)} size="lg" />
        </Field>
        <Field label={AUTH.password} hint={INVITE.passwordHint(min)} required>
          <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} size="lg"
            strength={strength} />
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy}
          disabled={!email.trim() || [...password].length < min}>{INVITE.submit}</Button>
      </form>
      <p className="auth-alt">
        <button type="button" className="auth-link" onClick={() => { setPreview(null); setError(null); }}>{INVITE.other}</button>
        <span aria-hidden="true">·</span>
        <button type="button" className="auth-link" onClick={() => showView('login')}>{AUTH.back}</button>
      </p>
    </>
  );
}
