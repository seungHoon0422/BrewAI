import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  Button, Callout, Card, CardHeader, EmptyState, Field, Input, KeyValue, LinkButton, Meta, PageHeader, PasswordInput, Select, Skeleton, Switch,
} from '@brewai/ui';
import { ConfirmDialog } from '../../../shared/components/parts';
import { COMMON_COPY, LOAD_FAILED } from '../../../shared/copy';
import { ago, dateTimeText } from '../../../shared/format';
import type { AdminServer, ClientIn, OAuthClient } from '../api';
import { AUTH_METHODS, CLIENT_SOURCE, MCP_COPY, PAGE_COPY as C } from '../copy';
import { testCodeText, useMcpServer, useNow } from '../hooks';
import { catalogTabHref } from '../route';
import { splitList } from './AddServerDialog';
import { AuthText, OriginBadge, StatusBadge, WriteBadge } from './ServerBits';
import { ServerIcon } from './ServerIcon';
import { TestCell } from './TestCell';
import { ToolTable } from './ToolTable';

const F = C.field;

// MCP 서버 자세히 ('#/catalog/mcp/<id>' — 링크로 바로 · 뒤로 · 앞으로). 위 줄(← 목록 · 세션)은 틀(App.tsx)이 그린다.
// 머리 = 서버 아이콘 · 이름(h1) / 주소 · 딱지 · 오른쪽에 [사용] [연결 테스트] [삭제]. 몸 = 두 칸 (≥1100 · 좁으면 한 칸):
// 왼쪽 = 에이전트가 보는 목록 한 줄 + 토큰 · 연결 / 오른쪽 = 정보(이름 · 설명 · 찾을 때 쓸 말 · 부르는 이름) · 사전 등록 OAuth client. 아래 = 도구 표 (가득)
// 사용자 추가 서버도 같은 페이지 (정의는 주인 것 → 읽기 전용 · 끄기만)
export function ServerPage({ id }: { id: string }) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const api = useMcpServer(id);
  const now = useNow();
  const [removing, setRemoving] = useState(false);
  const { server } = api;

  if (server.state.kind === 'loading') {
    return (
      <div className="mcp-page">
        <PageHeader divider className="mcp-head" titleRef={h1} title={id} description={C.loading} />
        <Skeleton lines={4} />
      </div>
    );
  }
  if (server.state.kind === 'error') {
    return (
      <div className="mcp-page">
        <PageHeader divider className="mcp-head" titleRef={h1} title={id} />
        <Callout tone="danger" icon="plug" action={<Button size="sm" onClick={server.reload}>{COMMON_COPY.retry}</Button>}>
          <span role="alert">{LOAD_FAILED[server.state.error]}</span>
        </Callout>
      </div>
    );
  }
  const s = server.state.data;
  if (!s) return <ServerMissing id={id} />;
  const user = s.origin === 'user';
  const busy = api.busy;

  return (
    <div className="mcp-page" data-server={s.id}>
      <PageHeader divider className="mcp-head" titleRef={h1} icon={<ServerIcon id={s.id} name={s.name} size="md" />}
        title={s.name}
        meta={<span className="mcp-tags"><StatusBadge status={s.status} /><OriginBadge origin={s.origin} /></span>}
        description={<code className="mcp-url">{s.url}</code>}
        actions={
          <div className="mcp-head-act">
            <Switch checked={s.status === 'active'} label={C.enabled} title={C.enabledTitle} className="mcp-head-sw" disabled={busy === 'status'}
              onCheckedChange={(on) => void api.setStatus(s, on ? 'active' : 'disabled', on ? C.done.enabled(s.name) : C.done.disabled(s.name))} />
            <span className="mcp-head-sep" aria-hidden="true" />
            <TestCell s={s} test={api.testOf(s.id)} now={now} onTest={api.test} head />
            {!user && (
              <Button size="sm" variant="danger" icon="trash" disabled={busy !== null} onClick={() => setRemoving(true)}>{C.remove}</Button>
            )}
          </div>
        } />

      <div className="mcp-grid">
        <div className="mcp-col">
          <LineCard s={s} />
          <ConnCard s={s} now={now} />
        </div>
        <div className="mcp-col">
          {user ? <UserInfoCard s={s} /> : (
            <InfoCard s={s} busy={busy === 'server'} onSave={(patch) => void api.change(patch, C.saved)} />
          )}
          {!user && s.auth === 'oauth' && (
            <ClientCard client={s.oauth_client} busy={busy === 'client'} onSave={(body) => api.setClient(body, C.clientSavedToast)} />
          )}
        </div>
      </div>
      <Part title={C.partTools} hint={C.toolsHint}
        actions={api.tools.data?.fetched_at ? <span className="mcp-sub">{C.toolsFetched(ago(api.tools.data.fetched_at, now) ?? '')}</span> : undefined}>
        {api.tools.state.kind === 'error' ? (
          <Callout tone="danger" icon="plug" action={<Button size="sm" onClick={api.tools.reload}>{COMMON_COPY.retry}</Button>}>
            <span role="alert">{LOAD_FAILED[api.tools.state.error]}</span>
          </Callout>
        ) : (
          <ToolTable load={api.tools.state} busy={busy} readOnly={user} onChange={(patch, done) => void api.setTool(patch, done)} />
        )}
        {!user && (api.tools.data?.tools.length ?? 0) > 0 && <p className="mcp-foot">{C.approvalNote}</p>}
      </Part>

      <ConfirmDialog open={removing} title={C.removeTitle(s.name)} confirm={C.removeConfirm} busy={busy === 'remove'}
        onClose={() => setRemoving(false)}
        onConfirm={async () => {
          if ((await api.remove(C.done.removed(s.name))) !== null) window.location.assign(catalogTabHref('mcp'));
          setRemoving(false);
        }}>
        {C.removeBody}
      </ConfirmDialog>
    </div>
  );
}

