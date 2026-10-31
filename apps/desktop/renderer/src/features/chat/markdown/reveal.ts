// 흐르는 글을 일정한 속도로 펼친다 (조각이 툭툭 던져지지 않게). 받은 글보다 늘 조금 뒤에서 따라간다.
// 속도 = 밀린 글자 수에 비례 (많이 밀리면 빨리 따라잡는다) · 아주 적게 밀리면 최소 속도.
// 답이 끝나거나(live=false) 사용자가 스크롤 · 복사 · 선택하면 바로 끝까지. 움직임 줄이기 = 펼치지 않고 받은 대로.
import { useCallback, useEffect, useRef, useState } from 'react';

const LAG_MS = 220; // 밀린 글을 이만큼 안에 따라잡는 속도 (지수 접근)
const MIN_CPS = 45; // 밀린 게 조금이어도 이 속도 (초당 글자)
// 이 창에서 이미 펼친 길이 (글 조각 id → 글자 수). 흐르는 중 대화를 오가며 다시 그려도 본 데부터 이어 펼친다.
// 처음 보는 조각은 0 부터 (첫 조각이 길게 와도 툭 던지지 않는다). 끝난 답(smooth 아님)은 받은 대로.
// 앞 글(head)이 같을 때만 잇는다 (id 가 겹치는 다른 답이면 0 부터)
const SEEN = new Map<string, { at: number; head: string }>();
const HEAD = 64;
function seenAt(id: string | undefined, text: string): number {
  const s = id ? SEEN.get(id) : undefined;
  return s && text.startsWith(s.head) ? Math.min(text.length, s.at) : 0;
}

// 한 프레임 뒤 보이는 글자 수 (소수 · 순수 함수)
export function revealStep(shown: number, target: number, dtMs: number): number {
  if (shown >= target) return target;
  const dt = Math.max(0, Math.min(dtMs, 1000));
  const step = Math.max(((target - shown) * dt) / LAG_MS, (MIN_CPS * dt) / 1000);
  return Math.min(target, shown + step);
}

// 서로게이트 쌍(이모지)을 가르지 않는 자리
export function cutAt(s: string, n: number): number {
  let k = Math.max(0, Math.min(s.length, Math.floor(n)));
  if (k > 0 && k < s.length && /[\uDC00-\uDFFF]/.test(s[k])) k++;
  return k;
}

export function useReveal(text: string, smooth: boolean, id?: string): { shown: string; flush: () => void } {
  const pos = useRef(smooth ? seenAt(id, text) : text.length);
  const target = useRef(text);
  target.current = text;
  const [, setTick] = useState(0);
  const keep = useCallback(() => {
    if (id) SEEN.set(id, { at: pos.current, head: target.current.slice(0, HEAD) });
  }, [id]);

  useEffect(() => {
    if (!smooth) {
      pos.current = text.length;
      if (id) SEEN.delete(id);
      return;
    }
    if (pos.current > text.length) pos.current = text.length; // 글이 줄면 (다시 시도)
    if (pos.current >= text.length) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const before = Math.floor(pos.current);
      const goal = target.current.length;
      pos.current = revealStep(pos.current, goal, now - last);
      last = now;
      keep();
      if (Math.floor(pos.current) !== before) setTick((x) => x + 1);
      if (pos.current < goal) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, smooth, id, keep]);

  const flush = useCallback(() => {
    if (pos.current >= target.current.length) return;
    pos.current = target.current.length;
    keep();
    setTick((x) => x + 1);
  }, [keep]);
  return { shown: smooth ? text.slice(0, cutAt(text, pos.current)) : text, flush };
}
