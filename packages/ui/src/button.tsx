// 버튼 — 알약 모양 하나 (variant 로 무게만 바꾼다). 주 버튼 = 잉크(--accent) · 색은 상태에만 쓰므로 danger 는 글자색 + 옅은 바탕
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx, flag } from './cx';
import { renderIcon, type IconLike } from './icons';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ControlSize = 'sm' | 'md' | 'lg';

type ButtonLook = {
  variant?: ButtonVariant;
  size?: ControlSize;
  icon?: IconLike; // 글 앞
  iconEnd?: IconLike; // 글 뒤 (펼침 꺾쇠 · 바깥 링크)
  block?: boolean; // 줄 너비 가득
};

const iconSize = (size: ControlSize) => (size === 'lg' ? 'md' : 'sm');

function Inner({ icon, iconEnd, size, loading, children }: { icon?: IconLike; iconEnd?: IconLike; size: ControlSize; loading?: boolean; children?: ReactNode }) {
  return (
    <>
      {loading ? <Spinner size="xs" /> : renderIcon(icon, iconSize(size))}
      {children}
      {renderIcon(iconEnd, iconSize(size))}
    </>
  );
}

export type ButtonProps = ButtonLook & ComponentPropsWithRef<'button'> & { loading?: boolean };

export function Button({ variant = 'secondary', size = 'md', icon, iconEnd, block, loading, className, children, type = 'button', disabled, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('ui-btn', className)}
      data-variant={variant}
      data-size={size}
      data-block={flag(block)}
      data-loading={flag(loading)}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...rest}
    >
      <Inner icon={icon} iconEnd={iconEnd} size={size} loading={loading}>{children}</Inner>
    </button>
  );
}

// 모양은 버튼, 동작은 링크 (바깥 화면 · 다른 경로로 갈 때)
export type LinkButtonProps = ButtonLook & ComponentPropsWithRef<'a'>;

export function LinkButton({ variant = 'secondary', size = 'md', icon, iconEnd, block, className, children, ...rest }: LinkButtonProps) {
  return (
    <a className={cx('ui-btn', className)} data-variant={variant} data-size={size} data-block={flag(block)} {...rest}>
      <Inner icon={icon} iconEnd={iconEnd} size={size}>{children}</Inner>
    </a>
  );
}

// 아이콘만 있는 버튼 — label 은 필수 (aria-label + 마우스 툴팁 title)
export type IconButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  icon: IconLike;
  label: string;
  size?: ControlSize;
  variant?: 'ghost' | 'secondary' | 'primary'; // primary = 잉크 면 (입력창 보내기 · 멈추기)
  shape?: 'round'; // 알약 (기본 = 둥근 사각)
  pressed?: boolean; // 켜고 끄는 버튼 (사이드바 열기 등) → aria-pressed
  tooltip?: boolean; // false = title 을 달지 않는다 (옆에 같은 글이 보일 때)
};

export function IconButton({ icon, label, size = 'md', variant = 'ghost', shape, pressed, tooltip = true, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx('ui-icon-btn', className)}
      data-variant={variant}
      data-size={size}
      data-shape={shape}
      aria-label={label}
      title={tooltip ? label : undefined}
      aria-pressed={pressed}
      {...rest}
    >
      {renderIcon(icon, size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : 'md')}
    </button>
  );
}
