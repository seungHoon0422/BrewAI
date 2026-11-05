// 설정 › API 키 (ADR-0017) — 한도 (조직 정책) · 내 키 표 (이름 · hint · 범위 · 이번 달 · 마지막 사용 · 만료 · 상태 · 폐기) ·
// [새 키 만들기] → 이름 · 범위 · 만료 → 키를 한 번만 보여 주는 창 (복사 · 예시). 키 값은 그 창을 닫으면 화면 어디에도 남지 않는다
import { useEffect, useState } from 'react';
import {
  Badge, Button, Callout, Checkbox, Dialog, Field, Input, Select, Skeleton, Table, formatCompact, formatNumber, type Column,
} from '@brewai/ui';
import { codeOf, isAbort } from '../../../lib/api';
import { Page, Section } from '../../shell/components/Page';
import { createKey, listKeys, revokeKey, v1Base, type ApiKey, type KeysState, type Limits, type Scope } from '../api';
import { KEYS, SCOPE_LABEL, keyError } from '../copy';

const DAY_CHOICES = [30, 90, 180, 365];
const usd = (v: number | null) => (v === null ? '$0' : v >= 100 ? `$${formatNumber(Math.round(v))}` : `$${v.toFixed(v >= 1 ? 2 : 4)}`);
const date = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${String(d.getFullYear()).slice(2)}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

export function limitsText(l: Limits): string[] {
  return [
    l.rpm ? KEYS.rpm(formatNumber(l.rpm)) : `${KEYS.rpm(KEYS.unlimited)}`,
    l.tokens_per_day ? KEYS.perDay(formatCompact(l.tokens_per_day)) : KEYS.perDay(KEYS.unlimited),
    l.usd_per_month ? KEYS.perMonth(usd(l.usd_per_month)) : KEYS.perMonth(KEYS.unlimited),
  ];
}

export function KeysScreen() {
  const [state, setState] = useState<KeysState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [made, setMade] = useState<{ key: string; item: ApiKey } | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    listKeys(ctl.signal).then(setState, (e) => {
      if (!isAbort(e)) setError(keyError(codeOf(e)));
    });
    return () => ctl.abort();
  }, [tick]);

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await revokeKey(revoking.id);
      setRevoking(null);
      setTick((x) => x + 1);
    } catch (e) {
      setError(keyError(codeOf(e)));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<ApiKey>[] = [
    { key: 'name', header: KEYS.col.name, rowHeader: true, cell: (k) => <span className="ui-ell">{k.name}</span> },
    { key: 'key', header: KEYS.col.key, cell: (k) => <code className="key-hint">{k.hint}</code>, width: '160px' },
    { key: 'scopes', header: KEYS.col.scopes, hideBelow: 'lg',
      cell: (k) => <span className="key-scopes">{k.scopes.map((s) => <Badge key={s} size="sm" variant="outline">{SCOPE_LABEL[s].label}</Badge>)}</span> },
    { key: 'month', header: KEYS.col.month, width: '110px', cell: (k) => <span className="ui-num">{KEYS.month(formatNumber(k.month.runs), usd(k.month.cost_usd))}</span> },
    { key: 'used', header: KEYS.col.used, width: '110px', hideBelow: 'md', cell: (k) => (k.last_used_at ? date(k.last_used_at) : <span className="key-muted">{KEYS.never}</span>) },
    { key: 'expires', header: KEYS.col.expires, width: '110px', hideBelow: 'md', cell: (k) => date(k.expires_at) },
    {
      key: 'status', header: KEYS.col.status, width: '150px', align: 'end',
      cell: (k) => (
        <span className="key-act">
          <Badge size="sm" tone={k.status === 'active' ? 'ok' : 'neutral'}>{KEYS.status[k.status]}</Badge>
          {k.status === 'active' && (
            <Button size="sm" variant="ghost" aria-label={`${KEYS.revoke} ${k.name}`} onClick={() => setRevoking(k)}>{KEYS.revoke}</Button>
          )}
        </span>
      ),
    },
  ];

  const p = state?.policy;
  return (
    <Page id="settings/keys" sub={KEYS.sub}>
      {error && <Callout tone="danger" live onDismiss={() => setError(null)}>{error}</Callout>}
      {!state || !p ? (
        !error && <Skeleton lines={4} />
      ) : (
        <>
          {!p.enabled && <Callout tone="warn">{KEYS.off}</Callout>}
          <div className="keys-bar">
            <div className="keys-limits">
              <b>{KEYS.limitsTitle}</b>
              <span>{limitsText(p.limits).join(', ')}</span>
              <span className="key-muted">{KEYS.limitsHint}</span>
            </div>
            <Button variant="primary" icon="plus" disabled={!p.enabled} onClick={() => setCreating(true)}>{KEYS.create}</Button>
          </div>
          <Section title={KEYS.list}>
            <Table label={KEYS.list} columns={columns} rows={state.keys} rowKey={(k) => k.id} density="compact"
              rowState={(k) => k.status} empty={<span className="key-muted">{KEYS.empty}</span>} />
          </Section>
        </>
      )}
      {state && (
        <CreateDialog open={creating} state={state} onClose={() => setCreating(false)}
          onMade={(m) => {
            setCreating(false);
            setMade(m);
            setTick((x) => x + 1);
          }} />
      )}
      <MadeDialog made={made} onClose={() => setMade(null)} />
      <Dialog size="sm" open={revoking !== null} onClose={() => setRevoking(null)} title={revoking ? KEYS.revokeTitle(revoking.name) : ''}
        description={KEYS.revokeBody}
        footer={<>
          <Button variant="ghost" onClick={() => setRevoking(null)}>{KEYS.cancel}</Button>
          <Button variant="danger" loading={busy} onClick={() => void revoke()}>{KEYS.revoke}</Button>
        </>} />
    </Page>
  );
}

