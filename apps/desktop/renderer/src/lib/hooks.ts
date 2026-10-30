// 화면 공통 훅 — 시계 · 미디어 쿼리 · 늦춰 알리기 · 움직임 줄이기. 데이터와 무관하다.
import { useEffect, useRef, useState } from 'react';

// 살아 있는 동안만 시계를 돌린다 (200ms) — 끝나면 멈춘다
export function useNow(active: boolean, every = 200): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

export function useMedia(query: string): boolean {
  const get = () => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return true;
    }
  };
  const [on, setOn] = useState(get);
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia(query);
    } catch {
      return;
    }
    const f = () => setOn(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [query]);
  return on;
}

// 화면 읽기 프로그램에는 바뀐 글을 ms 에 한 번까지만 (매 단계마다 끊어 읽지 않게). flush = 기다리지 않고 바로 (끝 · 멈춤)
export function useThrottled<T>(value: T, ms: number, flush = false): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const wait = flush ? 0 : Math.max(0, last.current + ms - Date.now());
    const t = setTimeout(() => {
      last.current = Date.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(t);
  }, [value, ms, flush]);
  return shown;
}

export const reduceMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};
