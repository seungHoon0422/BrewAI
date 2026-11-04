// 떠 있는 층 — 팝오버 · 메뉴 · 대화상자 · 서랍 · 툴팁.
// 표면 규칙 (ADR-0012): 팝오버 · 메뉴 = 유리(일시적 · 내용 위) · 대화상자 · 서랍 = 불투명 면 + 큰 그림자(오래 읽는 글) · 툴팁 = 잉크 바탕.
import {
  cloneElement, useCallback, useEffect, useId, useRef, useState,
  type KeyboardEvent, type ReactElement, type ReactNode, type RefObject,
} from 'react';
import { cx, flag } from './cx';
import { UI_COPY } from './copy';
import { Icon, renderIcon, type IconLike } from './icons';
import { IconButton } from './button';

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
export type Surface = 'glass' | 'solid';

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/* ── 팝오버 ──────────────────────────────────────────── */
// 열기 단추에 붙일 것 — trigger 함수가 받아 자기 버튼에 펼쳐 넣는다
export type TriggerProps = {
  ref: RefObject<HTMLButtonElement | null>;
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  'aria-haspopup': 'dialog' | 'menu' | 'listbox';
  onClick: () => void;
};

export type PopoverProps = {
  trigger: (props: TriggerProps) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  open?: boolean; // 넘기면 바깥이 열림을 쥔다 (onOpenChange 와 함께)
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: Placement;
  surface?: Surface;
  role?: 'dialog' | 'menu' | 'listbox';
  label?: string; // 층 이름 (aria-label)
  width?: number | string;
  className?: string;
};

export function Popover({
  trigger, children, open: openProp, defaultOpen = false, onOpenChange, placement = 'bottom-start', surface = 'glass', role = 'dialog', label, width, className,
}: PopoverProps) {
  const [inner, setInner] = useState(defaultOpen);
  const open = openProp ?? inner;
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const setOpen = useCallback((next: boolean) => {
    if (openProp === undefined) setInner(next);
    onOpenChange?.(next);
  }, [openProp, onOpenChange]);
  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  }, [setOpen]);

  // 바깥을 누르면 닫는다 (포커스는 누른 곳으로)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, close]);

  // 열리면 안의 첫 칸(또는 data-autofocus)으로 — 처음부터 열려 있던 것(defaultOpen)은 포커스를 뺏지 않는다
  const wasOpen = useRef(open);
  useEffect(() => {
    const opened = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opened || !panel.current) return;
    const first = panel.current.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current).focus();
  }, [open]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };

  return (
    <span className="ui-popover-anchor" ref={wrap}>
      {trigger({ ref: btn, 'aria-expanded': open, 'aria-controls': open ? id : undefined, 'aria-haspopup': role, onClick: () => setOpen(!open) })}
      {open && (
        <div
          ref={panel}
          id={id}
          role={role}
          aria-label={label}
          tabIndex={-1}
          className={cx('ui-popover', surface === 'glass' && 'ui-glass', className)}
          data-placement={placement}
          data-surface={surface}
          style={width !== undefined ? { width } : undefined}
          onKeyDown={onKey}
        >
          {typeof children === 'function' ? children(() => close()) : children}
        </div>
      )}
    </span>
  );
}

/* ── 메뉴 (동작 목록 · 하나 고르기) ──────────────────── */
export type MenuEntry =
  | { kind?: 'item'; id: string; label: ReactNode; icon?: IconLike; hint?: ReactNode; checked?: boolean; danger?: boolean; disabled?: boolean }
  | { kind: 'separator' }
  | { kind: 'heading'; label: ReactNode };

export type MenuProps = Omit<PopoverProps, 'children' | 'role'> & {
  items: readonly MenuEntry[];
  onSelect: (id: string) => void;
  label: string;
};

