import { Breadcrumb } from '@brewai/ui';
import { SCOPE_COPY } from '../copy';
import { useScopePath } from '../hooks';
import { kindIcon, kindLabel } from '../model';

// 화면 머리의 위치 줄. 경로가 없으면 그리지 않는다 (지금 관리자 화면은 범위가 없다 → 조직 · 스페이스 화면부터)
export function ScopeBreadcrumb() {
  const path = useScopePath();
  if (path.length === 0) return null;
  return <Breadcrumb path={path} kindLabel={kindLabel} kindIcon={kindIcon} label={SCOPE_COPY.breadcrumb} />;
}
