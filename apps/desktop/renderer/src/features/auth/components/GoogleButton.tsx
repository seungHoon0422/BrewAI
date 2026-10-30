// [Google로 계속] — 시스템 브라우저에서 로그인 → 앱으로 돌아온다 (main 의 loopback · PKCE). 실패 코드는 부르는 쪽이 문구로
import { Button } from '@brewai/ui';
import { errorText } from '../copy';
import { continueWithGoogle } from '../hooks';

export function GoogleButton({ label, invite, onError }: { label: string; invite?: string; onError: (text: string | null) => void }) {
  const onClick = async () => {
    onError(null);
    const r = await continueWithGoogle({ invite });
    if (!r.ok && r.code !== 'cancelled') onError(errorText(r.code));
  };
  return <Button size="lg" block iconEnd="external" onClick={() => void onClick()}>{label}</Button>;
}