function CreateDialog({ open, state, onClose, onMade }: {
  open: boolean; state: KeysState; onClose: () => void; onMade: (m: { key: string; item: ApiKey }) => void;
}) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(['models:read', 'chat']);
  const [days, setDays] = useState(String(state.policy.default_days));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = [...new Set([...DAY_CHOICES, state.policy.default_days])].filter((d) => d <= state.policy.max_days).sort((a, b) => a - b);

  useEffect(() => {
    if (open) {
      setName('');
      setScopes(['models:read', 'chat']);
      setDays(String(state.policy.default_days));
      setError(null);
    }
  }, [open, state.policy.default_days]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onMade(await createKey({ name: name.trim(), scopes, days: Number(days) }));
    } catch (e) {
      setError(keyError(codeOf(e)));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (s: Scope, on: boolean) => setScopes((xs) => (on ? [...xs, s] : xs.filter((x) => x !== s)));

  return (
    <Dialog open={open} onClose={onClose} title={KEYS.formTitle} dismissible={!busy}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>{KEYS.cancel}</Button>
        <Button variant="primary" loading={busy} disabled={!name.trim() || scopes.length === 0} onClick={() => void submit()}>{KEYS.make}</Button>
      </>}>
      <div className="form">
        {error && <Callout tone="danger" live>{error}</Callout>}
        <Field label={KEYS.name} required>
          <Input value={name} maxLength={60} placeholder={KEYS.namePlaceholder} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset className="key-scope-set">
          <legend>{KEYS.scopes}</legend>
          {state.scopes.map((s) => (
            <Checkbox key={s} label={SCOPE_LABEL[s].label} description={SCOPE_LABEL[s].hint} checked={scopes.includes(s)}
              onChange={(e) => toggle(s, e.target.checked)} />
          ))}
        </fieldset>
        <Field label={KEYS.expires}>
          <Select value={days} onChange={setDays} options={choices.map((d) => ({ value: String(d), label: KEYS.days(d) }))} />
        </Field>
      </div>
    </Dialog>
  );
}

function MadeDialog({ made, onClose }: { made: { key: string; item: ApiKey } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [base, setBase] = useState('/v1');
  useEffect(() => {
    setCopied(false);
    void v1Base().then(setBase);
  }, [made]);
  const copy = async () => {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const example = made
    ? `curl ${base}/chat/completions \\\n  -H "Authorization: Bearer ${made.key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "<모델 id>", "messages": [{"role": "user", "content": "안녕"}]}'`
    : '';
  return (
    <Dialog open={made !== null} onClose={onClose} title={KEYS.madeTitle} description={KEYS.madeBody}
      footer={<Button variant="primary" onClick={onClose}>{KEYS.done}</Button>}>
      {made && (
        <div className="form">
          <div className="key-once">
            <code data-testid="new-key">{made.key}</code>
            <Button size="sm" icon={copied ? 'check' : 'copy'} onClick={() => void copy()}>{copied ? KEYS.copied : KEYS.copy}</Button>
          </div>
          <div>
            <b className="key-example-title">{KEYS.example}</b>
            <pre className="key-example">{example}</pre>
          </div>
        </div>
      )}
    </Dialog>
  );
}
