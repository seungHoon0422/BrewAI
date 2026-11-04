// 파일 뷰어 상태 (대화 | 뷰어 | 오른쪽 패널 · 2026-11-04 사용자) — 어느 파일을 어느 대화에서 열었나 · 폭.
// 답의 칩 · 내 말풍선 칩 · 오른쪽 패널 '파일' 줄이 openViewer 를 부른다 (대화 화면은 이 store 만 본다 = 칩이 대화 화면을 몰라도 된다).
// 폭은 이 기기에 기억 (localStorage · 막혀 있어도 화면은 돈다).
import { createStore } from '../../lib/store';
import type { FileKind } from './api';

export type ViewFile = { id: string; name: string; kind: FileKind; size: number };
type State = { file: ViewFile | null; thread: string | null; active: string | null };

const store = createStore<State>({ file: null, thread: null, active: null });

// 대화 화면이 지금 연 대화를 알려 준다 (뷰어는 그 대화에서만 보인다 · 다른 대화로 가면 닫힘)
export function setActiveThread(id: string | null) {
  store.set((s) => (s.active === id ? s : { ...s, active: id }));
}
export function openViewer(file: ViewFile) {
  store.set((s) => ({ ...s, file, thread: s.active }));
}
export const closeViewer = () => store.set((s) => (s.file ? { ...s, file: null } : s));
export const useViewer = (thread: string | null) => store.use((s) => (s.file && s.thread === thread ? s.file : null));

// ── 폭 (px) ── 오른쪽 패널 · 뷰어 따로
export function readWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v >= min && v <= max ? v : fallback;
  } catch {
    return fallback;
  }
}
export function saveWidth(key: string, v: number) {
  try {
    localStorage.setItem(key, String(Math.round(v)));
  } catch {}
}
