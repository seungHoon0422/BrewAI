// 로그인 화면 틀 — 가운데 카드 하나 (마크 · 제목 · 본문 · 서버 상태 줄). 본문 = 로그인 | 초대 가입 | 재설정 (+ Google 기다림이면 그 위에 안내).
import { Button, Callout, Mark, Spinner } from '@brewai/ui';
import { AUTH } from '../copy';
import { cancelGoogle, useAuth } from '../hooks';
import { InviteSignup } from './InviteSignup';
import { LoginForm } from './LoginForm';
import { ResetForm } from './ResetForm';
import { ServerStatus } from './ServerStatus';

export function AuthScreen({ overlay }: { overlay: boolean }) {
  const status = useAuth((s) => s.status);
  const view = useAuth((s) => s.view);
  const pending = useAuth((s) => s.googlePending);
  const needsBootstrap = useAuth((s) => s.server.info?.needsBootstrap ?? false);
  const firstLogin = useAuth((s) => s.server.info?.firstLogin ?? false);

  // Google 을 기다리는 동안에도 서식은 그대로 둔다 (숨김만) — 끝나면 실패 안내 · 초대 미리보기 · 쓰던 칸이 그 자리에 남는다
  const form = view === 'invite' ? <InviteSignup /> : view === 'reset' ? <ResetForm /> : <LoginForm />;
  let body;
  if (status === 'no_bridge') {
    body = (
      <>
        <header className="auth-head"><h1 id="auth-title">{AUTH.brand}</h1></header>
        <Callout title={AUTH.noBridge}>{AUTH.noBridgeSub}</Callout>
      </>
    );
  } else {
    body = (
      <>
        {pending && (
          <div className="auth-wait" role="status">
            <Spinner size="md" />
            <h1 className="auth-wait-t">{AUTH.googleWaiting}</h1>
            <p className="auth-sub">{AUTH.googleWaitingSub}</p>
            <Button variant="ghost" onClick={() => void cancelGoogle()}>{AUTH.cancel}</Button>
          </div>
        )}
        <div className="auth-body" hidden={pending}>{form}</div>
      </>
    );
  }

  return (
    <div className="auth" data-overlay={overlay ? '' : undefined} role={overlay ? 'dialog' : undefined} aria-modal={overlay || undefined}
      aria-labelledby={overlay ? 'auth-title' : undefined}>
      <div className="auth-drag" aria-hidden="true" />
      <div className="auth-card">
        <Mark size={32} className="auth-mark" />
        {needsBootstrap && view === 'login' && <Callout tone="warn" title={AUTH.bootstrap}>{AUTH.bootstrapSub}</Callout>}
        {!needsBootstrap && firstLogin && view === 'login' && <Callout tone="info" title={AUTH.firstLogin}>{AUTH.firstLoginSub}</Callout>}
        {body}
      </div>
      {status !== 'no_bridge' && <ServerStatus />}
    </div>
  );
}
