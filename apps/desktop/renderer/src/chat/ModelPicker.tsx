// 입력창의 모델 버튼 + 메뉴 (design/prototype.html .model · .menu). 모델은 회사별로 묶고, 아래에 생각 깊이.
// 목록 = GET /api/models (노출된 모델만). 메뉴를 열 때마다 다시 읽는다 → 숨겨진 모델은 바로 빠진다 (P2-1).
// 키보드: 버튼에서 ↓/↑/Enter/Space = 열기 · 메뉴에서 ↑↓ Home End = 이동 · Enter/Space = 고르기 · Esc = 닫고 버튼으로 · Tab = 닫기
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Model } from '../api';
import { Icon } from '../icons';
import { ProviderIcon, providerLabel } from '../providers';
import { FAILURE_TEXT, REASONING, reasoningLabel } from './text';
import {
  clearModelNotice, effectiveModel, effectiveReasoning, loadModels, pickModel, pickReasoning, useSession,
} from './session';

type Group = { provider: string; label: string; models: Model[] };

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

const ITEM = '[role="menuitemradio"]:not([aria-disabled="true"])';

export function ModelPicker() {
  const models = useSession((s) => s.models);
  const pref = useSession((s) => s.reasoning);
  const current = useSession(effectiveModel);
  const reasoning = useSession(effectiveReasoning);
  const notice = useSession((s) => s.modelNotice);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusWant = useRef<'checked' | 'first' | 'last' | null>(null);
  const menuId = useId();
  const canThink = current?.supports_reasoning ?? false;

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])];
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  const openMenu = (want: 'checked' | 'first' | 'last') => {
    focusWant.current = want;
    setOpen(true);
    void loadModels(); // 최신 목록 (관리자가 방금 숨긴 모델은 빠진다)
  };

  // 열린 뒤 · 목록이 새로 온 뒤 포커스 둘 곳. 포커스가 있던 모델이 목록에서 빠지면(숨김) 고른 항목으로 옮긴다
  useLayoutEffect(() => {
    if (!open) return;
    const lost = !menu.current?.contains(document.activeElement);
    if (!focusWant.current && !lost) return;
    const list = items();
    if (!list.length) {
      menu.current?.focus();
      return;
    }
    const want = focusWant.current ?? 'checked';
    const checked = list.find((el) => el.getAttribute('aria-checked') === 'true' && el.dataset.group === 'model');
    (want === 'last' ? list.at(-1) : want === 'first' ? list[0] : checked ?? list[0])?.focus();
    focusWant.current = null;
  }, [open, models]);

  // 바깥을 누르면 닫는다 (포커스는 누른 곳으로). Esc 는 포커스가 어디 있든 닫고 버튼으로
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 기본 모델로 돌아갔다는 안내는 잠깐만
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clearModelNotice, 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu(e.key === 'ArrowUp' ? 'last' : 'checked');
    }
  };
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      e.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(i < 0 ? 0 : i + 1);
    else if (e.key === 'ArrowUp') move(i < 0 ? list.length - 1 : i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(list.length - 1);
    else if (e.key === 'Tab') setOpen(false); // Esc = 위 document 리스너
  };

  const label = current?.label ?? '기본 모델';
  const tip = current
    ? `${label} · ${providerLabel(current.provider, current.provider_label)}${current.label !== current.id ? ` (${current.id})` : ''}`
    : models.status === 'error' ? FAILURE_TEXT[models.error ?? 'offline'] : '허용된 모델만 보여요';

  return (
    <span className="mpick" ref={wrap}>
      {notice && <span className="mnotice" role="status">{notice}</span>}
      <button ref={btn} className="model" type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        title={tip} onClick={() => (open ? close(false) : openMenu('checked'))} onKeyDown={onButtonKey}>
        <ProviderIcon provider={current?.provider ?? 'other'} className={current ? undefined : 'none'} />
        <span className="nm">{label}</span>
        {reasoning !== 'off' && <span className="eff">· {reasoningLabel(reasoning)}</span>}
        <Icon name="down" />
      </button>
      {open && (
        <div className="menu" id={menuId} role="menu" aria-label="모델과 생각 깊이" ref={menu} tabIndex={-1} onKeyDown={onMenuKey}>
          {models.status === 'loading' && models.list.length === 0 && (
            <p className="mstate"><span className="spin12" aria-hidden="true" />모델 목록을 불러오는 중…</p>
          )}
          {models.status === 'error' && models.list.length === 0 && (
            <div className="mstate">
              <span>{models.error === 'offline' ? '서버에 연결할 수 없어요' : '모델 목록을 불러오지 못했어요'}</span>
              <button className="btn sm" type="button" onClick={() => void loadModels()}>
                <Icon name="refresh" small />다시 시도
              </button>
            </div>
          )}
          {models.status === 'ready' && models.list.length === 0 && <p className="mstate">쓸 수 있는 모델이 없어요</p>}
          {groups(models.list).map((g) => (
            <ModelGroup key={g.provider} g={g} checkedId={current?.id ?? null} />
          ))}
          {models.list.length > 0 && <>
          <h6 id={`${menuId}-r`}>생각 깊이</h6>
          <div role="group" aria-labelledby={`${menuId}-r`}>
            {REASONING.map((r) => {
              const checked = canThink ? pref === r.id : r.id === 'off';
              return (
                <button key={r.id} type="button" role="menuitemradio" data-group="reasoning" aria-checked={checked}
                  aria-disabled={!canThink || undefined} tabIndex={-1}
                  title={canThink ? undefined : '이 모델은 생각 깊이를 고를 수 없어요'}
                  onClick={() => canThink && pickReasoning(r.id)}>
                  <span className="lbl"><span className="nm">{r.label}</span><span className="sub">{r.sub}</span></span>
                  <span className="chk" aria-hidden="true"><Icon name="check" small /></span>
                </button>
              );
            })}
          </div>
          {current && !canThink && <p className="mnote">이 모델은 생각 깊이를 고를 수 없어요</p>}
          </>}
          <div className="foot">허용된 모델만 보여요</div>
        </div>
      )}
    </span>
  );
}

function ModelGroup({ g, checkedId }: { g: Group; checkedId: string | null }) {
  const id = useId();
  return (
    <>
      <h6 id={id}>
        <ProviderIcon provider={g.provider} />
        {g.label}
      </h6>
      <div role="group" aria-labelledby={id}>
        {g.models.map((m) => {
          const sub = [m.is_default ? '기본' : '', m.supports_reasoning ? '생각' : ''].filter(Boolean).join(' · ');
          return (
            <button key={m.id} type="button" role="menuitemradio" data-group="model" data-model={m.id} tabIndex={-1}
              aria-checked={m.id === checkedId} title={m.label !== m.id ? `${m.label} (${m.id})` : m.label}
              onClick={() => pickModel(m.id)}>
              <span className="lbl">
                <span className="nm">{m.label}</span>
                {sub && <span className="sub">{sub}</span>}
              </span>
              <span className="chk" aria-hidden="true"><Icon name="check" small /></span>
            </button>
          );
        })}
      </div>
    </>
  );
}