export function Menu({ items, onSelect, ...pop }: MenuProps) {
  // 위아래 화살표 · Home · End 로 칸 사이를 옮긴다 (Tab = 닫고 다음으로)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not([disabled])')];
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[e.key];
    if (to === undefined || list.length === 0) return;
    e.preventDefault();
    list[(to + list.length) % list.length].focus();
  };
  const checkable = items.some((i) => (i.kind ?? 'item') === 'item' && 'checked' in i && i.checked !== undefined);
  return (
    <Popover {...pop} role="menu">
      {(close) => (
        <div className="ui-menu" onKeyDown={onKey} data-checkable={flag(checkable)}>
          {items.map((it, n) => {
            if (it.kind === 'separator') return <div key={n} className="ui-menu-sep" role="separator" />;
            if (it.kind === 'heading') return <div key={n} className="ui-menu-heading" role="presentation">{it.label}</div>;
            return (
              <button
                key={it.id}
                type="button"
                role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={it.checked}
                disabled={it.disabled}
                data-danger={flag(it.danger)}
                className="ui-menu-item"
                onClick={() => {
                  onSelect(it.id);
                  close();
                }}
              >
                {checkable && <span className="ui-menu-check">{it.checked && <Icon name="check" size="sm" />}</span>}
                {renderIcon(it.icon, 'sm')}
                <span className="ui-menu-label">{it.label}</span>
                {it.hint && <span className="ui-menu-hint">{it.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

/* ── 대화상자 · 서랍 (브라우저 <dialog> — 포커스 가두기 · Esc · 최상위 층이 그대로) ── */
type ModalBase = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode; // 아래 버튼 줄 (오른쪽 정렬)
  dismissible?: boolean; // false = Esc · 바깥 눌러도 안 닫힘 (저장 중 등)
  closeLabel?: string;
  className?: string;
};

function Modal({ kind, open, onClose, title, description, children, footer, dismissible = true, closeLabel = UI_COPY.close, className, size, side }: ModalBase & {
  kind: 'dialog' | 'sheet';
  size?: 'sm' | 'md' | 'lg';
  side?: 'right' | 'left';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={cx(kind === 'dialog' ? 'ui-dialog' : 'ui-sheet', className)}
      data-size={size}
      data-side={side}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault(); // Esc — 닫을지는 open prop 이 정한다
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        // <dialog> 자신 = 바깥 어두운 곳 (안쪽은 .ui-modal-in 이 다 덮는다)
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
    >
      {open && (
        <div className="ui-modal-in">
          <header className="ui-modal-head">
            <div className="ui-modal-titles">
              <h2 id={titleId} className="ui-modal-title">{title}</h2>
              {description && <p id={descId} className="ui-modal-desc">{description}</p>}
            </div>
            {dismissible && <IconButton icon="close" label={closeLabel} onClick={onClose} className="ui-modal-x" />}
          </header>
          <div className="ui-modal-body ui-scroll">{children}</div>
          {footer && <footer className="ui-modal-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export type DialogProps = ModalBase & { size?: 'sm' | 'md' | 'lg' };
export const Dialog = ({ size = 'md', ...rest }: DialogProps) => <Modal kind="dialog" size={size} {...rest} />;

// 서랍 = 오른쪽(기본) · 왼쪽에서 나오는 긴 면. 좁은 창(<760px)에선 아래에서 올라오는 시트
export type SheetProps = ModalBase & { side?: 'right' | 'left' };
export const Sheet = ({ side = 'right', ...rest }: SheetProps) => <Modal kind="sheet" side={side} {...rest} />;

/* ── 툴팁 (마우스 · 키보드 포커스 · Esc 로 닫힘) ───────── */
// instant = 기다리지 않고 바로 (아이콘만 있는 메뉴 레일처럼 이름이 바로 필요한 곳)
export function Tooltip({ content, children, side = 'top', instant = false, align = 'center' }: {
  content: ReactNode;
  children: ReactElement<{ 'aria-describedby'?: string }>;
  side?: 'top' | 'bottom' | 'right';
  instant?: boolean;
  align?: 'center' | 'start'; // start = 풍선 왼쪽 끝을 단추 왼쪽에 (카드 제목 옆 i 처럼 왼쪽에 여유가 없을 때)
}) {
  const id = useId();
  const [hidden, setHidden] = useState(false);
  return (
    <span
      className="ui-tip"
      data-side={side}
      data-instant={flag(instant)}
      data-align={align === 'start' ? 'start' : undefined}
      data-hidden={flag(hidden)}
      onKeyDown={(e) => e.key === 'Escape' && setHidden(true)}
      onMouseLeave={() => setHidden(false)}
      onBlur={() => setHidden(false)}
    >
      {cloneElement(children, { 'aria-describedby': cx(children.props['aria-describedby'], id) })}
      <span role="tooltip" id={id} className="ui-tip-body">{content}</span>
    </span>
  );
}

/* ── 설명 아이콘 (i) — 카드 제목 옆 · 설명 글은 마우스 · 키보드 포커스로만 (화면 글을 줄인다) ── */
export function InfoTip({ text, label = UI_COPY.info }: { text: ReactNode; label?: string }) {
  return (
    <Tooltip content={text} side="bottom" instant align="start">
      <button type="button" className="ui-info" aria-label={label}><Icon name="info" size="xs" /></button>
    </Tooltip>
  );
}
