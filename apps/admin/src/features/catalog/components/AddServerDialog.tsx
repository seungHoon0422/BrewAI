import { useEffect, useId, useState } from 'react';
import { Button, Callout, Checkbox, Dialog, Field, Input, KeyValue, LinkButton, PasswordInput, Select } from '@brewai/ui';
import { COMMON_COPY } from '../../../shared/copy';
import type { ClientIn, McpPreset, NewServer } from '../api';
import { ADD_COPY as C, AUTH_METHODS, AUTH_TEXT, PRESET_COPY } from '../copy';
import { useMcpPresets, type AddResult } from '../hooks';
import { serverHref } from '../route';
import { PresetPicker } from './PresetPicker';
import { WriteBadge } from './ServerBits';

// 전체 공통 서버 추가 = 주소(+ 이름 · 한 줄 설명 · 찾을 때 쓸 말 · 부르는 이름) → conductor 가 찾아서 저장 → 찾은 내용 (로그인 방식 · 도구 · 예상 토큰 · 에이전트가 보는 줄).
// 사전 등록 OAuth client (선택) = 저장 직후 PUT oauth-client · secret 은 conductor 금고에만 (이 화면은 보내기만, 다시 읽지 않는다)
// 추천 서버 (위) = 누르면 주소 · 이름 · 설명 · 부르는 이름을 채운다. 고른 상태 = 지금 주소와 같은 추천 (주소를 고치면 풀리고, 추천이 채운 부르는 이름도 지운다)
export const splitList = (text: string) => text.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

type Method = ClientIn['auth_method'];

export function AddServerDialog({ open, busy, onAdd, onClose }: {
  open: boolean;
  busy: boolean;
  onAdd: (body: NewServer, client: ClientIn | null) => Promise<AddResult | null>;
  onClose: () => void;
}) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [aliases, setAliases] = useState('');
  const [handle, setHandle] = useState('');
  const [withClient, setWithClient] = useState(false);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [method, setMethod] = useState<NonNullable<Method>>('none');
  const [result, setResult] = useState<AddResult | null>(null);
  const formId = useId();
  const presets = useMcpPresets(open);
  const picked = presets.data?.find((p) => p.url === url.trim() && p.available && !p.added) ?? null;
  const [filled, setFilled] = useState<McpPreset | null>(null); // 칸을 채운 추천 (주소를 고치면 그 추천의 부르는 이름은 지운다)
  const pick = (p: McpPreset) => {
    setUrl(p.url); setName(p.name); setDesc(p.description.slice(0, 80)); setHandle(p.handle); setFilled(p);
  };
  const editUrl = (value: string) => {
    setUrl(value);
    if (filled && value.trim() !== filled.url) {
      if (handle === filled.handle) setHandle(''); // 다른 서버에 추천의 이름이 붙지 않게
      setFilled(null);
    }
  };

  useEffect(() => {
    if (!open) return;
    setUrl(''); setName(''); setDesc(''); setAliases(''); setHandle(''); setFilled(null);
    setWithClient(false); setClientId(''); setSecret(''); setMethod('none'); setResult(null);
  }, [open]);

  const ok = url.trim().length > 0 && (!withClient || clientId.trim().length > 0);
  const submit = async () => {
    if (!ok || busy) return;
    const body: NewServer = { url: url.trim() };
    if (name.trim()) body.name = name.trim();
    if (desc.trim()) body.description = desc.trim();
    const list = splitList(aliases);
    if (list.length) body.aliases = list;
    if (handle.trim()) body.handle = handle.trim();
    const client: ClientIn | null = withClient
      ? { client_id: clientId.trim(), ...(secret ? { client_secret: secret } : {}), auth_method: secret && method === 'none' ? 'client_secret_post' : method }
      : null;
    const r = await onAdd(body, client);
    setSecret(''); // 화면 메모리에도 오래 두지 않는다
    if (r) setResult(r);
  };

  if (result) return <AddedDialog open={open} result={result} onClose={onClose} />;

  return (
    <Dialog open={open} onClose={onClose} title={C.title} description={C.desc} dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{COMMON_COPY.cancel}</Button>
          <Button type="submit" form={formId} variant="primary" loading={busy} disabled={!ok}>{busy ? C.finding : C.submit}</Button>
        </>
      }>
      <form id={formId} className="part-stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <PresetPicker load={presets.state} pickedId={picked?.id ?? null} onPick={pick} />
        {picked && (
          <p className="mcp-preset-picked" role="status">
            <span>{PRESET_COPY.picked(picked.name)}</span>
            {picked.note && <span className="mcp-preset-note">{picked.note}</span>}
            <a href={picked.docs_url} target="_blank" rel="noreferrer noopener">{PRESET_COPY.docs}</a>
          </p>
        )}
        <Field label={C.url} hint={C.urlHint} required>
          <Input type="url" value={url} autoFocus inputMode="url" spellCheck={false} placeholder={C.urlPlaceholder} maxLength={2048}
            onChange={(e) => editUrl(e.target.value)} />
        </Field>
        <Field label={C.name} hint={C.nameHint}>
          <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={C.description} hint={C.descriptionHint(desc.length)}>
          <Input value={desc} maxLength={80} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <Field label={C.aliases} hint={C.aliasesHint}>
          <Input value={aliases} maxLength={300} onChange={(e) => setAliases(e.target.value)} />
        </Field>
        <Field label={C.handle} hint={C.handleHint}>
          <Input value={handle} maxLength={20} spellCheck={false} pattern="[a-z0-9_]{2,20}" onChange={(e) => setHandle(e.target.value.toLowerCase())} />
        </Field>
        <Checkbox label={C.client} description={C.clientHint} checked={withClient} onChange={(e) => setWithClient(e.target.checked)} />
        {withClient && (
          <div className="mcp-client-fields">
            <Field label={C.clientId} required>
              <Input value={clientId} maxLength={400} spellCheck={false} autoComplete="off" onChange={(e) => setClientId(e.target.value)} />
            </Field>
            <Field label={C.clientSecret} hint={C.clientSecretHint}>
              <PasswordInput value={secret} maxLength={1000} autoComplete="new-password" onChange={(e) => setSecret(e.target.value)} />
            </Field>
            <Field label={C.clientMethod}>
              <Select options={AUTH_METHODS} value={method} onChange={(v) => setMethod(v as NonNullable<Method>)} />
            </Field>
          </div>
        )}
      </form>
    </Dialog>
  );
}