// 없는 서버 (404) = 목록으로 안내
function ServerMissing({ id }: { id: string }) {
  const h1 = useRef<HTMLHeadingElement>(null);
  return (
    <div className="mcp-page">
      <PageHeader divider className="mcp-head" titleRef={h1} title={C.notFound} description={<code className="mcp-url">{id}</code>} />
      <EmptyState icon="search" title={C.notFoundWhy}
        action={<LinkButton size="sm" icon="chevron-left" href={catalogTabHref('mcp')}>{C.toList}</LinkButton>}>
        {C.notFoundHow}
      </EmptyState>
    </div>
  );
}

// 카드 하나 = section (이름 = 카드 제목 · E2E 가 이름으로 찾는다)
function Part({ title, hint, actions, children }: { title: string; hint?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <Card as="section" padding="lg" className="mcp-card" aria-labelledby={id}>
      <CardHeader level={2} title={<span id={id}>{title}</span>} description={hint} actions={actions} />
      <div className="mcp-card-body">{children}</div>
    </Card>
  );
}

// 에이전트가 보는 목록 한 줄 (대화마다 · 약 N토큰) + 도구 정의 전체 (다 보내면 · 보내지 않음)
function LineCard({ s }: { s: AdminServer }) {
  return (
    <Part title={C.partLine} hint={C.lineHint}>
      <code className="mcp-line-code" data-testid="prompt-line">{s.prompt_line}</code>
      <Meta wrap className="mcp-line-meta" items={[
        <span key="t" className="ui-num">{C.lineTokens(s.prompt_tokens)}</span>,
        C.lineEvery,
      ]} />
      <KeyValue variant="plain" className="mcp-kv" items={[
        {
          key: 'tools', label: C.kv.tools,
          value: s.tool_count === null ? <span className="mcp-nil">{MCP_COPY.afterLogin}</span> : (
            <span className="mcp-inline">
              <span className="ui-num">{s.tool_count}</span>
              {s.write_count ? <><span>{MCP_COPY.writeCount(s.write_count)}</span><WriteBadge /></> : null}
            </span>
          ),
        },
        {
          key: 'all', label: C.allTools,
          value: s.tool_tokens_est === null ? <span className="mcp-nil">{MCP_COPY.afterLogin}</span> : (
            <Meta wrap items={[<span key="n" className="ui-num">{MCP_COPY.tokens(s.tool_tokens_est)}</span>, <span key="h" className="mcp-sub">{C.allToolsHint}</span>]} />
          ),
        },
      ]} />
    </Part>
  );
}

// 정보 = 이름 · 에이전트가 읽는 한 줄 설명(80자) · 찾을 때 쓸 말 · 부르는 이름 → 바뀐 칸만 PATCH. 주소는 못 바꾼다
function InfoCard({ s, busy, onSave }: { s: AdminServer; busy: boolean; onSave: (patch: { name?: string; description?: string; aliases?: string[]; handle?: string }) => void }) {
  const [name, setName] = useState(s.name);
  const [desc, setDesc] = useState(s.description);
  const [aliases, setAliases] = useState(s.aliases.join(', '));
  const [handle, setHandle] = useState(s.handle);
  const formId = useId();
  useEffect(() => {
    setName(s.name);
    setDesc(s.description);
    setAliases(s.aliases.join(', '));
    setHandle(s.handle);
  }, [s.name, s.description, s.aliases, s.handle]);

  const list = splitList(aliases);
  const patch: { name?: string; description?: string; aliases?: string[]; handle?: string } = {};
  if (name.trim() && name.trim() !== s.name) patch.name = name.trim();
  if (desc.trim() !== s.description) patch.description = desc.trim();
  if (list.join('\n') !== s.aliases.join('\n')) patch.aliases = list;
  if (handle.trim() && handle.trim() !== s.handle) patch.handle = handle.trim();
  const dirty = Object.keys(patch).length > 0;

  return (
    <Part title={C.partInfo} hint={C.infoHint}>
      <form id={formId} className="part-stack" onSubmit={(e) => { e.preventDefault(); if (dirty) onSave(patch); }}>
        <Field label={C.urlLabel} hint={s.url_redacted ? C.urlMasked : C.urlFixed}>
          <Input value={s.url} readOnly />
        </Field>
        <Field label={F.name} required>
          <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={F.description} hint={F.descriptionHint(desc.length)}>
          <Input value={desc} maxLength={80} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <Field label={F.aliases} hint={F.aliasesHint}>
          <Input value={aliases} maxLength={300} onChange={(e) => setAliases(e.target.value)} />
        </Field>
        <Field label={F.handle} hint={F.handleHint}>
          <Input value={handle} maxLength={20} spellCheck={false} onChange={(e) => setHandle(e.target.value.toLowerCase())} />
        </Field>
        <div className="mcp-actions">
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!dirty}>{C.save}</Button>
        </div>
      </form>
    </Part>
  );
}

