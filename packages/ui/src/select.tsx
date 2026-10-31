// 고르기 — 시스템 공통 목록 상자 (브라우저 기본 select 팝업 대신 · 관리자 콘솔 · 데스크톱이 같이 쓴다).
// 접근성 = ARIA 고르기 전용 combobox + listbox: 포커스는 늘 단추에 · 지금 가리키는 줄 = aria-activedescendant.
// 키보드: ↑↓ · Home · End · PageUp/Down · 글자 입력(그 글자로 시작하는 줄) · Enter/Space 고르기 · Esc 닫기 · Tab 닫고 다음으로.
// 목록은 최상위 층(popover)에 떠서 대화상자 · 스크롤 상자 안에서도 잘리지 않고, 아래 자리가 모자라면 위로 연다.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx, flag } from './cx';
import { Icon, renderIcon, type IconLike } from './icons';
import { useFieldControl } from './field';
import type { InputSize } from './inputs';

export type SelectOption = {
  value: string;
  label: string; // 단추 · 목록에 보이는 이름 (글자 입력으로 찾는 글)
  disabled?: boolean;
  icon?: IconLike; // 앞 아이콘 (제공사 등) — 단추에도 같이
  description?: ReactNode; // 목록 줄 오른쪽 옅은 글 (개수 · 설명). 단추에는 안 보인다
};

export type SelectProps = {
  options: readonly SelectOption[];
  value?: string; // 넘기면 바깥이 값을 쥔다 (onChange 와 함께)
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string; // 값이 없을 때 단추 글 (목록에는 없음)
  size?: InputSize;
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string; // 폼으로 보낼 때 (숨은 input)
  title?: string;
  className?: string;
  menuWidth?: number | string; // 목록 너비 (기본 = 단추 너비 이상 · 내용만큼)
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
};

const GAP = 4; // 단추와 목록 사이
const EDGE = 8; // 화면 끝 여백
const MAX_H = 320;
const PAGE = 8; // PageUp/Down 한 번에 옮기는 줄
const TYPE_MS = 600; // 글자 입력을 이어 붙이는 시간

const norm = (s: string) => s.normalize('NFC').toLocaleLowerCase('ko-KR');

// 고를 수 있는 다음 줄 (dir = +1 · -1 · count 줄만큼). 끝에서 멈춘다 (돌지 않음)
function step(options: readonly SelectOption[], from: number, dir: 1 | -1, count = 1): number {
  let found = from;
  for (let i = from + dir; i >= 0 && i < options.length && count > 0; i += dir) {
    if (options[i].disabled) continue;
    found = i;
    count--;
  }
  return found;
}
const firstEnabled = (options: readonly SelectOption[]) => options.findIndex((o) => !o.disabled);
const lastEnabled = (options: readonly SelectOption[]) => {
  for (let i = options.length - 1; i >= 0; i--) if (!options[i].disabled) return i;
  return -1;
};

// 단추 아래(자리가 모자라면 위)에 목록을 둔다 — 화면 좌표(fixed)라 조상의 스크롤 · 자르기와 상관없다
function place(btn: HTMLElement, list: HTMLElement, width: number | string | undefined) {
  const r = btn.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const s = list.style;
  s.minWidth = `${Math.round(r.width)}px`;
  s.maxWidth = `${vw - EDGE * 2}px`;
  if (width !== undefined) s.width = typeof width === 'number' ? `${width}px` : width;
  const below = vh - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  const want = Math.min(list.scrollHeight, MAX_H);
  const up = below < want && above > below;
  const room = Math.max(96, Math.min(MAX_H, up ? above : below));
  s.maxHeight = `${room}px`;
  const h = list.offsetHeight; // 테두리까지 (maxHeight 를 넣은 뒤 잰다)
  s.top = `${Math.round(up ? r.top - GAP - h : r.bottom + GAP)}px`;
  s.left = `${Math.round(Math.min(Math.max(EDGE, r.left), vw - EDGE - list.offsetWidth))}px`;
  list.dataset.side = up ? 'top' : 'bottom';
}

