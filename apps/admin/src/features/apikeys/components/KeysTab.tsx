// 사용자와 조직 › API 키 탭 (ADR-0017) = 정책 카드 (허용 · 기본 / 최대 만료 · 기본 한도) + 전체 키 표 (사용자 · 이름 · hint · 이번 달 ·
// 한도 · 마지막 사용 · 만료 · 상태 · [한도] [폐기]). 키 값은 여기서도 안 보인다 (hint 뿐)
import { useEffect, useState } from 'react';
import {
  Badge, Button, Card, CardHeader, Dialog, Field, Input, Switch, Table, Toolbar, ToolbarSpacer, formatCompact, formatNumber, type Column, type Tone,
} from '@brewai/ui';
import { ConfirmDialog, Count, ListEmpty, Muted, NameCell } from '../../../shared/components/parts';
import { ago } from '../../../shared/format';
import type { AdminKey, KeyStatus, Limits, Policy } from '../api';
import { KEYS_COPY as C } from '../copy';
import { useAdminKeys, type AdminKeysApi } from '../hooks';
import '../keys.css';

const TONE: Record<KeyStatus, Tone> = { active: 'ok', expired: 'neutral', revoked: 'neutral' };
const usd = (v: number | null) => (v === null ? '$0' : v >= 100 ? `$${formatNumber(Math.round(v))}` : `$${v.toFixed(v >= 1 ? 2 : 4)}`);
const lim = (v: number | null, f: (n: number) => string) => (v ? f(v) : C.unlimited);
export const limitsLine = (l: Limits) => C.limitsLine(lim(l.rpm, formatNumber), lim(l.tokens_per_day, formatCompact), lim(l.usd_per_month, usd));
const date = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${String(d.getFullYear()).slice(2)}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

