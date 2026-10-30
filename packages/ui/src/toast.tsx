// 알림 — 잠깐 떴다 사라지는 유리 카드 (오른쪽 아래). 상태는 앞의 점 하나로만 (색 띠 · 색 바탕 없음)
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';
import { UI_COPY } from './copy';
import { IconButton } from './button';
import { StatusDot, type Tone } from './display';

export type ToastItem = {
  id: string;
  tone?: Tone;
  title: ReactNode;
  body?: ReactNode;
  action?: { label: string; onClick: () => void };
};

const DOT = { neutral: 'idle', info: 'wait', ok: 'ok', warn: 'warn', danger: 'fail', accent: 'idle' } as const;

export function Toast({ tone = 'neutral', title, body, action, onDismiss, className }: Omit<ToastItem, 'id'> & { onDismiss?: () => void; className?: string }) {
  return (
    <div className={cx('ui-toast ui-glass', className)} data-tone={tone} role={tone === 'danger' ? 'alert' : undefined}>
      <StatusDot state={DOT[tone]} />
      <div className="ui-toast-main">
        <p className="ui-toast-title">{title}</p>
        {body && <p className="ui-toast-body">{body}</p>}
      </div>
      {action && (
        <button type="button" className="ui-toast-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {onDismiss && <IconButton icon="close" label={UI_COPY.dismiss} size="sm" onClick={onDismiss} />}
    </div>
  );
}

// 알림이 쌓이는 자리 (화면에 하나). 바뀌면 화면 읽기 프로그램이 읽는다 (polite)
export function ToastRegion({ toasts, onDismiss, label = UI_COPY.notifications }: {
  toasts: readonly ToastItem[];
  onDismiss: (id: string) => void;
  label?: string;
}) {
  return (
    <section className="ui-toast-region" aria-label={label} aria-live="polite">
      {toasts.map((t) => <Toast key={t.id} {...t} onDismiss={() => onDismiss(t.id)} />)}
    </section>
  );
}

// 알림 줄 상태 (화면 상태일 뿐 — 데이터 요청 없음). timeout 뒤 저절로 사라진다 (0 = 안 사라짐)
export function useToastQueue(timeout = 5000) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setToasts((list) => [...list.slice(-3), { ...t, id }]); // 넷까지
    if (timeout > 0) timers.current.set(id, setTimeout(() => dismiss(id), timeout));
    return id;
  }, [timeout, dismiss]);
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach(clearTimeout);
  }, []);
  return { toasts, push, dismiss };
}
