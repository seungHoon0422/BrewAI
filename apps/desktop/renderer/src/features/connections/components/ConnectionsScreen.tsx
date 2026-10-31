// 연결된 앱 — 맨 위 '필요할 때 바로 로그인 화면 열기' · [내 앱] (이름 · 도메인 · 출처 배지 · 상태 · 연결 / 연결 끊기 / 숨기기) · 숨긴 앱
// · [가져올 수 있는 앱] (스페이스 경로별 가져오기) · [앱 추가] 대화상자 · 줄을 누르면 상세 서랍 (도구 · 쓰기 표시 · 공유).
// 연결 = 시스템 브라우저 로그인 (main · bridge.mcp) — 화면은 결과만 받는다. 판정은 서버 (UI 는 권한 근거 아님 · ADR-0013).
import { useEffect, useState } from 'react';
import { Badge, Button, Callout, Checkbox, Icon, Meta, StatusDot } from '@brewai/ui';
import { codeOf } from '../../../lib/api';
import { Count, Empty, Notes, Page, Section } from '../../shell/components/Page';
import { ScopeBreadcrumb } from '../../scope/components/ScopeBreadcrumb';
import { disconnectApp, importApp, patchApp, removeApp, type App, type Importable } from '../api';
import { CONNECTIONS, CONNECTION_NOTES, SOURCE_LABEL, STATE_LABEL, connError } from '../copy';
import { STATE_DOT, bump, cancelConnect, changeAutoAuth, connectApp, focusApp, loadApps, stateOf, useConnections } from '../hooks';
import { AddAppDialog } from './AddAppDialog';
import { AppSheet } from './AppSheet';

type Note = { tone: 'ok' | 'danger' | 'info'; text: string } | null;

// 로그인 화면이 앱과 다른 도메인에서 열리면 줄에 보인다 (남의 로그인으로 받은 토큰이 이 앱으로 가는 길을 사람이 볼 수 있게)
const loginOf = (x: { auth: 'oauth' | 'none'; domain: string; issuer_domain: string | null }) =>
  x.auth === 'oauth' && x.issuer_domain && x.issuer_domain !== x.domain ? CONNECTIONS.loginAt(x.issuer_domain) : null;

export function ConnectionsScreen() {
  const apps = useConnections((s) => s.apps);
  const focus = useConnections((s) => s.focus);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<Note>(null);
  useEffect(() => {
    void loadApps();
  }, []);
  const data = apps.data;
  const shown = data?.mine.filter((a) => !a.hidden) ?? [];
  const hidden = data?.mine.filter((a) => a.hidden) ?? [];
  const say = (n: Note) => setNote(n);

  return (
    <Page id="connections" sub={CONNECTIONS.sub}>
      {note && <Callout tone={note.tone} live onDismiss={() => setNote(null)} className="sec-note conn-note">{note.text}</Callout>}
      <AutoAuth value={data?.auto_auth ?? null} onError={() => say({ tone: 'danger', text: CONNECTIONS.autoAuthFailed })} />
      <Section title={CONNECTIONS.mine} extra={<>
        <Count n={shown.length} />
        <span className="sec-sp" />
        <Button size="sm" icon="plus" disabled={data ? !data.allow_user_servers : false}
          title={data && !data.allow_user_servers ? CONNECTIONS.addDisabled : undefined} onClick={() => setAdding(true)}>{CONNECTIONS.add}</Button>
      </>}>
        {data && !data.vault_ready && data.mine.some((a) => a.auth === 'oauth') && (
          <Callout tone="warn" className="sec-note">{CONNECTIONS.vaultMissing}</Callout>
        )}
        {shown.length > 0 ? (
          <ul className="rows apps" aria-label={CONNECTIONS.list}>
            {shown.map((a) => <AppRow key={a.id} a={a} onNote={say} />)}
          </ul>
        ) : apps.status === 'loading' ? (
          <p className="rows rows-state">{CONNECTIONS.loading}</p>
        ) : apps.status === 'error' ? (
          <Empty icon="link" title={CONNECTIONS.loadFailed} text={connError(apps.error)}
            action={<Button onClick={() => void loadApps()}>{CONNECTIONS.retry}</Button>} />
        ) : (
          <Empty icon="link" title={CONNECTIONS.empty} text={CONNECTIONS.emptyText}
            action={data?.allow_user_servers ? <Button icon="plus" onClick={() => setAdding(true)}>{CONNECTIONS.add}</Button> : undefined} />
        )}
        {hidden.length > 0 && (
          <details className="apps-hidden">
            <summary>{CONNECTIONS.hiddenTitle} <span className="ui-num">{hidden.length}</span></summary>
            <ul className="rows apps">
              {hidden.map((a) => <AppRow key={a.id} a={a} onNote={say} />)}
            </ul>
          </details>
        )}
        <Notes items={CONNECTION_NOTES} />
      </Section>
      <Section title={CONNECTIONS.importable} extra={data && data.importable.length > 0 ? <Count n={data.importable.length} /> : undefined}>
        <p className="sec-sub">{CONNECTIONS.importableSub}</p>
        {data && data.importable.length > 0 ? (
          <ul className="rows apps" aria-label={CONNECTIONS.importableList}>
            {data.importable.map((i) => <ImportRow key={i.id} i={i} onNote={say} />)}
          </ul>
        ) : (
          <p className="rows rows-state">{apps.status === 'loading' ? CONNECTIONS.loading : CONNECTIONS.importableEmpty}</p>
        )}
      </Section>
      <AddAppDialog open={adding} onClose={() => setAdding(false)} onAdded={(a) => say({ tone: 'ok', text: CONNECTIONS.added(a.name) })} />
      <AppSheet id={focus} onClose={() => focusApp(null)} />
    </Page>
  );
}

