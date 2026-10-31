// 길 찾기 부품 — 탭 · 위치 경로(Breadcrumb) · 화면 머리 · 도구 줄
import { useId, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { cx, flag } from './cx';
import { UI_COPY } from './copy';
import { Icon, renderIcon, type IconLike, type IconName } from './icons';
import type { ScopeCrumb, ScopePath } from './scope';

/* ── 탭 (화살표로 옮기면 바로 바뀐다) ──────────────────── */
export type TabItem<T extends string> = { id: T; label: ReactNode; count?: number; icon?: IconLike; disabled?: boolean };
export type TabsProps<T extends string> = {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  children?: ReactNode; // 지금 탭의 내용 (없으면 탭 줄만 = 거르개)
  actions?: ReactNode; // 탭 줄 오른쪽 (그 탭의 버튼 · 시각). 좁으면 아래 줄로
  variant?: 'line' | 'pill';
  className?: string;
};

export function Tabs<T extends string>({ items, value, onChange, label, children, actions, variant = 'line', className }: TabsProps<T>) {
  const base = useId();
  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = `${base}-panel`;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const live = items.filter((t) => !t.disabled);
    const at = live.findIndex((t) => t.id === value);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: live.length - 1 }[e.key];
    if (to === undefined || live.length === 0) return;
    e.preventDefault();
    const next = live[(to + live.length) % live.length];
    onChange(next.id);
    document.getElementById(tabId(next.id))?.focus();
  };
  return (
    <div className={cx('ui-tabs', className)} data-variant={variant}>
      <div className="ui-tabs-bar">
        <div role="tablist" aria-label={label} className="ui-tablist ui-scroll" onKeyDown={onKey}>
          {items.map((t) => (
            <button
              key={t.id}
              id={tabId(t.id)}
              type="button"
              role="tab"
              aria-selected={t.id === value}
              aria-controls={children !== undefined ? panelId : undefined}
              tabIndex={t.id === value ? 0 : -1}
              disabled={t.disabled}
              className="ui-tab"
              onClick={() => onChange(t.id)}
            >
              {renderIcon(t.icon, 'sm')}
              {t.label}
              {t.count !== undefined && <span className="ui-tab-count ui-num">{t.count}</span>}
            </button>
          ))}
        </div>
        {actions && <div className="ui-tabs-actions">{actions}</div>}
      </div>
      {children !== undefined && (
        <div role="tabpanel" id={panelId} aria-labelledby={tabId(value)} tabIndex={0} className="ui-tabpanel">
          {children}
        </div>
      )}
    </div>
  );
}

/* ── 위치 경로 — 계층을 모른다: 받은 [{kind, id, name}] 을 그대로 그린다 (ADR-0012) ── */
export type BreadcrumbProps = {
  path: ScopePath;
  kindLabel?: (kind: string) => string | undefined; // 층 이름 (툴팁 · 화면 읽기) — 앱 scope 모듈이 준다
  kindIcon?: (kind: string) => IconName | undefined;
  hrefOf?: (crumb: ScopeCrumb) => string | undefined; // 링크로 갈 때
  onNavigate?: (crumb: ScopeCrumb) => void; // 버튼으로 갈 때
  maxItems?: number; // 넘으면 가운데를 '…' 로 접는다 (첫 칸 + 마지막 maxItems-1 칸)
  label?: string;
  className?: string;
};

export function Breadcrumb({ path, kindLabel, kindIcon, hrefOf, onNavigate, maxItems = 4, label = UI_COPY.breadcrumb, className }: BreadcrumbProps) {
  const [expanded, setExpanded] = useState(false);
  const collapse = !expanded && path.length > maxItems && maxItems >= 2;
  const shown: Array<ScopeCrumb | 'more'> = collapse ? [path[0], 'more', ...path.slice(path.length - (maxItems - 1))] : [...path];
  return (
    <nav aria-label={label} className={cx('ui-breadcrumb', className)}>
      <ol>
        {shown.map((c, i) => {
          if (c === 'more') {
            return (
              <li key="more">
                <button type="button" className="ui-crumb" aria-label={UI_COPY.showMore} title={UI_COPY.showMore} onClick={() => setExpanded(true)}>…</button>
                <Icon name="chevron-right" size="xs" className="ui-crumb-sep" />
              </li>
            );
          }
          const last = i === shown.length - 1;
          const kind = kindLabel?.(c.kind);
          const icon = kindIcon?.(c.kind);
          const inner = (
            <>
              {icon && <Icon name={icon} size="sm" />}
              <span className="ui-ell">{c.name}</span>
              {kind && <span className="ui-sr">({kind})</span>}
            </>
          );
          const href = hrefOf?.(c);
          return (
            <li key={`${c.kind}:${c.id}`} data-kind={c.kind}>
              {last ? (
                <span className="ui-crumb" aria-current="page" title={kind ? `${kind}: ${c.name}` : c.name}>{inner}</span>
              ) : href ? (
                <a className="ui-crumb" href={href} title={kind ? `${kind}: ${c.name}` : c.name}>{inner}</a>
              ) : onNavigate ? (
                <button type="button" className="ui-crumb" title={kind ? `${kind}: ${c.name}` : c.name} onClick={() => onNavigate(c)}>{inner}</button>
              ) : (
                <span className="ui-crumb" title={kind ? `${kind}: ${c.name}` : c.name}>{inner}</span>
              )}
              {!last && <Icon name="chevron-right" size="xs" className="ui-crumb-sep" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ── 화면 머리 (h1 = 화면마다 하나) ────────────────────── */
export type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  icon?: IconLike;
  breadcrumb?: ReactNode; // <Breadcrumb … />
  meta?: ReactNode; // 제목 옆 꼬리표 (예: <Badge>준비 중</Badge>)
  actions?: ReactNode; // 오른쪽 버튼들
  titleRef?: Ref<HTMLHeadingElement>; // 화면이 바뀌면 제목에 포커스 (tabIndex -1)
  divider?: boolean; // 아래 구분선 (넓은 표 화면)
  className?: string;
};

export function PageHeader({ title, description, icon, breadcrumb, meta, actions, titleRef, divider, className }: PageHeaderProps) {
  return (
    <header className={cx('ui-page-head', className)} data-divider={flag(divider)}>
      {breadcrumb}
      <div className="ui-page-head-row">
        {icon && <span className="ui-tile">{renderIcon(icon)}</span>}
        <div className="ui-page-titles">
          <div className="ui-page-title-row">
            <h1 ref={titleRef} tabIndex={titleRef ? -1 : undefined} className="ui-page-title">{title}</h1>
            {meta}
          </div>
          {description && <p className="ui-page-desc">{description}</p>}
        </div>
        {actions && <div className="ui-page-actions">{actions}</div>}
      </div>
    </header>
  );
}

/* ── 도구 줄 (검색 · 거르개 · 묶음 동작) ───────────────── */
export function Toolbar({ children, label, sticky, className }: { children: ReactNode; label?: string; sticky?: boolean; className?: string }) {
  return (
    <div className={cx('ui-toolbar', className)} role={label ? 'group' : undefined} aria-label={label} data-sticky={flag(sticky)}>
      {children}
    </div>
  );
}

// 도구 줄에서 뒤쪽을 오른쪽 끝으로 미는 빈칸
export const ToolbarSpacer = () => <span className="ui-toolbar-spacer" aria-hidden="true" />;
