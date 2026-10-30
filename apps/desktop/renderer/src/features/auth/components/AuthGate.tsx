// 로그인 게이트 — 셸보다 먼저. 처음엔 로그인 화면만, 로그인한 뒤 만료되면 화면 위 덮개 (아래 화면 · 쓰던 글은 그대로 · ADR-0010).
// 트리 모양을 바꾸지 않는다: [작업 화면, 덮개] 두 칸 고정 → 덮개가 생겨도 아래 화면이 새로 만들어지지 않는다.
import { useEffect, type ReactNode } from 'react';
import { Mark, Spinner } from '@brewai/ui';
import { AUTH } from '../copy';
import { startAuth, useAuth } from '../hooks';
import { AuthScreen } from './AuthScreen';

export function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const ever = useAuth((s) => s.everSignedIn);
  useEffect(startAuth, []);

  if (status === 'checking' && !ever) {
    return (
      <div className="auth-splash" role="status" aria-label={AUTH.checking}>
        <Mark size={36} />
        <Spinner size="sm" />
      </div>
    );
  }
  const locked = status !== 'signed_in';
  return (
    <>
      {ever ? <div className="auth-host" inert={locked}>{children}</div> : null}
      {locked ? <AuthScreen overlay={ever} /> : null}
    </>
  );
}
