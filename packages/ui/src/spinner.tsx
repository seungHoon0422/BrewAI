// 기다림 표시 — 돌아가는 고리(짧은 기다림 · 버튼 안) · 뼈대(목록 · 표가 처음 채워질 때)
import type { CSSProperties } from 'react';
import { cx } from './cx';

// label 이 있으면 화면 읽기 프로그램에 알린다 (role=status). 없으면 장식 — 주변 글이 상태를 말한다
export function Spinner({ size = 'sm', label, className }: { size?: 'xs' | 'sm' | 'md'; label?: string; className?: string }) {
  return label ? (
    <span className={cx('ui-spinner', className)} data-size={size} role="status">
      <span className="ui-sr">{label}</span>
    </span>
  ) : (
    <span className={cx('ui-spinner', className)} data-size={size} aria-hidden="true" />
  );
}

// 뼈대 줄 — lines 개를 쌓는다 (마지막 줄은 짧게). 크기는 토큰이 아니라 그 자리 글 모양을 흉내 내는 값
export function Skeleton({ lines = 1, width, height, radius, className }: {
  lines?: number;
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  radius?: 'sm' | 'md' | 'lg' | 'pill';
  className?: string;
}) {
  return (
    <span className={cx('ui-skeleton', className)} data-radius={radius} aria-hidden="true">
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <i key={i} style={{ width: lines > 1 && i === lines - 1 ? '60%' : width, height }} />
      ))}
    </span>
  );
}