// 사용자 추가 서버 = 읽기 전용 (주인 · 설명 · 찾을 때 쓸 말 · 부르는 이름)
function UserInfoCard({ s }: { s: AdminServer }) {
  return (
    <Part title={C.partInfo} hint={C.userInfoHint}>
      <KeyValue variant="plain" className="mcp-kv" items={[
        { key: 'desc', label: F.plainDescription, value: s.description || C.none },
        { key: 'aliases', label: F.aliases, value: s.aliases.length ? s.aliases.join(', ') : C.none },
        { key: 'handle', label: F.handle, value: <code>{s.handle}</code> },
      ]} />
    </Part>
  );
}

// 연결 = 로그인 방식 · 로그인 서버 · 연결한 사람 수(인증정보는 개수만) · 마지막 확인 · 마지막 오류
function ConnCard({ s, now }: { s: AdminServer; now: number }) {
  const k = C.kv;
  return (
    <Part title={C.partConn} hint={C.connHint}>
      <KeyValue variant="plain" className="mcp-kv" items={[
        { key: 'auth', label: k.auth, value: <AuthText s={s} /> },
        ...(s.auth === 'oauth' ? [{ key: 'issuer', label: k.issuer, value: s.issuer_domain ?? C.none }] : []),
        { key: 'people', label: k.people, value: <span className="ui-num">{MCP_COPY.people(s.connected_count)}</span> },
        { key: 'checked', label: k.checked, value: <span title={dateTimeText(s.last_checked_at) ?? undefined}>{ago(s.last_checked_at, now) ?? MCP_COPY.never}</span> },
        { key: 'error', label: k.error, value: s.last_error ? testCodeText(s.last_error) : C.none },
      ]} />
    </Part>
  );
}

// 사전 등록 OAuth client = 지금 값(출처 · client ID · 비밀값 있음/없음 · 방식 · scope) + 새로 넣기. 비밀값은 보내기만 (다시 안 보인다)
function ClientCard({ client, busy, onSave }: { client: OAuthClient | null; busy: boolean; onSave: (body: ClientIn) => Promise<unknown> }) {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [method, setMethod] = useState<NonNullable<ClientIn['auth_method']>>('none');
  const [scope, setScope] = useState('');
  const formId = useId();
  useEffect(() => {
    setClientId(client?.source === 'preregistered' ? client.client_id : '');
    const m = client?.auth_method;
    setMethod(m === 'client_secret_post' || m === 'client_secret_basic' ? m : 'none');
    setScope(client?.scope ?? '');
  }, [client]);
  const ok = clientId.trim().length > 0;
  return (
    <Part title={C.partClient} hint={C.clientHint}>
      <KeyValue variant="plain" className="mcp-kv" items={[
        {
          key: 'now', label: C.clientNow,
          value: client ? (
            <Meta wrap items={[CLIENT_SOURCE[client.source], <code key="id">{client.client_id}</code>, client.has_secret ? C.clientSecretSaved : C.clientSecretNone]} />
          ) : <span className="mcp-sub">{C.clientNone}</span>,
        },
      ]} />
      <form id={formId} className="part-stack" onSubmit={async (e) => {
        e.preventDefault();
        if (!ok) return;
        const body: ClientIn = { client_id: clientId.trim(), auth_method: secret && method === 'none' ? 'client_secret_post' : method };
        if (secret) body.client_secret = secret;
        if (scope.trim()) body.scope = scope.trim();
        await onSave(body);
        setSecret('');
      }}>
        <Field label={F.clientId} required>
          <Input value={clientId} maxLength={400} spellCheck={false} autoComplete="off" onChange={(e) => setClientId(e.target.value)} />
        </Field>
        <Field label={F.clientSecret} hint={C.clientSecretKeep}>
          <PasswordInput value={secret} maxLength={1000} autoComplete="new-password" onChange={(e) => setSecret(e.target.value)} />
        </Field>
        <Field label={C.clientMethod}>
          <Select options={AUTH_METHODS} value={method} onChange={(v) => setMethod(v as NonNullable<ClientIn['auth_method']>)} />
        </Field>
        <Field label={C.clientScope} hint={C.clientScopeHint}>
          <Input value={scope} maxLength={1000} spellCheck={false} onChange={(e) => setScope(e.target.value)} />
        </Field>
        <div className="mcp-actions">
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!ok}>{C.clientSave}</Button>
        </div>
      </form>
    </Part>
  );
}
