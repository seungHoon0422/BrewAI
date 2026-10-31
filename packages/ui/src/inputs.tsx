// 입력 부품 — 글 입력 · 비밀번호 · 여러 줄 · 체크 · 스위치 · 나눈 버튼(segmented). 고르기(목록 상자) = select.tsx
// 모두 Field 안에 두면 이름 · 힌트 · 오류가 자동으로 이어진다 (useFieldControl).
import { useState, type ComponentPropsWithRef, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { cx, flag } from './cx';
import { UI_COPY } from './copy';
import { Icon, renderIcon, type IconLike } from './icons';
import { useFieldControl } from './field';

export type InputSize = 'sm' | 'md' | 'lg';

// ref 를 둘에 나눠 준다 (부품이 쓰는 것 + 부르는 쪽이 넘긴 것)
function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

/* ── 글 입력 ─────────────────────────────────────────── */
export type InputProps = Omit<ComponentPropsWithRef<'input'>, 'size'> & {
  size?: InputSize;
  icon?: IconLike; // 앞 아이콘 (검색 등)
  end?: ReactNode; // 뒤에 붙는 것 (단위 · 버튼)
  invalid?: boolean;
};

export function Input({ size = 'md', icon, end, invalid, className, id, required, disabled, 'aria-describedby': describedBy, ...rest }: InputProps) {
  const { invalid: bad, ...f } = useFieldControl({ id, required, disabled, 'aria-describedby': describedBy }, invalid);
  return (
    <span className={cx('ui-input', className)} data-size={size} data-invalid={flag(bad)} data-disabled={flag(f.disabled)}>
      {renderIcon(icon, 'sm')}
      <input {...rest} {...f} />
      {end}
    </span>
  );
}

/* ── 비밀번호 ────────────────────────────────────────── */
export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

// 길이 중심 강도 (ADR-0010: 조합 규칙 없음 · 최소 길이는 서버 값 password_min 을 넘긴다)
// 0 = 비어 있음 · 1 = 최소보다 짧음 · 2 = 최소 이상 · 3 = 최소 + 5자 이상 · 4 = 최소 + 13자 이상, 또는 + 5자 이상에 글자 종류 3가지 이상
export function passwordStrength(value: string, min = 15): StrengthLevel {
  if (!value) return 0;
  const len = [...value].length;
  if (len < min) return 1;
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) => r.test(value)).length;
  if (len >= min + 13 || (len >= min + 5 && kinds >= 3)) return 4;
  if (len >= min + 5) return 3;
  return 2;
}

export type PasswordInputProps = Omit<InputProps, 'type' | 'end'> & {
  strength?: StrengthLevel; // 넘기면 아래에 강도 막대 (passwordStrength 로 계산해서)
  strengthText?: string; // 막대 옆 글 (기본 = UI_COPY.strengthLevels)
  showLabel?: string;
  hideLabel?: string;
};

export function PasswordInput({ strength, strengthText, showLabel = UI_COPY.showPassword, hideLabel = UI_COPY.hidePassword, size = 'md', ...rest }: PasswordInputProps) {
  const [shown, setShown] = useState(false);
  const toggle = (
    <button
      type="button"
      className="ui-input-btn"
      aria-label={shown ? hideLabel : showLabel}
      title={shown ? hideLabel : showLabel}
      aria-pressed={shown}
      onClick={() => setShown((s) => !s)}
      disabled={rest.disabled}
    >
      <Icon name={shown ? 'eye-off' : 'eye'} size="sm" />
    </button>
  );
  return (
    <span className="ui-password">
      <Input {...rest} size={size} type={shown ? 'text' : 'password'} end={toggle} />
      {strength !== undefined && (
        <span className="ui-strength" data-level={strength}>
          <span className="ui-strength-bar" role="meter" aria-label={UI_COPY.strength} aria-valuemin={0} aria-valuemax={4} aria-valuenow={strength}
            aria-valuetext={strengthText ?? UI_COPY.strengthLevels[strength]}>
            <i /><i /><i /><i />
          </span>
          <span className="ui-strength-text" aria-live="polite">{strengthText ?? UI_COPY.strengthLevels[strength]}</span>
        </span>
      )}
    </span>
  );
}

