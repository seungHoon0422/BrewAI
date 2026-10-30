// 생각 깊이 = 세 칸 나눈 버튼 (radiogroup). 모델이 못 받으면 '끄기' 에 고정 — 칸은 aria-disabled (포커스 · 읽기는 그대로).
// 모양은 @brewai/ui Segmented 와 같은 클래스(ui-segmented). 부품의 Segmented 는 칸을 disabled 로 잠가 포커스가 빠지므로
// 여기선 같은 모양에 aria-disabled 동작만 따로 둔다 (e2e: 잠긴 칸도 aria-disabled="true").
import { useId, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import type { Reasoning } from '../../../lib/api';
import { PICKER, REASONING } from '../copy';
import { pickReasoning } from '../hooks';

export function ReasoningDepth({ canThink, pref, hasModel }: { canThink: boolean; pref: Reasoning; hasModel: boolean }) {
  const id = useId();
  const value = canThink ? pref : 'off';
  const i = Math.max(0, REASONING.findIndex((r) => r.id === value));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    if (!canThink) return;
    const next = REASONING[(i + dir + REASONING.length) % REASONING.length];
    pickReasoning(next.id);
    refs.current[REASONING.indexOf(next)]?.focus();
  };
  return (
    <div className="mdepth">
      <h6 id={id} className="mh">{PICKER.depth}</h6>
      <div className="ui-segmented" role="radiogroup" aria-labelledby={id} aria-disabled={!canThink || undefined} onKeyDown={onKey}
        data-size="sm" data-block="" title={canThink ? undefined : PICKER.depthLocked}
        style={{ '--seg-i': i, '--seg-n': REASONING.length } as CSSProperties}>
        <span className="ui-segmented-thumb" aria-hidden="true" />
        {REASONING.map((r, n) => (
          <button key={r.id} ref={(el) => { refs.current[n] = el; }} type="button" role="radio" aria-checked={r.id === value}
            aria-disabled={!canThink || undefined} tabIndex={r.id === value ? 0 : -1} data-group="reasoning"
            onClick={() => canThink && pickReasoning(r.id)}>
            {r.label}
          </button>
        ))}
      </div>
      <p className="msub">{REASONING[i].sub}</p>
      {hasModel && !canThink && <p className="mnote">{PICKER.depthLocked}</p>}
    </div>
  );
}
