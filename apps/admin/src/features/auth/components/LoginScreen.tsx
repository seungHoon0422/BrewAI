import { Button, Callout, Field, Input, LinkButton, Mark, PasswordInput, Spinner } from '@brewai/ui';
import { GOOGLE_START } from '../api';
import { AUTH_COPY as C, LOGIN_ERROR, NOTICE } from '../copy';
import { useAuthState, useLoginForm } from '../hooks';
import '../auth.css';

// 관리자 로그인 (콘솔 전체의 문). 이메일 + 비밀번호 · Google (서버에 켜져 있을 때만). 가입은 없다 — 관리자 계정은 .env 첫 관리자 · 사용자 탭에서
export function LoginScreen({ notice }: { notice: string | null }) {
  const form = useLoginForm();
  const auth = useAuthState();
  const shown = notice ? (NOTICE[notice] ?? { tone: 'danger' as const, text: LOGIN_ERROR[notice] ?? LOGIN_ERROR.unknown }) : null;

  return (
    <main className="login">
      <div className="login-card">
        <header className="login-head">
          <Mark size={32} />
          <h1>{C.title}</h1>
          <p>{C.lead}</p>
        </header>

        {auth?.needs_bootstrap && <Callout tone="warn" title={C.bootstrap}>{C.bootstrapSub}</Callout>}
        {auth?.test_admin && <Callout tone="info" title={C.testAdmin}>{C.testAdminSub}</Callout>}
        {auth && !auth.needs_bootstrap && !auth.test_admin && auth.first_login && <Callout tone="info" title={C.firstLogin}>{C.firstLoginSub}</Callout>}
        {shown && !form.error && <Callout live tone={shown.tone}>{shown.text}</Callout>}
        {form.error && <Callout live tone="danger">{form.error}</Callout>}

        <form className="login-form" aria-label={C.form} onSubmit={(e) => void form.submit(e)} noValidate>
          <Field label={C.email}>
            {/* type=text: 테스트 관리자 ID 'admin' 은 이메일 모양이 아니다 (검사는 서버가 한다) */}
            <Input type="text" inputMode="email" size="lg" autoComplete="username" autoCapitalize="off" spellCheck={false} autoFocus
              placeholder={C.emailPlaceholder} value={form.email} onChange={(e) => form.setEmail(e.target.value)} />
          </Field>
          <Field label={C.password}>
            <PasswordInput size="lg" autoComplete="current-password" value={form.password} onChange={(e) => form.setPassword(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={form.busy}>{form.busy ? C.submitting : C.submit}</Button>
        </form>

        {auth?.google && (
          <>
            <p className="login-or"><span>{C.or}</span></p>
            <LinkButton href={GOOGLE_START} size="lg" block>{C.google}</LinkButton>
          </>
        )}

        <p className="login-foot">{C.onlyAdmins}</p>
      </div>
    </main>
  );
}

export function SessionChecking() {
  return (
    <main className="login" aria-busy="true">
      <Spinner size="md" label={C.checking} />
    </main>
  );
}