// 찾은 내용 = 로그인 방식 · 도구 수(쓰기) · 예상 토큰 · 부르는 이름 + 에이전트가 보는 줄
function AddedDialog({ open, result, onClose }: { open: boolean; result: AddResult; onClose: () => void }) {
  const { server: s, preview: p } = result;
  const tools = p?.tool_count ?? s.tool_count;
  const writes = p?.write_count ?? s.write_count;
  const tokens = p?.tokens_est ?? s.tool_tokens_est;
  const issuer = p?.issuer_domain ?? s.issuer_domain;
  const line = p?.prompt_line || s.prompt_line;
  return (
    <Dialog open={open} onClose={onClose} title={C.doneTitle} description={C.doneDesc(s.name)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{C.close}</Button>
          <LinkButton variant="primary" href={serverHref(s.id)} onClick={onClose}>{C.open}</LinkButton>
        </>
      }>
      <div className="part-stack mcp-found" aria-label={C.found}>
        <KeyValue variant="plain" className="mcp-kv" items={[
          { key: 'auth', label: C.kv.auth, value: C.authLine(AUTH_TEXT[s.auth], issuer) },
          {
            key: 'tools', label: C.kv.tools,
            value: <span className="mcp-inline">{C.toolsLine(tools, writes)}{writes ? <WriteBadge /> : null}</span>,
          },
          { key: 'tokens', label: C.kv.tokens, value: C.tokensLine(tokens) },
          { key: 'handle', label: C.kv.handle, value: <code>{s.handle}</code> },
        ]} />
        {line && (
          <div className="mcp-line">
            <span className="mcp-line-label">{C.lineLabel}</span>
            <code className="mcp-line-code">{line}</code>
          </div>
        )}
        {result.client === 'saved' && <Callout tone="ok">{C.clientSaved}</Callout>}
        {result.client === 'skipped' && <Callout>{C.clientSkipped}</Callout>}
        {result.client === 'failed' && <Callout tone="danger">{C.clientFailed(result.clientError ?? '')}</Callout>}
      </div>
    </Dialog>
  );
}