/* ── 여러 줄 ─────────────────────────────────────────── */
export type TextareaProps = ComponentPropsWithRef<'textarea'> & { invalid?: boolean; autoGrow?: boolean };

export function Textarea({ invalid, autoGrow = true, className, id, required, disabled, 'aria-describedby': describedBy, ...rest }: TextareaProps) {
  const { invalid: bad, ...f } = useFieldControl({ id, required, disabled, 'aria-describedby': describedBy }, invalid);
  return <textarea className={cx('ui-textarea', className)} data-invalid={flag(bad)} data-autogrow={flag(autoGrow)} {...rest} {...f} />;
}

/* ── 체크 ────────────────────────────────────────────── */
export type CheckboxProps = Omit<ComponentPropsWithRef<'input'>, 'type' | 'size'> & {
  label?: ReactNode; // 보이는 이름 (없으면 aria-label 을 넘긴다)
  description?: ReactNode;
  indeterminate?: boolean; // 일부만 고름 (표 머리 '모두 선택')
};

export function Checkbox({ label, description, indeterminate, className, ref, ...rest }: CheckboxProps) {
  const box = (
    <span className="ui-check-box">
      <input
        type="checkbox"
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate;
          assignRef(ref, el);
        }}
        {...rest}
      />
      <Icon name="check" size="xs" className="ui-check-on" />
      <Icon name="minus" size="xs" className="ui-check-mixed" />
    </span>
  );
  if (!label) return <span className={cx('ui-check', className)}>{box}</span>;
  return (
    <label className={cx('ui-check', className)} data-disabled={flag(rest.disabled)}>
      {box}
      <span className="ui-check-text">
        <span>{label}</span>
        {description && <span className="ui-check-desc">{description}</span>}
      </span>
    </label>
  );
}

// 하나만 고르는 동그라미 (같은 name 끼리). 체크 상자와 같은 결: 테두리 → 잉크 고리. 보이는 이름이 없으면 aria-label
export type RadioProps = Omit<ComponentPropsWithRef<'input'>, 'type' | 'size'>;
export function Radio({ className, ...rest }: RadioProps) {
  return <input type="radio" className={cx('ui-radio', className)} {...rest} />;
}

/* ── 스위치 (켬 = 잉크색. 초록은 상태 색이라 쓰지 않는다) ── */
export type SwitchProps = Omit<ComponentPropsWithRef<'button'>, 'onChange' | 'children'> & {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: ReactNode; // 보이는 이름 (없으면 aria-label 을 넘긴다)
  size?: 'sm' | 'md';
};

export function Switch({ checked, onCheckedChange, label, size = 'md', className, onClick, ...rest }: SwitchProps) {
  const sw = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cx('ui-switch', label ? undefined : className)}
      data-size={size}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onCheckedChange?.(!checked);
      }}
      {...rest}
    >
      <span className="ui-switch-knob" />
    </button>
  );
  if (!label) return sw;
  return (
    <label className={cx('ui-switch-row', className)} data-disabled={flag(rest.disabled)}>
      {sw}
      <span>{label}</span>
    </label>
  );
}

/* ── 나눈 버튼 (radiogroup · 미끄러지는 손잡이) ──────── */
export type SegmentedOption<T extends string> = { value: T; label: ReactNode; icon?: IconLike; disabled?: boolean };
export type SegmentedProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string; // 그룹 이름 (aria-label)
  size?: 'sm' | 'md';
  block?: boolean; // 줄 너비 가득 (칸 너비 같게)
  disabled?: boolean;
  className?: string;
};

export function Segmented<T extends string>({ options, value, onChange, label, size = 'md', block, disabled, className }: SegmentedProps<T>) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step || disabled) return;
    e.preventDefault();
    for (let n = 1; n <= options.length; n++) {
      const next = options[(index + step * n + options.length * n) % options.length];
      if (!next.disabled) {
        onChange(next.value);
        const btn = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[options.indexOf(next)];
        btn?.focus();
        return;
      }
    }
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cx('ui-segmented', className)}
      data-size={size}
      data-block={flag(block)}
      style={{ '--seg-i': index, '--seg-n': options.length } as CSSProperties}
      onKeyDown={move}
    >
      <span className="ui-segmented-thumb" aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.value)}
        >
          {renderIcon(o.icon, 'sm')}
          {o.label}
        </button>
      ))}
    </div>
  );
}
