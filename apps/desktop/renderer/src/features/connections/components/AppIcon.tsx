import { Avatar } from '@brewai/ui';
import { presetIconPath, serverIconPath } from '../api';
import { useConnections } from '../hooks';
import { useIconSrc } from '../icons';

// 앱 아이콘 = 서비스 사이트 그림 (conductor 가 받아 둔 것 · icons.ts) · 없으면 첫 글자 네모 (@brewai/ui Avatar square).
// 이름은 늘 바로 옆에 있다 = 장식 (화면 읽기가 이름을 두 번 읽지 않게). 대화 카드 · 도구 줄은 handle 로 (내 앱 목록에서 id 를 찾는다)
export const firstLetter = (name: string) => ([...name.trim()][0] ?? '?').toUpperCase();

export function AppIcon({ server, preset, handle, name, size = 'sm', className }: {
  server?: string | null;
  preset?: string | null;
  handle?: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}) {
  const byHandle = useConnections((s) => (handle && !server ? s.apps.data?.mine.find((a) => a.handle === handle)?.id ?? null : null));
  const id = server ?? byHandle;
  const src = useIconSrc(id ? serverIconPath(id) : preset ? presetIconPath(preset) : null);
  return <Avatar name={name} initials={firstLetter(name)} src={src ?? undefined} size={size} shape="square" decorative className={className ? `app-icon ${className}` : 'app-icon'} />;
}
