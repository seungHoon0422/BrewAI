// 보여 주기 부품 — 배지 · 칩 · 상태 점 · 아바타 · 키 · 카드 · 숫자 카드 · 알림 줄 · 키/값 · 빈 상태.
// 색 규칙 (ADR-0012): 색 = 상태만. 배지 = 옅은 바탕 + 상태 글자색 · 점 = 6~8px. 강조 테두리 · 색 띠 · 색 면은 쓰지 않는다.
import type { ComponentPropsWithRef, ElementType, HTMLAttributes, ReactNode } from 'react';
import { cx, flag } from './cx';
import { UI_COPY } from './copy';
import { Icon, renderIcon, type IconLike } from './icons';

export type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger' | 'accent';

/* ── 배지 (읽기 전용 꼬리표: 상태 · 종류 · '기본') ───── */
export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  variant?: 'soft' | 'outline' | 'solid';
  size?: 'sm' | 'md';
  dot?: boolean; // 앞에 점 (상태 배지)
  mono?: boolean; // id · 버전 · 숫자
};

export function Badge({ tone = 'neutral', variant = 'soft', size = 'md', dot, mono, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx('ui-badge', className)} data-tone={tone} data-variant={variant} data-size={size} data-dot={flag(dot)} data-mono={flag(mono)} {...rest}>
      {children}
    </span>
  );
}

/* ── 칩 (누르는 거르개 · 고른 것 표시) ─────────────────── */
export type ChipProps = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  children: ReactNode;
  selected?: boolean; // aria-pressed
  icon?: IconLike;
  count?: ReactNode; // 오른쪽 숫자
};

export function Chip({ children, selected, icon, count, className, type = 'button', ...rest }: ChipProps) {
  return (
    <button type={type} className={cx('ui-chip', className)} aria-pressed={selected ?? false} {...rest}>
      {renderIcon(icon, 'sm')}
      <span className="ui-chip-label">{children}</span>
      {count !== undefined && <span className="ui-chip-count ui-num">{count}</span>}
    </button>
  );
}

/* ── 상태 점 (prototype 의 run · wait · ok · fail · stop + idle · warn) ── */
export type DotState = 'idle' | 'run' | 'wait' | 'ok' | 'warn' | 'fail' | 'stop';

export function StatusDot({ state, label, size = 'md', className }: { state: DotState; label?: string; size?: 'sm' | 'md'; className?: string }) {
  return (
    <span className={cx('ui-dot', className)} data-state={state} data-size={size} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
  );
}

/* ── 아바타 (사진 없으면 닉네임 머리글자) ──────────────── */
const HANGUL = /^[가-힣]+$/;

// 닉네임 → 머리글자: 한글 3자 이상 = 뒤 2자 (백승훈 → 승훈) · 한글 1~2자 = 그대로 · 영문 = 단어 첫 글자 2개 (Seung Hoon → SH) · 한 단어 = 첫 글자
export function initialsOf(name: string): string {
  const s = name.trim();
  if (!s) return '?';
  if (HANGUL.test(s)) return s.length >= 3 ? s.slice(-2) : s;
  const words = s.split(/[\s._-]+/).filter(Boolean);
  const chars = (words.length >= 2 ? [words[0], words[1]] : [words[0] ?? s]).map((w) => [...w][0] ?? '');
  return chars.join('').toUpperCase();
}

// 아바타 = 무채색 하나 (색은 상태에만 · ADR-0012 — 사람마다 다른 색이면 노란 아바타가 경고처럼 읽힌다)
export function Avatar({ name, src, size = 'md', className }: { name: string; src?: string; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span className={cx('ui-avatar', className)} data-size={size} title={name}>
      {src ? <img src={src} alt="" /> : <span aria-hidden="true">{initialsOf(name)}</span>}
      <span className="ui-sr">{name}</span>
    </span>
  );
}

/* ── 키 ──────────────────────────────────────────────── */
export function Kbd({ keys, children }: { keys?: readonly string[]; children?: ReactNode }) {
  if (!keys) return <kbd className="ui-kbd">{children}</kbd>;
  return (
    <span className="ui-kbd-group">
      {keys.map((k) => <kbd key={k} className="ui-kbd">{k}</kbd>)}
    </span>
  );
}

/* ── 카드 (테두리 상자) ──────────────────────────────── */
export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'section' | 'article' | 'li';
  variant?: 'outline' | 'sunken' | 'glass'; // glass = 살아 있는 상태 · 떠 있는 정보만
  padding?: 'none' | 'sm' | 'md' | 'lg';
  interactive?: boolean; // 손을 올리면 테두리가 진해진다 (누르는 카드)
  selected?: boolean;
};

