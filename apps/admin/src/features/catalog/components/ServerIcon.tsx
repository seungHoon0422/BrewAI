import { Avatar } from '@brewai/ui';
import { presetIconPath, serverIconPath } from '../api';
import { useIconSrc } from '../icons';

// 서버 아이콘 = 서비스 사이트 그림 (conductor 캐시) · 없으면 첫 글자 네모 (@brewai/ui Avatar square). 이름이 늘 옆에 있다 = 장식
export function ServerIcon({ id, preset, name, size = 'sm' }: { id?: string | null; preset?: string | null; name: string; size?: 'xs' | 'sm' | 'md' }) {
  const src = useIconSrc(id ? serverIconPath(id) : preset ? presetIconPath(preset) : null);
  return <Avatar name={name} initials={([...name.trim()][0] ?? '?').toUpperCase()} src={src ?? undefined} size={size} shape="square" decorative className="mcp-icon" />;
}