// 숫자 칸 글 ↔ 값 (빈칸 = 무제한 = null · 잘못된 글 = undefined)
const toText = (v: number | null) => (v === null ? '' : String(v));
function toNum(s: string): number | null | undefined {
  const t = s.trim().replace(/,/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export default function KeysTab() {
  const api = useAdminKeys();
  const [editing, setEditing] = useState<AdminKey | null>(null);
  const [revoking, setRevoking] = useState<AdminKey | null>(null);
  const keys = api.data?.keys ?? [];

  const columns: Column<AdminKey>[] = [
    { key: 'user', header: C.col.user, rowHeader: true, cell: (k) => <NameCell person name={k.user.name} sub={k.user.email} /> },
    { key: 'name', header: C.col.name, cell: (k) => <span className="ui-ell">{k.name}</span> },
    { key: 'key', header: C.col.key, hideBelow: 'lg', cell: (k) => <code className="akey-hint">{k.hint}</code> },
    { key: 'month', header: C.col.month, cell: (k) => <span className="ui-num">{C.month(formatNumber(k.month.runs), formatCompact(k.month.tokens), usd(k.month.cost_usd))}</span> },
    {
      key: 'limits', header: C.col.limits, hideBelow: 'md',
      cell: (k) => <span className="akey-limits">{limitsLine(k.limits)}{k.custom.length > 0 && <Badge size="sm" tone="accent" variant="outline">{C.custom}</Badge>}</span>,
    },
    { key: 'used', header: C.col.used, hideBelow: 'lg', cell: (k) => (k.last_used_at ? ago(k.last_used_at) : <Muted>{C.never}</Muted>) },
    { key: 'expires', header: C.col.expires, hideBelow: 'lg', cell: (k) => date(k.expires_at) },
    { key: 'state', header: C.col.state, cell: (k) => <Badge dot size="sm" tone={TONE[k.status]}>{C.status[k.status]}</Badge> },
    {
      key: 'action', header: <span className="ui-sr">{C.col.action}</span>, align: 'end',
      cell: (k) => k.status === 'active' && (
        <span className="akey-act">
          <Button size="sm" variant="ghost" aria-label={C.editLimitsLabel(k.name)} disabled={api.busy !== null} onClick={() => setEditing(k)}>{C.editLimits}</Button>
          <Button size="sm" variant="ghost" aria-label={C.revokeLabel(k.name)} disabled={api.busy !== null} onClick={() => setRevoking(k)}>{C.revoke}</Button>
        </span>
      ),
    },
  ];

  return (
    <div className="part-stack">
      {api.data && <PolicyCard policy={api.data.policy} api={api} />}
      <Toolbar>
        <b className="akey-title">{C.table}</b>
        {api.state.kind === 'ok' && <Count>{C.count(keys.length)}</Count>}
        <ToolbarSpacer />
      </Toolbar>
      <Table label={C.table} columns={columns} rows={keys} rowKey={(k) => k.id} loading={api.state.kind === 'loading'}
        rowState={(k) => (k.status === 'active' ? undefined : 'inactive')}
        empty={<ListEmpty state={api.state} filtered={false} icon="lock" empty={C.empty} emptyHow={C.emptyHow} noMatch={C.empty} onRetry={api.reload} />} />
      <LimitsDialog k={editing} api={api} onClose={() => setEditing(null)} />
      <ConfirmDialog open={revoking !== null} title={revoking ? C.revokeTitle(revoking.name) : ''} confirm={C.revoke} busy={api.busy !== null}
        onClose={() => setRevoking(null)} onConfirm={() => revoking && void api.revoke(revoking).then(() => setRevoking(null))}>
        {C.revokeBody}
      </ConfirmDialog>
    </div>
  );
}

function LimitFields({ value, onChange }: { value: Record<keyof Limits, string>; onChange: (v: Record<keyof Limits, string>) => void }) {
  const put = (k: keyof Limits) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="akey-grid">
      <Field label={C.rpm} hint={C.unlimitedHint}><Input inputMode="numeric" value={value.rpm} onChange={put('rpm')} /></Field>
      <Field label={C.tokens} hint={C.unlimitedHint}><Input inputMode="numeric" value={value.tokens_per_day} onChange={put('tokens_per_day')} /></Field>
      <Field label={C.usd} hint={C.unlimitedHint}><Input inputMode="decimal" value={value.usd_per_month} onChange={put('usd_per_month')} /></Field>
    </div>
  );
}
const textOf = (l: Limits) => ({ rpm: toText(l.rpm), tokens_per_day: toText(l.tokens_per_day), usd_per_month: toText(l.usd_per_month) });
function limitsOfText(v: Record<keyof Limits, string>): Limits | null {
  const out = { rpm: toNum(v.rpm), tokens_per_day: toNum(v.tokens_per_day), usd_per_month: toNum(v.usd_per_month) };
  return Object.values(out).some((x) => x === undefined) ? null : (out as Limits);
}

function PolicyCard({ policy, api }: { policy: Policy; api: AdminKeysApi }) {
  const [days, setDays] = useState({ d: String(policy.default_days), m: String(policy.max_days) });
  const [limits, setLimits] = useState(textOf(policy.limits));
  useEffect(() => {
    setDays({ d: String(policy.default_days), m: String(policy.max_days) });
    setLimits(textOf(policy.limits));
  }, [policy]);
  const parsed = limitsOfText(limits);
  const d = Number(days.d);
  const m = Number(days.m);
  const okDays = Number.isInteger(d) && Number.isInteger(m) && d >= 1 && m >= d && m <= 3650;
  return (
    <Card as="section" padding="lg" aria-labelledby="akey-policy">
      <CardHeader level={2} title={<span id="akey-policy">{C.policy}</span>} description={C.policyHint}
        actions={<Switch checked={policy.enabled} label={C.enabled} title={C.enabledHint} disabled={api.busy === 'policy'}
          onCheckedChange={(on) => void api.savePolicy({ enabled: on })} />} />
      <div className="akey-form">
        <div className="akey-grid">
          <Field label={C.defaultDays}><Input inputMode="numeric" value={days.d} onChange={(e) => setDays({ ...days, d: e.target.value })} /></Field>
          <Field label={C.maxDays}><Input inputMode="numeric" value={days.m} onChange={(e) => setDays({ ...days, m: e.target.value })} /></Field>
        </div>
        <LimitFields value={limits} onChange={setLimits} />
        <div className="akey-save">
          <Button variant="primary" loading={api.busy === 'policy'} disabled={!parsed || !okDays}
            onClick={() => parsed && void api.savePolicy({ default_days: d, max_days: m, limits: parsed })}>{C.save}</Button>
        </div>
      </div>
    </Card>
  );
}

function LimitsDialog({ k, api, onClose }: { k: AdminKey | null; api: AdminKeysApi; onClose: () => void }) {
  const [value, setValue] = useState(textOf(k?.limits ?? { rpm: null, tokens_per_day: null, usd_per_month: null }));
  useEffect(() => {
    if (k) setValue(textOf(k.limits));
  }, [k]);
  const parsed = limitsOfText(value);
  const busy = k !== null && api.busy === k.id;
  const save = (limits: Limits | null) => k && void api.setLimits(k, limits).then((ok) => ok && onClose());
  return (
    <Dialog open={k !== null} onClose={onClose} title={k ? C.limitsTitle(k.name) : ''} description={C.limitsBody} dismissible={!busy}
      footer={<>
        <Button variant="ghost" disabled={busy} onClick={() => save(null)}>{C.toDefault}</Button>
        <span className="grow" />
        <Button variant="primary" loading={busy} disabled={!parsed} onClick={() => parsed && save(parsed)}>{C.save}</Button>
      </>}>
      <LimitFields value={value} onChange={setValue} />
    </Dialog>
  );
}