export function Card({ as = 'div', variant = 'outline', padding = 'md', interactive, selected, className, children, ...rest }: CardProps) {
  const Tag = as as ElementType;
  return (
    <Tag
      className={cx('ui-card', variant === 'glass' && 'ui-glass', className)}
      data-variant={variant}
      data-padding={padding}
      data-interactive={flag(interactive)}
      data-selected={flag(selected)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({ title, description, icon, actions, level = 3 }: {
  title: ReactNode;
  description?: ReactNode;
  icon?: IconLike;
  actions?: ReactNode;
  level?: 2 | 3 | 4;
}) {
  const H = `h${level}` as ElementType;
  return (
    <div className="ui-card-head">
      {icon && <span className="ui-tile">{renderIcon(icon)}</span>}
      <div className="ui-card-titles">
        <H className="ui-card-title">{title}</H>
        {description && <p className="ui-card-desc">{description}</p>}
      </div>
      {actions && <div className="ui-card-actions">{actions}</div>}
    </div>
  );
}

/* ── 숫자 카드 (개요 · 요약. onClick 이 있으면 거르개 버튼) ── */
export type StatCardProps = {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: IconLike;
  tone?: Exclude<Tone, 'accent'>; // 숫자 글자색 (상태일 때만)
  pressed?: boolean;
  onClick?: () => void;
  className?: string;
};

export function StatCard({ label, value, sub, icon, tone = 'neutral', pressed, onClick, className }: StatCardProps) {
  const inner = (
    <>
      <span className="ui-stat-label">{renderIcon(icon, 'sm')}{label}</span>
      <span className="ui-stat-value ui-num" data-tone={tone}>{value}</span>
      {sub && <span className="ui-stat-sub">{sub}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={cx('ui-stat', className)} aria-pressed={pressed ?? false} onClick={onClick}>{inner}</button>
  ) : (
    <div className={cx('ui-stat', className)}>{inner}</div>
  );
}

/* ── 알림 줄 (화면 안에 머무는 안내 · 경고 · 오류) ────── */
export type CalloutProps = {
  tone?: Exclude<Tone, 'accent'>;
  icon?: IconLike;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  live?: boolean; // 나타날 때 읽어 준다 (danger = alert · 그 밖 = status)
  className?: string;
};

const CALLOUT_ICON = { neutral: 'info', info: 'info', ok: 'check', warn: 'alert', danger: 'alert' } as const;

export function Callout({ tone = 'neutral', icon, title, children, action, onDismiss, dismissLabel = UI_COPY.close, live, className }: CalloutProps) {
  return (
    <div className={cx('ui-callout', className)} data-tone={tone} role={live ? (tone === 'danger' ? 'alert' : 'status') : undefined}>
      {renderIcon(icon ?? CALLOUT_ICON[tone], 'sm')}
      <div className="ui-callout-main">
        {title && <p className="ui-callout-title">{title}</p>}
        {children && <div className="ui-callout-body">{children}</div>}
      </div>
      {action}
      {onDismiss && (
        <button type="button" className="ui-callout-x" aria-label={dismissLabel} title={dismissLabel} onClick={onDismiss}>
          <Icon name="close" size="sm" />
        </button>
      )}
    </div>
  );
}

/* ── 키/값 (설정 · 자세히) ────────────────────────────── */
export type KeyValueItem = { key?: string; label: ReactNode; value: ReactNode; mono?: boolean; aside?: ReactNode };

export function KeyValue({ items, variant = 'boxed', className }: { items: readonly KeyValueItem[]; variant?: 'boxed' | 'plain'; className?: string }) {
  return (
    <dl className={cx('ui-kv', className)} data-variant={variant}>
      {items.map((it, i) => (
        <div key={it.key ?? i} className="ui-kv-row">
          <dt>{it.label}</dt>
          <dd data-mono={flag(it.mono)}>{it.value}</dd>
          {it.aside && <dd className="ui-kv-aside">{it.aside}</dd>}
        </div>
      ))}
    </dl>
  );
}

/* ── 한 줄에 사실 여러 개 (칸 나눔 = 여백. 가운뎃점 · 같은 구분 글자를 쓰지 않는다) ───── */
export type MetaProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  items: readonly ReactNode[]; // 빈 값(null · false · '')은 건너뛴다
  wrap?: boolean; // 기본 = 한 줄 (넘치면 마지막 칸이 말줄임)
};

export function Meta({ items, wrap, className, ...rest }: MetaProps) {
  const shown = items.filter((x) => x !== null && x !== undefined && x !== false && x !== '');
  if (!shown.length) return null;
  return (
    <span className={cx('ui-meta', className)} data-wrap={flag(wrap)} {...rest}>
      {shown.map((x, i) => (
        // 칸 사이 빈칸 = 글로 읽을 때(화면 낭독기 · 복사) 낱말이 붙지 않게. 보이는 간격은 CSS gap
        <span key={i} className="ui-meta-item">{i > 0 && ' '}{x}</span>
      ))}
    </span>
  );
}

/* ── 빈 상태 (무엇이 보일지 + 무엇이 있어야 하는지) ───── */
export type EmptyStateProps = {
  title: ReactNode;
  children?: ReactNode; // 설명
  icon?: IconLike;
  action?: ReactNode;
  variant?: 'boxed' | 'plain'; // plain = 표 · 카드 안
  className?: string;
};

export function EmptyState({ title, children, icon = 'inbox', action, variant = 'boxed', className }: EmptyStateProps) {
  return (
    <div className={cx('ui-empty', className)} data-variant={variant}>
      <span className="ui-tile" data-size="lg">{renderIcon(icon)}</span>
      <p className="ui-empty-title">{title}</p>
      {children && <div className="ui-empty-desc">{children}</div>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}
