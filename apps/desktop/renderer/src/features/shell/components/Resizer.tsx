// 세로 경계 손잡이 (오른쪽 패널 · 파일 뷰어의 왼쪽 끝) — 끌기 · 키보드 ← → (16px · Shift = 64px) · Home/End = 최소/최대.
// 왼쪽으로 끌수록 넓어진다 (오른쪽에 붙은 칸). role=separator + aria-valuenow (화면 읽기 · E2E). 끝나면 onCommit (기억).
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

export function Resizer({ label, value, min, max, onChange, onCommit }: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
}) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const last = useRef(value);
  last.current = value;
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)));

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: value };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onChange(clamp(drag.current.w + (drag.current.x - e.clientX)));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit?.(last.current);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const next = { ArrowLeft: value + step, ArrowRight: value - step, Home: min, End: max }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const v = clamp(next);
    onChange(v);
    onCommit?.(v);
  };

  return (
    <div className="resizer" role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max}
      tabIndex={0} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key} />
  );
}