// 맨 위 체크박스 (unset = 꺼짐으로 보인다 · 바꾸면 on / off). 누른 값을 바로 보이고 저장이 실패하면 되돌린다
function AutoAuth({ value, onError }: { value: 'unset' | 'on' | 'off' | null; onError: () => void }) {
  const [want, setWant] = useState<boolean | null>(null);
  const change = async (on: boolean) => {
    setWant(on);
    try {
      await changeAutoAuth(on ? 'on' : 'off');
    } catch {
      onError();
    } finally {
      setWant(null);
    }
  };
  return (
    <div className="conn-auto">
      <Checkbox label={CONNECTIONS.autoAuth} description={CONNECTIONS.autoAuthSub} checked={want ?? value === 'on'} disabled={value === null}
        onChange={(e) => void change(e.currentTarget.checked)} />
    </div>
  );
}

function AppRow({ a, onNote }: { a: App; onNote: (n: Note) => void }) {
  const connecting = useConnections((s) => !!s.connecting[a.id]);
  const [busy, setBusy] = useState(false);
  const key = stateOf(a);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    onNote(null);
    try {
      await fn();
      await bump();
    } catch (e) {
      onNote({ tone: 'danger', text: connError(codeOf(e)) });
    } finally {
      setBusy(false);
    }
  };
  const connect = async () => {
    onNote(null);
    const r = await connectApp(a.id);
    if (!r.ok && r.code !== 'cancelled') onNote({ tone: 'danger', text: connError(r.code) });
    else if (r.ok) onNote({ tone: 'ok', text: CONNECTIONS.connected(a.name) });
  };
  const needsLogin = !a.share_lost && !a.blocked && a.status === 'active' && (a.connection === 'needs_login' || a.connection === 'expired');
  return (
    <li className="row conn-app" data-app={a.handle} data-state={key} data-source={a.source}>
      <span className="ui-tile"><Icon name="plug" /></span>
      <button type="button" className="row-main app-open" onClick={() => focusApp(a.id)} aria-label={CONNECTIONS.details(a.name)}>
        <span className="app-head">
          <b>{a.name}</b>
          <Badge size="sm" variant="outline" className="app-src">{SOURCE_LABEL[a.source]}</Badge>
        </span>
        <Meta className="row-sub" items={[a.domain, loginOf(a), a.tool_count != null ? CONNECTIONS.toolCount(a.tool_count) : null]} />
      </button>
      <span className="state app-state"><StatusDot state={connecting ? 'run' : STATE_DOT[key]} size="sm" />{connecting ? CONNECTIONS.connecting : STATE_LABEL[key]}</span>
      <span className="app-acts">
        {connecting ? (
          <Button size="sm" variant="ghost" onClick={() => void cancelConnect()}>{CONNECTIONS.stop}</Button>
        ) : a.hidden ? (
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void run(() => patchApp(a.id, { hidden: false }))}>{CONNECTIONS.unhide}</Button>
        ) : (
          <>
            {needsLogin && (
              <Button size="sm" variant="primary" iconEnd="external" aria-label={CONNECTIONS.connectLabel(a.name)} onClick={() => void connect()}>
                {a.connection === 'expired' ? CONNECTIONS.reconnect : CONNECTIONS.connect}
              </Button>
            )}
            {a.connection === 'connected' && a.auth === 'oauth' && !a.share_lost && (
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void run(() => disconnectApp(a.id))}>{CONNECTIONS.disconnect}</Button>
            )}
            {a.source === 'install' && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => patchApp(a.id, { hidden: true }))}>{CONNECTIONS.hide}</Button>
            )}
            {a.share_lost && (
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void run(() => removeApp(a.id))}>{CONNECTIONS.remove}</Button>
            )}
          </>
        )}
      </span>
    </li>
  );
}

// 가져올 수 있는 앱 = 이름 · 도메인 · 공유한 사람 · 경로(스페이스 · 조직) · [가져오기]
function ImportRow({ i, onNote }: { i: Importable; onNote: (n: Note) => void }) {
  const [busy, setBusy] = useState(false);
  const take = async () => {
    setBusy(true);
    onNote(null);
    try {
      const a = await importApp(i.id);
      await bump();
      onNote({ tone: 'ok', text: CONNECTIONS.imported(a.name || i.name) });
    } catch (e) {
      onNote({ tone: 'danger', text: connError(codeOf(e)) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="row conn-app importable" data-app-id={i.id}>
      <span className="ui-tile"><Icon name="plug" /></span>
      <span className="row-main">
        <b>{i.name}</b>
        <Meta className="row-sub" items={[i.domain, loginOf(i), i.tool_count != null ? CONNECTIONS.toolCount(i.tool_count) : null, i.owner_name ? CONNECTIONS.sharedBy(i.owner_name) : null]} />
        {i.via.map((v) => <ScopeBreadcrumb key={`${v.scope_kind}:${v.scope_id}`} path={v.path} withItem className="app-via" />)}
      </span>
      <Button size="sm" loading={busy} aria-label={CONNECTIONS.importLabel(i.name)} onClick={() => void take()}>{CONNECTIONS.import}</Button>
    </li>
  );
}
