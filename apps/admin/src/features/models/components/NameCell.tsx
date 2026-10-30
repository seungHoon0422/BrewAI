import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Badge, Button, IconButton, Input } from '@brewai/ui';
import type { AdminModel, ModelState } from '../api';
import { COPY, SOURCE, STATE_TEXT } from '../copy';
import type { Dup } from '../derive';
import type { Change } from '../hooks';
import { modelHref } from '../route';

// 상태 딱지 = 할 일이 있는 둘만 (후보 = 확인 · 사라짐 = 게이트웨이에 없음). 노출 · 숨김은 노출 스위치가 말한다. E2E: .chip
export const StateBadge = ({ state }: { state: ModelState }) =>
  state === 'candidate' || state === 'missing' ? (
    <Badge dot size="sm" tone={state === 'candidate' ? 'info' : 'warn'} className="chip">{STATE_TEXT[state]}</Badge>
  ) : null;

// 같은 표시 이름 표시 (E2E: .dupb · 옅은 쪽 = .soft)
export function DupBadge({ dup }: { dup: Dup }) {
  if (dup === 'user') return <Badge tone="warn" variant="outline" size="sm" className="dupb" title={COPY.dupUserTitle}>{COPY.dupUser}</Badge>;
  if (dup === 'hidden') return <Badge variant="outline" size="sm" className="dupb soft" title={COPY.dupHiddenTitle}>{COPY.dupHidden}</Badge>;
  return null;
}

// '기본' 꼬리표 = 옅은 잉크 (색이 아니라 강조 · 데스크톱 모델 메뉴와 같은 모양)
export const DefaultBadge = () => <Badge tone="accent" size="sm" className="dflt">{COPY.default}</Badge>;

export const SourceBadge = ({ source, title }: { source: NonNullable<AdminModel['source']>; title?: string }) => (
  <Badge size="sm" className="src" title={title}>{SOURCE[source].tag}</Badge>
);

// 모델 칸 = 데스크톱 모델 메뉴처럼 두 줄: 위 = 보이는 이름(굵게) · 아래 = 실제 모델 이름(고정폭 · 옅게).
// 표시 이름 = 연필로 바꾼다 (Enter 저장 · Esc 취소 · 비우면 기본 이름으로). 이름 = 자세히 페이지 링크.
// 이름 옆 딱지 = 기본 · 후보 · 사라짐 · 이름 겹침 (상태 칸 없음)
export function ModelLink({ m }: { m: AdminModel }) {
  return (
    <a className="nbtn" href={modelHref(m.id)} title={COPY.detailsTitle} aria-label={COPY.details(m.label)}>
      <b className="ui-ell">{m.label}</b>
    </a>
  );
}

export function NameCell({ m, busy, onChange, dup }: { m: AdminModel; busy: boolean; onChange: Change; dup: Dup }) {
  const [editing, setEditing] = useState(false);
  const editBtn = useRef<HTMLButtonElement>(null);
  if (editing) {
    return (
      <NameEditor m={m} busy={busy} onChange={onChange} label={COPY.nameField(m.id)}
        onDone={() => {
          setEditing(false);
          requestAnimationFrame(() => editBtn.current?.focus());
        }} />
    );
  }
  return (
    <div className="ncell">
      <span className="nline">
        <ModelLink m={m} />
        {m.is_default && <DefaultBadge />}
        <StateBadge state={m.state} />
        <DupBadge dup={dup} />
        <IconButton ref={editBtn} className="nedit-btn" size="sm" icon="pen" label={COPY.rename(m.label)} disabled={busy} onClick={() => setEditing(true)} />
      </span>
      <span className="sub">
        <code className="mid ui-ell" title={COPY.gatewayId}>{m.id}</code>
        {m.display_name && (
          <Button size="sm" variant="ghost" className="nrevert" disabled={busy} title={COPY.revertTitle(m.default_label)}
            onClick={() => void onChange(m, { display_name: null }, COPY.done.nameReverted(m.default_label))}>
            {COPY.revert}
          </Button>
        )}
      </span>
    </div>
  );
}

export function NameEditor({ m, busy, onChange, onDone, label }: { m: AdminModel; busy: boolean; onChange: Change; onDone: () => void; label: string }) {
  const [value, setValue] = useState(m.display_name ?? m.label);
  const input = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  useEffect(() => input.current?.select(), []);
  const finish = async (save: boolean) => {
    if (saving.current) return;
    const next = value.replace(/\s+/g, ' ').trim();
    const same = next === (m.display_name ?? '') || (!m.display_name && next === m.default_label);
    if (!save || same) return onDone();
    saving.current = true;
    const ok = await onChange(m, { display_name: next === '' || next === m.default_label ? null : next });
    saving.current = false;
    if (ok) onDone();
    else input.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      void finish(false);
    }
  };
  return (
    <div className="nedit">
      <Input ref={input} size="sm" className="nin" type="text" value={value} maxLength={60} disabled={busy}
        aria-label={label} placeholder={m.default_label} onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey} onBlur={() => void finish(true)} />
      <span className="nedit-hint">{COPY.nameEditHint(m.default_label)}</span>
    </div>
  );
}
