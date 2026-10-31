import { useState, type DragEvent, type MouseEvent } from 'react';
import { Checkbox, Icon, ProviderIcon, Radio, Switch, flag } from '@brewai/ui';
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

export function ModelRow({ m, busy, test, onChange, onProbe, now, dup, checked, onCheck, onOpen, canDrag, canDrop, dropBelow, dragging, onDragStart, onDragEnd, onDrop }: {
  m: AdminModel;
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
  dropBelow: boolean; // 아래로 끄는 중 = 이 줄 뒤에 놓인다 (표시 선 = 줄 아래)
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
    <tr data-model={m.id} data-provider={m.provider} data-state={m.state} data-clickable="" data-selected={flag(checked)} data-busy={flag(busy)}
      data-dragging={flag(dragging)} data-over={flag(over)} data-below={flag(over && dropBelow)} aria-busy={busy} onClick={onRowClick} {...dragProps}>
      <td className="sel" data-col="select">
        <Checkbox aria-label={COPY.select(m.label)} checked={checked} onChange={onCheck} />
      </td>
      {/* 순서 = 전체 자리 (숨김 · 후보 포함 · 사용자 앱 메뉴는 노출한 모델만 이 순서로) · 손잡이를 끌어 옮긴다 (키보드 · 한 칸씩 = 자세히 페이지) */}
      <td className="ord" data-col="order" title={missing ? undefined : canDrag ? COPY.ordTitle(m.order) : COPY.ordLocked}>
        {missing ? '—' : (
          <span className="ordc">
            {canDrag && (
              <span className="grip" draggable aria-hidden="true" title={COPY.dragTitle}
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', m.id); onDragStart(); }}
                onDragEnd={onDragEnd}>
                <Icon name="grip" size="sm" />
              </span>
            )}
            <span className="num ui-num">{m.order}</span>
          </span>
        )}
      </td>
      <td className="mprov" data-col="provider"><ProviderName m={m} /></td>
      <td className="mcell" data-col="model"><NameCell m={m} busy={busy} onChange={onChange} dup={dup} /></td>
      <td className="gnum" data-col="context"><Num v={tokens(m.max_input_tokens)} /></td>
      <td className="gnum" data-col="input"><Num v={perM(m.input_cost_per_token)} title={COPY.costTitle(COL_LABEL.input)} /></td>
      <td className="gnum" data-col="output"><Num v={perM(m.output_cost_per_token)} title={COPY.costTitle(COL_LABEL.output)} /></td>
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
