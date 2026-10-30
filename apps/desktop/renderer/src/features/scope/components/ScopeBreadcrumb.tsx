// 범위 경로 줄 — API 의 path 를 받아 그대로 그린다 (층 이름 · 아이콘 · 숨김 규칙은 model.ts). 보일 칸이 없으면 아무것도 안 그린다.
// 칸을 누르면 onNavigate(crumb) — 어디로 갈지는 앱 틀(app/navigate.ts)이 층 역할로 정한다.
import { Breadcrumb, type ScopeCrumb, type ScopePath } from '@brewai/ui';
import { useScopePath } from '../hooks';
import { kindIcon, kindLabel } from '../model';

export function ScopeBreadcrumb({ path, withItem, onNavigate, className }: {
  path: ScopePath;
  withItem?: boolean;
  onNavigate?: (crumb: ScopeCrumb) => void;
  className?: string;
}) {
  const shown = useScopePath(path, withItem);
  if (!shown.length) return null;
  return <Breadcrumb path={shown} kindLabel={kindLabel} kindIcon={kindIcon} onNavigate={onNavigate} className={className} />;
}