export function Select({
  options, value: valueProp, defaultValue = '', onChange, placeholder, size = 'md', invalid, disabled, required, id, name, title, className, menuWidth,
  'aria-label': ariaLabel, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy,
}: SelectProps) {
  const { invalid: bad, ...f } = useFieldControl({ id, required, disabled, 'aria-describedby': describedBy }, invalid);
  const [inner, setInner] = useState(defaultValue);
  const value = valueProp ?? inner;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [fieldLabel, setFieldLabel] = useState<string | undefined>(); // Field 이름 (<label for>) → 목록 이름
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const listId = useId();
  const optId = (i: number) => `${listId}-o${i}`;
  const selected = options.findIndex((o) => o.value === value);
  const current = selected >= 0 ? options[selected] : undefined;
  const off = !!f.disabled;

  const close = useCallback(() => setOpen(false), []);
  const openAt = (i: number) => {
    setActive(i);
    setFieldLabel(btn.current?.labels?.[0]?.textContent ?? undefined);
    setOpen(true);
  };
  const startIndex = () => (selected >= 0 && !options[selected].disabled ? selected : firstEnabled(options));
  const commit = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    if (o.value !== value) {
      if (valueProp === undefined) setInner(o.value);
      onChange?.(o.value);
    }
    close();
  };

  // 글자를 치면 그 글자로 시작하는 줄로 (이어 치면 이어 붙여 찾는다 · 같은 글자 반복 = 다음 줄)
  const typeAhead = (ch: string) => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at < TYPE_MS ? t.text + ch : ch;
    t.at = now;
    const q = norm(t.text);
    const same = [...q].every((c) => c === q[0]);
    const from = open ? active : selected;
    const order = options.map((_, i) => (from + 1 + i) % options.length);
    const hit = (query: string, startSelf: boolean) => (startSelf && from >= 0 ? [from, ...order] : order)
      .find((i) => !options[i].disabled && norm(options[i].label).startsWith(query));
    const i = hit(q, q.length > 1) ?? (same ? hit(q[0], false) : undefined);
    if (i === undefined) return;
    if (open) setActive(i);
    else openAt(i);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (off) return;
    const k = e.key;
    if (k === 'Tab') {
      if (open) close();
      return;
    }
    if (k === 'Escape') {
      if (!open) return;
      e.preventDefault(); // 대화상자 안이면 대화상자는 닫지 않는다
      e.stopPropagation();
      close();
      return;
    }
    const typing = Date.now() - typed.current.at < TYPE_MS && typed.current.text !== '';
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !(k === ' ' && !typing)) {
      e.preventDefault();
      typeAhead(k);
      return;
    }
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') openAt(startIndex());
      else if (k === 'Home') openAt(firstEnabled(options));
      else if (k === 'End') openAt(lastEnabled(options));
      else return;
      e.preventDefault();
      return;
    }
    const at = active < 0 ? startIndex() : active;
    const to =
      k === 'ArrowDown' ? step(options, at, 1)
      : k === 'ArrowUp' ? step(options, at, -1)
      : k === 'PageDown' ? step(options, at, 1, PAGE)
      : k === 'PageUp' ? step(options, at, -1, PAGE)
      : k === 'Home' ? firstEnabled(options)
      : k === 'End' ? lastEnabled(options)
      : undefined;
    if (to !== undefined) {
      e.preventDefault();
      setActive(to);
      return;
    }
    if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      commit(at);
    }
  };

  // 열리면 최상위 층에 올리고 자리를 잡는다 · 가리키는 줄이 보이게
  useLayoutEffect(() => {
    const el = list.current;
    if (!open || !el || !btn.current) return;
    if (typeof el.showPopover === 'function' && !el.matches(':popover-open')) el.showPopover();
    place(btn.current, el, menuWidth);
  }, [open, menuWidth, options.length]);
  useLayoutEffect(() => {
    if (open && active >= 0) document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' });
  });

  // 바깥을 누르면 닫는다 · 창이 움직이면 따라간다 (목록 안 스크롤은 그대로)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !list.current?.contains(t)) close();
    };
    const follow = (e: Event) => {
      if (list.current && btn.current && !(e.target instanceof Node && list.current.contains(e.target))) place(btn.current, list.current, menuWidth);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [open, close, menuWidth]);

  // 꺼지면 닫는다
  useEffect(() => {
    if (off && open) close();
  }, [off, open, close]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        role="combobox"
        id={f.id}
        className={cx('ui-select', className)}
        data-size={size}
        data-invalid={flag(bad)}
        data-disabled={flag(off)}
        data-value={value}
        title={title}
        disabled={off}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={f['aria-describedby']}
        aria-invalid={f['aria-invalid']}
        aria-required={f.required || undefined}
        onClick={() => (open ? close() : openAt(startIndex()))}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => e.key === ' ' && e.preventDefault()} // Space 는 keydown 에서 처리했다 (단추 click 이 한 번 더 돌지 않게)
        onBlur={(e) => {
          if (open && !list.current?.contains(e.relatedTarget as Node | null)) close();
        }}
      >
        <span className="ui-select-value">
          <span className="ui-select-shown" data-placeholder={flag(!current)}>
            {current ? renderIcon(current.icon, 'sm') : null}
            <span className="ui-select-text">{current?.label ?? placeholder ?? ''}</span>
          </span>
          {/* 가장 긴 이름만큼 너비를 잡는다 (브라우저 select 처럼 · 고를 때마다 폭이 흔들리지 않게) */}
          <span className="ui-select-sizer" aria-hidden="true">
            {options.map((o) => <span key={o.value}>{renderIcon(o.icon, 'sm')}{o.label}</span>)}
            {placeholder && <span>{placeholder}</span>}
          </span>
        </span>
        <Icon name="chevron-down" size="sm" className="ui-select-chev" />
      </button>
      {name !== undefined && <input type="hidden" name={name} value={value} />}
      {open && (
        <div
          ref={list}
          id={listId}
          role="listbox"
          popover="manual"
          aria-label={ariaLabel ?? (labelledBy ? undefined : fieldLabel)}
          aria-labelledby={ariaLabel ? undefined : labelledBy}
          tabIndex={-1}
          className="ui-select-list ui-glass ui-scroll"
          data-size={size}
          onMouseDown={(e) => e.preventDefault()} // 포커스는 단추에 남긴다 (줄 · 스크롤 막대를 눌러도)
        >
          {options.map((o, i) => (
            <div
              key={o.value}
              id={optId(i)}
              role="option"
              data-value={o.value}
              aria-selected={i === selected}
              aria-disabled={o.disabled || undefined}
              data-active={flag(i === active)}
              className="ui-select-opt"
              onPointerMove={() => !o.disabled && i !== active && setActive(i)}
              onClick={() => commit(i)}
            >
              {renderIcon(o.icon, 'sm')}
              <span className="ui-select-opt-label">{o.label}</span>
              {o.description !== undefined && <>{' '}<span className="ui-select-opt-desc">{o.description}</span></>}
              <span className="ui-select-opt-check">{i === selected && <Icon name="check" size="sm" />}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
