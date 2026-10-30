import { useState, type DragEvent, type MouseEvent } from 'react';
import { Badge, Checkbox, Icon, IconButton, Radio, Switch, flag, type Tone } from '@brewai/ui';
import type { AdminModel, ModelState } from '../api';
import { COPY, STATE_TEXT } from '../copy';
import { canExpose, info, priceOf, providerName, type Dup } from '../derive';
import type { Change, Probe } from '../hooks';
import { Health } from './Health';
import { NameCell } from './NameCell';

// 상태 배지 색 = 상태 (노출 = ok · 후보 = info · 사라짐 = warn · 숨김 = 회색). E2E: 줄마다 .chip 하나
const STATE_TONE: Record<ModelState, Tone> = { exposed: 'ok', candidate: 'info', hidden: 'neutral', missing: 'warn' };
export const StateBadge = ({ state }: { state: ModelState }) => (
  <Badge dot tone={STATE_TONE[state]} className="chip">{STATE_TEXT[state]}</Badge>
);

export function ModelRow({ m, pos, prev, next, busy, onChange, onProbe, now, dup, checked, onCheck, onOpen, canDrag, canDrop, dragging, onDragStart, onDragEnd, onDrop }: {
  m: AdminModel;
  pos?: number;
  prev?: AdminModel;
  next?: AdminModel;
  busy: boolean;
  onChange: Change;
  onProbe: Probe;
  now: number;
  dup: Dup;
  checked: boolean;
  onCheck: () => void;
  onOpen: () => void;
  canDrag: boolean;
  canDrop: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const missing = m.status === 'missing';
  const exposeWhy = !m.is_chat ? COPY.notChat : missing ? COPY.missing : undefined;
  const ginfo = info(m);
  const price = priceOf(m);
  const [over, setOver] = useState(false);
  // 줄의 빈 곳을 누르면 서랍 (버튼 · 입력 · 링크는 제 일을 한다)
  const onRowClick = (e: MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as HTMLElement).closest('button,input,a,label,.nedit')) return;
    onOpen();
  };
  const dragProps = canDrag && canDrop && !missing ? {
    onDragOver: (e: DragEvent) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => { e.preventDefault(); setOver(false); onDrop(); },
  } : {};

  return (
    <tr data-model={m.id} data-state={m.state} data-clickable="" data-selected={flag(checked)} data-busy={flag(busy)}
      data-dragging={flag(dragging)} data-over={flag(over)} aria-busy={busy} onClick={onRowClick} {...dragProps}>
      <td className="sel">
        <Checkbox aria-label={COPY.select(m.label)} checked={checked} onChange={onCheck} />
      </td>
      <td className="ord" title={canDrag ? COPY.ordTitle(providerName(m), pos ?? '—') : COPY.ordLocked}>
        {missing ? '—' : (
          <span className="ordc">
            {canDrag && (
              <span className="grip" draggable aria-hidden="true" title={COPY.dragTitle}
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', m.id); onDragStart(); }}
                onDragEnd={onDragEnd}>
                <Icon name="grip" size="sm" />
              </span>
            )}
            <span className="num ui-num">{pos ?? '—'}</span>
            <span className="mv">
              <IconButton size="sm" icon="arrow-up" label={COPY.up(m.label)} disabled={busy || !prev} onClick={() => prev && onChange(m, { order: prev.order })} />
              <IconButton size="sm" icon="arrow-down" label={COPY.down(m.label)} disabled={busy || !next} onClick={() => next && onChange(m, { order: next.order })} />
            </span>
          </span>
        )}
      </td>
      <td className="mcell"><NameCell m={m} busy={busy} onChange={onChange} dup={dup} onOpen={onOpen} /></td>
      <td><StateBadge state={m.state} /></td>
      <td>
        <Switch checked={m.exposed} aria-label={COPY.exposeSwitch(m.label)} title={exposeWhy ?? (m.exposed ? COPY.exposeOn : COPY.exposeOff)}
          disabled={busy || (!canExpose(m) && !m.exposed)} onCheckedChange={(on) => void onChange(m, { exposed: on })} />
      </td>
      <td>
        <Radio name="default-model" aria-label={COPY.defaultRadio(m.label)} checked={m.is_default}
          disabled={busy || !m.exposed} title={m.exposed ? COPY.defaultTitle : COPY.defaultNeedsExposed}
          onChange={() => onChange(m, { is_default: true }, COPY.done.defaultChanged(m.label))} />
      </td>
      <td className="conn"><Health m={m} busy={busy} onProbe={onProbe} now={now} /></td>
      <td className="ginfo" data-hide-below="lg">
        {ginfo.length > 0 && <span>{ginfo.join(' · ')}</span>}
        {price && <span className="price" title={COPY.priceTitle}>{price}</span>}
        {!ginfo.length && !price && <span className="nil">—</span>}
      </td>
    </tr>
  );
}
