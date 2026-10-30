import { Badge } from '@brewai/ui';
import type { AdminUserRow } from '../api';
import { PROVIDER_TEXT, STATUS_TEXT } from '../copy';

// 로그인 방법 꼬리표 (비밀번호 · Google)
export function LoginBadges({ providers }: { providers: readonly string[] }) {
  return (
    <span className="part-tags">
      {providers.map((p) => <Badge key={p} size="sm" variant="outline">{PROVIDER_TEXT[p] ?? p}</Badge>)}
    </span>
  );
}

// 계정 상태 (활성 · 비활성)
export const StatusBadge = ({ status }: { status: AdminUserRow['status'] }) => (
  <Badge dot size="sm" tone={status === 'active' ? 'ok' : 'neutral'}>{STATUS_TEXT[status]}</Badge>
);
