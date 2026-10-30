// 모델 메뉴의 동작 (그리기와 따로) — 열기 · 닫기 · 검색 · 묶음 · 강조 줄 · 키보드 · 좁은 창 자세히 카드.
// 키보드 (combobox): 검색칸에서 ↑↓ Home End = 이동(머리글 건너뜀 · 끝에서 돌아감) · Enter = 고르고 닫기 · Esc = 검색 지우기 → 닫기
//   · Tab = 생각 깊이 (←→ 로 바꾸기). 버튼에서 ↓/↑ = 열기. 바깥 누름 · 포커스가 밖으로 = 닫기
// 목록은 열 때마다 다시 읽는다 → 관리자가 방금 숨긴 모델은 바로 빠진다 (P2-1).
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { providerLabel } from '@brewai/ui';
import { useMedia } from '../../lib/hooks';
import type { Model } from './api';
import { clearModelNotice, effectiveModel, loadModels, pickModel, useModelState } from './hooks';

export type Group = { provider: string; label: string; models: Model[] };
export type Opt = { key: string; model: Model; sec: 'recent' | 'all' };

const norm = (s: string) => s.normalize('NFC').toLowerCase();
const RECENT_SHOWN = 3;
const WIDE = '(min-width: 1040px)'; // 넓은 창 = 두 칸 (목록 · 자세히), 좁은 창 = 한 칸 + 옆 카드
const NOTICE_MS = 8000;
const CARD_DELAY_MS = 300;

// 회사별 묶음 = 목록에 처음 나온 순서 (기본 모델이 맨 앞 · 나머지는 관리자 순서). 묶음 안 순서도 그대로 (안정)
function groups(list: Model[]): Group[] {
  const out: Group[] = [];
  for (const m of list) {
    const g = out.find((x) => x.provider === m.provider);
    if (g) g.models.push(m);
    else out.push({ provider: m.provider, label: providerLabel(m.provider, m.provider_label), models: [m] });
  }
  return out;
}

// 검색어와 맞는 곳 (굵게 그릴 범위) — 없으면 null
export function hitRange(text: string, q: string): [number, number] | null {
  if (!q) return null;
  const i = norm(text).indexOf(q);
  return i < 0 ? null : [i, i + q.length];
}

export function useModelPicker() {
  const models = useModelState((s) => s.models);
  const current = useModelState(effectiveModel);
  const recentIds = useModelState((s) => s.recentModels);
  const notice = useModelState((s) => s.modelNotice);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string | null>(null); // 강조한 줄 (Opt.key)
  const [refreshing, setRefreshing] = useState(false);
  const [card, setCard] = useState<string | null>(null); // 좁은 창: 자세히 카드를 띄운 줄
  const wide = useMedia(WIDE);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const hover = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uid = useId();
  const q = norm(query.trim());

  const match = (m: Model) =>
    !q || [m.label, m.id, providerLabel(m.provider, m.provider_label), m.family ?? ''].some((x) => norm(x).includes(q));
  const shown = models.list.filter(match);
  const recent = q ? [] : recentIds.map((id) => models.list.find((m) => m.id === id)).filter((m): m is Model => !!m).slice(0, RECENT_SHOWN);
  const grouped = groups(shown);
  const recentOpts: Opt[] = recent.map((m) => ({ key: `r:${m.id}`, model: m, sec: 'recent' }));
  const groupOpts = grouped.map((g) => ({ ...g, opts: g.models.map((m): Opt => ({ key: `m:${m.id}`, model: m, sec: 'all' })) }));
  const opts: Opt[] = [...recentOpts, ...groupOpts.flatMap((g) => g.opts)];
  const activeOpt = opts.find((o) => o.key === active) ?? null;
  const optId = (key: string) => `${uid}-o-${opts.findIndex((o) => o.key === key)}`;

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery('');
    setCard(null);
    if (refocus) button.current?.focus();
  };
  const openMenu = () => {
    setOpen(true);
    setQuery('');
    setActive(current ? `m:${current.id}` : null);
    setRefreshing(true);
    void loadModels().finally(() => setRefreshing(false)); // 최신 목록 (관리자가 방금 숨긴 모델은 빠진다)
  };
  const toggle = () => (open ? close(false) : openMenu());

  // 열리면 검색칸으로 (바로 입력)
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // 강조한 줄이 목록에서 빠지면(숨김 · 검색) 고른 모델 → 첫 줄로
  useEffect(() => {
    if (!open || opts.some((o) => o.key === active)) return;
    const sel = current && opts.find((o) => o.key === `m:${current.id}`);
    setActive((sel || opts[0])?.key ?? null);
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

  useEffect(() => () => {
    if (hover.current) clearTimeout(hover.current);
  }, []);

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
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const i = opts.findIndex((o) => o.key === active);
    const move = (to: number) => {
      e.preventDefault();
      if (!opts.length) return;
      const next = opts[(to + opts.length) % opts.length].key;
      setActive(next);
      if (!wide) setCard(next); // 키보드 = 자세히 카드를 바로
    };
    if (e.key === 'ArrowDown') move(i < 0 ? 0 : i + 1);
    else if (e.key === 'ArrowUp') move(i < 0 ? opts.length - 1 : i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(opts.length - 1);
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (activeOpt) pick(activeOpt.model);
    } else if (e.key === 'Escape' && query) {
      e.preventDefault();
      e.stopPropagation(); // 먼저 검색만 지운다 (닫기는 다음 Esc)
      setQuery('');
    }
  };
  // 포커스가 팝오버 밖으로 나가면(Tab) 닫는다
  const onBlur = (e: FocusEvent) => {
    if (open && e.relatedTarget && !wrap.current?.contains(e.relatedTarget as Node)) close(false);
  };
  const onRowHover = (key: string) => {
    setActive(key);
    if (wide) return;
    if (hover.current) clearTimeout(hover.current);
    hover.current = setTimeout(() => setCard(key), CARD_DELAY_MS);
  };
  const onRowLeave = () => {
    if (hover.current) clearTimeout(hover.current);
  };
  const clearSearch = () => {
    setQuery('');
    input.current?.focus();
  };

  return {
    models, current, notice, open, query, setQuery, q, refreshing, wide,
    refs: { wrap, button, input },
    ids: { pop: `${uid}-pop`, list: `${uid}-list`, opt: optId },
    shown, recentOpts, groupOpts, activeOpt,
    detail: activeOpt?.model ?? current, // 넓은 창 오른쪽 칸 = 강조한 줄
    card: !wide && card ? opts.find((o) => o.key === card)?.model ?? null : null,
    toggle, close, pick, clearSearch, onButtonKey, onSearchKey, onBlur, onRowHover, onRowLeave,
  };
}
