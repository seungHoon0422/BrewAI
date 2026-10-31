// 모델 메뉴의 동작 (그리기와 따로) — 열기 · 닫기 · (모델이 많을 때만) 검색 · 강조 줄 · 키보드.
// 목록 = /api/models 순서 그대로 한 줄씩 (관리자 순서 · 묶음 머리 없음).
// 키보드 (listbox · 검색칸이 있으면 combobox): ↑↓ Home End = 이동(끝에서 돌아감) · Enter = 고르고 닫기
//   · 검색칸이 없으면 글자를 치면 그 글자로 시작하는 모델로 (type-ahead) · Esc = 검색 지우기 → 닫기
//   · Tab = 생각 깊이 (←→ 로 바꾸기). 버튼에서 ↓/↑ = 열기. 바깥 누름 · 포커스가 밖으로 = 닫기
// 목록은 열 때마다 다시 읽는다 → 관리자가 방금 숨긴 모델은 바로 빠진다 (P2-1).
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { providerLabel } from '@brewai/ui';
import type { Model } from './api';
import { clearModelNotice, effectiveModel, loadModels, pickModel, useModelState } from './hooks';

const norm = (s: string) => s.normalize('NFC').toLowerCase();
export const SEARCH_MIN = 9; // 모델이 이보다 많을 때만 검색칸
const NOTICE_MS = 8000;
const TYPEAHEAD_MS = 600;

// 검색어와 맞는 곳 (굵게 그릴 범위) — 없으면 null
export function hitRange(text: string, q: string): [number, number] | null {
  if (!q) return null;
  const i = norm(text).indexOf(q);
  return i < 0 ? null : [i, i + q.length];
}

export function useModelPicker() {
  const models = useModelState((s) => s.models);
  const current = useModelState(effectiveModel);
  const notice = useModelState((s) => s.modelNotice);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string | null>(null); // 강조한 줄 (모델 id)
  const [refreshing, setRefreshing] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const uid = useId();
  const searchable = models.list.length >= SEARCH_MIN;
  const q = searchable ? norm(query.trim()) : '';

  // 검색 = 이름 · 회사 (게이트웨이 id 는 화면에 없으니 찾는 말에도 넣지 않는다)
  const match = (m: Model) => !q || [m.label, providerLabel(m.provider, m.provider_label)].some((x) => norm(x).includes(q));
  const shown = models.list.filter(match);
  const activeModel = shown.find((m) => m.id === active) ?? null;
  const optId = (id: string) => `${uid}-o-${models.list.findIndex((m) => m.id === id)}`;

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (refocus) button.current?.focus();
  };
  const openMenu = () => {
    setOpen(true);
    setQuery('');
    setActive(current?.id ?? null);
    setRefreshing(true);
    void loadModels().finally(() => setRefreshing(false)); // 최신 목록 (관리자가 방금 숨긴 모델은 빠진다)
  };
  const toggle = () => (open ? close(false) : openMenu());

  // 열리면 검색칸(있으면) 또는 목록으로 (바로 키보드)
  useEffect(() => {
    if (open) (input.current ?? list.current)?.focus();
  }, [open, searchable]);

  // 강조한 줄이 목록에서 빠지면(숨김 · 검색) 고른 모델 → 첫 줄로
  useEffect(() => {
    if (!open || shown.some((m) => m.id === active)) return;
    const sel = current && shown.find((m) => m.id === current.id);
    setActive((sel || shown[0])?.id ?? null);
  });

  // 강조한 줄이 보이게
  useEffect(() => {
    if (!open || !active) return;
    document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' });
  }, [active, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 바깥을 누르면 닫는다 (포커스는 누른 곳으로). Esc 는 포커스가 어디 있든 닫고 버튼으로
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close(true);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 기본 모델로 돌아갔다는 안내는 잠깐만
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clearModelNotice, NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const pick = (m: Model) => {
    pickModel(m.id);
    close(true);
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) openMenu();
    }
  };
  // 검색칸 · 목록이 같이 쓴다
  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    const i = shown.findIndex((m) => m.id === active);
    const move = (to: number) => {
      e.preventDefault();
      if (!shown.length) return;
      setActive(shown[(to + shown.length) % shown.length].id);
    };
    if (e.key === 'ArrowDown') move(i < 0 ? 0 : i + 1);
    else if (e.key === 'ArrowUp') move(i < 0 ? shown.length - 1 : i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(shown.length - 1);
    else if ((e.key === 'Enter' || (e.key === ' ' && !searchable)) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (activeModel) pick(activeModel);
    } else if (e.key === 'Escape' && query) {
      e.preventDefault();
      e.stopPropagation(); // 먼저 검색만 지운다 (닫기는 다음 Esc)
      setQuery('');
    } else if (!searchable && e.key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey && e.key !== ' ') {
      // type-ahead: 잇달아 친 글자로 시작하는 다음 모델
      const now = Date.now();
      const text = (now - typed.current.at < TYPEAHEAD_MS ? typed.current.text : '') + norm(e.key);
      typed.current = { text, at: now };
      // 같은 글자를 거듭 치면 그 글자로 시작하는 모델을 차례로 (ff → f 의 다음)
      const key = /^(.)\1+$/u.test(text) ? Array.from(text)[0] : text;
      const from = Math.max(0, key === text && text.length > 1 ? i : i + 1); // 이어 치는 중이면 지금 줄부터 다시 본다
      const order = [...shown.slice(from), ...shown.slice(0, from)];
      const hit = order.find((m) => norm(m.label).startsWith(key));
      if (hit) setActive(hit.id);
    }
  };
  // 포커스가 팝오버 밖으로 나가면(Tab) 닫는다
  const onBlur = (e: FocusEvent) => {
    if (open && e.relatedTarget && !wrap.current?.contains(e.relatedTarget as Node)) close(false);
  };
  const clearSearch = () => {
    setQuery('');
    input.current?.focus();
  };

  return {
    models, current, notice, open, query, setQuery, q, refreshing, searchable,
    refs: { wrap, button, input, list },
    ids: { pop: `${uid}-pop`, list: `${uid}-list`, opt: optId },
    shown, active: activeModel,
    toggle, close, pick, clearSearch, onButtonKey, onListKey, onBlur, hover: setActive,
  };
}
