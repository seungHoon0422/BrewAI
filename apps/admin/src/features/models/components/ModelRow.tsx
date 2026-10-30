import { useState, type DragEvent, type MouseEvent } from 'react';
import { Checkbox, Icon, IconButton, ProviderIcon, Radio, Switch, flag } from '@brewai/ui';
import type { AdminModel } from '../api';
import { COL_LABEL, COPY } from '../copy';
import { canExpose, perM, providerName, tokens, type Dup } from '../derive';
import type { Change, Probe, TestState } from '../hooks';
import { Caps } from './Caps';
import { Health } from './Health';
import { NameCell } from './NameCell';

// 제공사 = 아이콘 + 이름 (좁은 창에선 아이콘만 · 이름은 툴팁)
export const ProviderName = ({ m }: { m: AdminModel }) => (
  <span className="prov" title={providerName(m)}><ProviderIcon provider={m.provider} /><span className="pname ui-ell">{providerName(m)}</span></span>
);

// 비용 · 컨텍스트 = 숫자만 (단위는 머리 글 툴팁 · 표 아래 한 줄). 모르면 —
const Num = ({ v, title }: { v: string | null; title?: string }) => (v ? <span className="ui-num" title={title}>{v}</span> : <span className="nil">—</span>);

export function ModelRow({ m, groupStart, pos, prev, next, busy, test, onChange, onProbe, now, dup, checked, onCheck, onOpen, canDrag, canDrop, dragging, onDragStart, onDragEnd, onDrop }: {
  m: AdminModel;
  groupStart: boolean; // 제공사가 바뀌는 줄 (위에 선)
  pos?: number;
  prev?: AdminModel;
  next?: AdminModel;
  busy: boolean;
  test: TestState | undefined;
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
  const [over, setOver] = useState(false);
  // 줄의 빈 곳을 누르면 자세히 페이지 (버튼 · 입력 · 링크 · 고르기 · 노출 · 연결 칸은 제 일을 한다). 글을 끌어 고르는 중(복사)이면 그대로
  const onRowClick = (e: MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as HTMLElement).closest('button,input,a,label,.nedit,.grip,td.sel,td.set,td.conn')) return;
    if (window.getSelection()?.toString()) return;
    onOpen();
  };
  const dragProps = canDrag && canDrop && !missing ? {
    onDragOver: (e: DragEvent) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => { e.preventDefault(); setOver(false); onDrop(); },
  } : {};

  return (
    <tr data-model={m.id} data-provider={m.provider} data-group-start={flag(groupStart)} data-state={m.state} data-clickable="" data-selected={flag(checked)} data-busy={flag(busy)}
      data-dragging={flag(dragging)} data-over={flag(over)} aria-busy={busy} onClick={onRowClick} {...dragProps}>
      <td className="sel" data-col="select">
        <Checkbox aria-label={COPY.select(m.label)} checked={checked} onChange={onCheck} />
      </td>
      <td className="ord" data-col="order" title={canDrag ? COPY.ordTitle(providerName(m), pos ?? '—') : COPY.ordLocked}>
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
      <td className="mprov" data-col="provider"><ProviderName m={m} /></td>
      <td className="mcell" data-col="model"><NameCell m={m} busy={busy} onChange={onChange} dup={dup} /></td>
      <td className="gnum" data-col="context" data-align="end"><Num v={tokens(m.max_input_tokens)} /></td>
      <td className="gnum" data-col="input" data-align="end"><Num v={perM(m.input_cost_per_token)} title={COPY.costTitle(COL_LABEL.input)} /></td>
      <td className="gnum" data-col="output" data-align="end"><Num v={perM(m.output_cost_per_token)} title={COPY.costTitle(COL_LABEL.output)} /></td>
      <td className="gcaps" data-col="caps"><Caps m={m} /></td>
      <td className="set" data-col="exposed">
        <Switch checked={m.exposed} aria-label={COPY.exposeSwitch(m.label)} title={exposeWhy ?? (m.exposed ? COPY.exposeOn : COPY.exposeOff)}
          disabled={busy || (!canExpose(m) && !m.exposed)} onCheckedChange={(on) => void onChange(m, { exposed: on })} />
      </td>
      <td className="set" data-col="default">
        <Radio name="default-model" aria-label={COPY.defaultRadio(m.label)} checked={m.is_default}
          disabled={busy || !m.exposed} title={m.exposed ? COPY.defaultTitle : COPY.defaultNeedsExposed}
          onChange={() => onChange(m, { is_default: true }, COPY.done.defaultChanged(m.label))} />
      </td>
      <td className="conn" data-col="health"><Health m={m} test={test} onProbe={onProbe} now={now} /></td>
    </tr>
  );
}
