import { useEffect, useRef, useState } from 'react';
import { Button, Callout, IconButton, KeyValue, ProviderIcon, Sheet, Switch, providerLabel } from '@brewai/ui';
import type { AdminModel, GatewayInfo } from '../api';
import { COPY, SOURCE } from '../copy';
import { ago, canExpose, info, neighbors, priceOf, providerName, tokens, type Dup } from '../derive';
import type { Change, Probe } from '../hooks';
import { Health } from './Health';
import { DefaultBadge, DupBadge, NameEditor, SourceBadge } from './NameCell';
import { StateBadge } from './ModelRow';

// 오른쪽 서랍 (폰 = 아래 시트): 이름 · 노출 · 기본 · 순서 · 연결 · 게이트웨이 값(읽기 전용). E2E: dialog.mdrawer
export function ModelSheet({ m, rows, dup, busy, gateway, now, onChange, onProbe, onClose }: {
  m: AdminModel | null; rows: AdminModel[]; dup: Dup; busy: boolean; gateway: GatewayInfo | null; now: number;
  onChange: Change; onProbe: Probe; onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const last = useRef<string | null>(null);
  const open = m !== null;

  // 닫으면 포커스는 그 줄의 이름 버튼으로 (줄의 빈 곳을 눌러 열었어도)
  useEffect(() => {
    if (open) last.current = m.id;
    else if (last.current) {
      document.querySelector<HTMLButtonElement>(`tr[data-model="${CSS.escape(last.current)}"] .nbtn`)?.focus();
      last.current = null;
      setEditing(false);
    }
  }, [open, m?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={open} onClose={onClose} className="mdrawer"
      title={m ? <><ProviderIcon provider={m.provider} size="lg" />{m.label}</> : COPY.sheetTitle}
      description={m ? <><code>{m.id}</code> · {providerName(m)}{m.family ? COPY.familyOf(m.family) : ''}</> : undefined}>
      {m && <SheetBody m={m} rows={rows} dup={dup} busy={busy} gateway={gateway} now={now} onChange={onChange} onProbe={onProbe}
        editing={editing} setEditing={setEditing} />}
    </Sheet>
  );
}

function SheetBody({ m, rows, dup, busy, gateway, now, onChange, onProbe, editing, setEditing }: {
  m: AdminModel; rows: AdminModel[]; dup: Dup; busy: boolean; gateway: GatewayInfo | null; now: number;
  onChange: Change; onProbe: Probe; editing: boolean; setEditing: (v: boolean) => void;
}) {
  const { at, total, prev, next } = neighbors(rows, m);
  const ginfo = info(m);
  const price = priceOf(m);
  const kv = COPY.kv;
  return (
    <>
      <div className="dtags">
        <StateBadge state={m.state} />
        {m.is_default && <DefaultBadge />}
        <DupBadge dup={dup} />
        {m.source && <SourceBadge source={m.source} />}
      </div>

      <section className="dpart">
        <h3>{COPY.partName}</h3>
        {editing ? (
          <NameEditor m={m} busy={busy} onChange={onChange} label={COPY.nameFieldInSheet} onDone={() => setEditing(false)} />
        ) : (
          <div className="drow">
            <b>{m.label}</b>
            <Button size="sm" icon="pen" disabled={busy} onClick={() => setEditing(true)}>{COPY.renameBtn}</Button>
            {m.display_name && (
              <Button size="sm" variant="ghost" disabled={busy}
                onClick={() => void onChange(m, { display_name: null }, COPY.done.nameReverted(m.default_label))}>
                {COPY.backToDefault(m.default_label)}
              </Button>
            )}
          </div>
        )}
        {dup === 'user' && <Callout tone="warn" className="dwarn">{COPY.dupUserLong}</Callout>}
        {dup === 'hidden' && <Callout className="dwarn soft">{COPY.dupHiddenLong}</Callout>}
      </section>

      <section className="dpart">
        <h3>{COPY.partApp}</h3>
        <div className="drow">
          <Switch checked={m.exposed} aria-label={COPY.exposeInSheet} disabled={busy || (!canExpose(m) && !m.exposed)}
            onCheckedChange={(on) => void onChange(m, { exposed: on })} />
          <span>{m.exposed ? COPY.shown : !m.is_chat ? COPY.notChat : m.status === 'missing' ? COPY.missing : COPY.hidden}</span>
        </div>
        <div className="drow">
          <Button size="sm" disabled={busy || !m.exposed || m.is_default} onClick={() => onChange(m, { is_default: true }, COPY.done.defaultChanged(m.label))}>
            {m.is_default ? COPY.isDefault : COPY.makeDefault}
          </Button>
          {m.status === 'present' && (
            <span className="dord">
              <span title={COPY.orderIn(providerName(m))}>{COPY.order} <b className="ui-num">{at + 1}</b> / {total}</span>
              <IconButton size="sm" icon="arrow-up" label={COPY.moveUp} disabled={busy || !prev} onClick={() => prev && onChange(m, { order: prev.order })} />
              <IconButton size="sm" icon="arrow-down" label={COPY.moveDown} disabled={busy || !next} onClick={() => next && onChange(m, { order: next.order })} />
            </span>
          )}
        </div>
      </section>

      <section className="dpart">
        <h3>{COPY.partHealth}</h3>
        <Health m={m} busy={busy} onProbe={onProbe} now={now} label={COPY.probe} wide fixUrl={gateway?.ui_url || undefined} />
      </section>

      <section className="dpart">
        <h3>{COPY.partGateway} <span className="dhint">{COPY.readOnly}</span></h3>
        <KeyValue variant="plain" className="dkv" items={[
          { key: 'provider', label: kv.provider, value: [providerName(m), ...m.provider_ids.slice(1).map((p) => providerLabel(p))].join(' · ') },
          { key: 'source', label: kv.source, value: m.source ? SOURCE[m.source].long : kv.unknownSource },
          { key: 'features', label: kv.features, value: ginfo.join(' · ') || '—' },
          { key: 'maxOut', label: kv.maxOut, value: tokens(m.max_output_tokens) ?? '—' },
          { key: 'price', label: kv.price, value: price ? kv.priceUnit(price) : '—', mono: true },
          { key: 'first', label: kv.firstSeen, value: ago(m.first_seen, now) ?? '—' },
          { key: 'last', label: kv.lastSeen, value: ago(m.last_seen, now) ?? '—' },
        ]} />
      </section>
    </>
  );
}
