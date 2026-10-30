// 입력 한 칸의 틀 = 이름(label) · 입력 · 힌트 · 오류. 안의 입력 부품은 문맥에서 id · aria-describedby · aria-invalid 를 받는다
import { createContext, useContext, useId, type ReactNode } from 'react';
import { cx, flag } from './cx';
import { UI_COPY } from './copy';
import { Icon } from './icons';

type FieldContext = { id: string; describedBy?: string; invalid: boolean; required: boolean; disabled: boolean };
const Ctx = createContext<FieldContext | null>(null);

export type FieldProps = {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode; // 늘 보이는 도움말 (입력 아래)
  error?: ReactNode; // 있으면 오류 상태 + 입력 아래 빨간 줄 (힌트보다 먼저 읽힌다)
  required?: boolean;
  disabled?: boolean;
  id?: string; // 입력의 id (없으면 만든다)
  aside?: ReactNode; // 이름 줄 오른쪽 (예: '비밀번호를 잊었어요' 링크)
  className?: string;
};

export function Field({ label, children, hint, error, required = false, disabled = false, id, aside, className }: FieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined;
  const errorId = error ? `${fid}-error` : undefined;
  const describedBy = cx(errorId, hintId) || undefined;
  return (
    <div className={cx('ui-field', className)} data-invalid={flag(!!error)} data-disabled={flag(disabled)}>
      <div className="ui-field-head">
        <label className="ui-field-label" htmlFor={fid}>
          {label}
          {required && <span className="ui-field-req" aria-hidden="true">*</span>}
          {required && <span className="ui-sr">({UI_COPY.required})</span>}
        </label>
        {aside}
      </div>
      <Ctx.Provider value={{ id: fid, describedBy, invalid: !!error, required, disabled }}>{children}</Ctx.Provider>
      {error && (
        <p className="ui-field-error" id={errorId}>
          <Icon name="alert" size="xs" />
          {error}
        </p>
      )}
      {hint && <p className="ui-field-hint" id={hintId}>{hint}</p>}
    </div>
  );
}

// 입력 부품용: 자기 prop 이 먼저, 없으면 Field 문맥 값
export function useFieldControl(own: { id?: string; 'aria-describedby'?: string; required?: boolean; disabled?: boolean }, invalid?: boolean) {
  const f = useContext(Ctx);
  const isInvalid = invalid ?? f?.invalid ?? false;
  return {
    id: own.id ?? f?.id,
    'aria-describedby': cx(own['aria-describedby'], f?.describedBy) || undefined,
    'aria-invalid': isInvalid || undefined,
    required: own.required ?? f?.required,
    disabled: own.disabled ?? f?.disabled,
    invalid: isInvalid,
  };
}
