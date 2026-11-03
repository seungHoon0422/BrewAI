// 앱 상세 서랍 — 주소 · 로그인 방식 · 출처 · 상태 · [연결] [다시 연결] [연결 끊기] [연결 확인] · 에이전트가 보는 줄 + 토큰
// · 도구 목록 (쓰기 표시) · 공유 (내가 추가한 앱만: 내 스페이스 · 조직에 · 끊기) · 지우기 / 목록에서 빼기 (숨기기는 없앴다 · 예전에 숨긴 앱만 다시 보이기).
// 쓰기 도구는 지금 바로 실행된다 (ADR-0013 사용자 결정) — 표시만. 승인 카드는 slice 07.
import { useEffect, useState } from 'react';
import { Badge, Button, Callout, Dialog, KeyValue, Select, Sheet, Spinner, StatusDot } from '@brewai/ui';
import { codeOf, failureOf, isAbort, type Failure } from '../../../lib/api';
import { ScopeBreadcrumb } from '../../scope/components/ScopeBreadcrumb';
import { kindLabel } from '../../scope/model';
import { disconnectApp, getApp, patchApp, removeApp, shareApp, testApp, unshareApp, type AppDetail } from '../api';
import { CONNECTIONS, DETAIL, SOURCE_LABEL, STATE_LABEL, connError } from '../copy';
import { STATE_DOT, bump, cancelConnect, connectApp, stateOf, useConnections, useShareTargets } from '../hooks';
import { AppIcon } from './AppIcon';

type Note = { tone: 'ok' | 'danger'; text: string } | null;

export function AppSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const version = useConnections((s) => s.version);
  const [app, setApp] = useState<AppDetail | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  useEffect(() => {
    if (!id) {
      setApp(null);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    getApp(id, ctrl.signal).then(
      (a) => {
        setApp(a);
        setError(null);
      },
      (e) => !isAbort(e) && setError(failureOf(e)),
    );
    return () => ctrl.abort();
  }, [id, version]);
  const shown = app && app.id === id ? app : null;
  const listed = useConnections((s) => s.apps.data?.mine.find((a) => a.id === id) ?? null);
  const name = shown?.name ?? listed?.name;
  // 제목 = 앱 아이콘 + 이름 (아이콘은 장식 = 서랍 이름은 앱 이름 그대로)
  const title = id && name ? <span className="app-sheet-title"><AppIcon server={id} name={name} />{name}</span> : DETAIL.loading;
  return (
    <Sheet open={!!id} onClose={onClose} title={title} description={shown?.domain ?? listed?.domain} className="app-sheet">
      {shown ? <Body a={shown} onGone={onClose} /> : error ? (
        <div className="app-detail">
          {/* 공유가 끊긴 앱은 정의를 더 못 본다 (404) — 내 목록에서 빼기만 */}
          <Callout tone={listed?.share_lost ? 'warn' : 'danger'}>{listed?.share_lost ? DETAIL.shareLost : DETAIL.failed}</Callout>
          {listed && listed.source !== 'install' && <Gone id={listed.id} onGone={onClose} />}
        </div>
      ) : (
        <p className="rows-state"><Spinner size="xs" />{DETAIL.loading}</p>
      )}
    </Sheet>
  );
}

function Body({ a, onGone }: { a: AppDetail; onGone: () => void }) {
  const connecting = useConnections((s) => !!s.connecting[a.id]);
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const key = stateOf(a);
  const writes = a.tools.filter((t) => t.write).length;

  const run = async (what: string, fn: () => Promise<unknown>, ok?: string, gone = false) => {
    setBusy(what);
    setNote(null);
    try {
      await fn();
      if (gone) onGone();
      await bump();
      if (ok) setNote({ tone: 'ok', text: ok });
    } catch (e) {
      setNote({ tone: 'danger', text: connError(codeOf(e)) });
    } finally {
      setBusy(null);
    }
  };
  const connect = async () => {
    setNote(null);
    const r = await connectApp(a.id);
    if (r.ok) setNote({ tone: 'ok', text: CONNECTIONS.connected(a.name) });
    else if (r.code !== 'cancelled') setNote({ tone: 'danger', text: connError(r.code) });
  };
  const test = async () => {
    setBusy('test');
    setNote(null);
    try {
      const r = await testApp(a.id);
      setNote(r.ok ? { tone: 'ok', text: DETAIL.testOk(r.tool_count) } : { tone: 'danger', text: connError(r.code) });
      await bump();
    } catch (e) {
      setNote({ tone: 'danger', text: connError(codeOf(e)) });
    } finally {
      setBusy(null);
    }
  };
  const canLogin = a.auth === 'oauth' && a.status === 'active' && !a.share_lost && !a.hidden && !a.blocked;

  return (
    <div className="app-detail" data-app={a.handle}>
      {note && <Callout tone={note.tone} live onDismiss={() => setNote(null)}>{note.text}</Callout>}
      {a.share_lost && <Callout tone="warn">{DETAIL.shareLost}</Callout>}
      {a.blocked && <Callout tone="warn">{DETAIL.blocked}</Callout>}
      <KeyValue items={[
        { label: DETAIL.address, value: a.url, mono: true },
        { label: DETAIL.login, value: a.auth === 'oauth' ? DETAIL.loginOauth(a.issuer_domain ?? a.domain) : DETAIL.loginNone },
        { label: DETAIL.source, value: SOURCE_LABEL[a.source] },
        { label: DETAIL.state, value: <span className="state app-state"><StatusDot state={connecting ? 'run' : STATE_DOT[key]} size="sm" />{connecting ? CONNECTIONS.connecting : STATE_LABEL[key]}</span> },
      ]} />
      <div className="app-acts">
        {connecting ? (
          <Button size="sm" variant="ghost" onClick={() => void cancelConnect()}>{CONNECTIONS.stop}</Button>
        ) : canLogin && a.connection !== 'connected' ? (
          <Button size="sm" variant="primary" iconEnd="external" onClick={() => void connect()}>
            {a.connection === 'expired' ? CONNECTIONS.reconnect : CONNECTIONS.connect}
          </Button>
        ) : canLogin ? (
          <>
            <Button size="sm" iconEnd="external" onClick={() => void connect()}>{CONNECTIONS.reconnect}</Button>
            <Button size="sm" variant="ghost" loading={busy === 'disconnect'} onClick={() => void run('disconnect', () => disconnectApp(a.id))}>{CONNECTIONS.disconnect}</Button>
          </>
        ) : null}
        {!a.share_lost && a.listed && <Button size="sm" variant="ghost" loading={busy === 'test'} onClick={() => void test()}>{DETAIL.test}</Button>}
      </div>

      {a.prompt_line && (
        <section className="app-block">
          <h3>{DETAIL.agentLine}</h3>
          <p className="app-line"><code>{a.prompt_line}</code><span className="ui-num">{DETAIL.tokens(a.prompt_tokens)}</span></p>
        </section>
      )}

      <section className="app-block">
        <h3>{DETAIL.tools} {a.tools.length > 0 && <span className="count ui-num">{a.tools.length}</span>}</h3>
        {a.tools.length > 0 ? (
          <>
            <ul className="app-tools" aria-label={DETAIL.tools}>
              {a.tools.map((t) => (
                <li key={t.name} data-tool={t.name} data-write={t.write || undefined}>
                  <span className="app-tool-head">
                    <b>{t.title}</b>
                    {t.write && <Badge size="sm" tone="warn" className="write" title={DETAIL.writeTitle}>{DETAIL.write}</Badge>}
                    <code>{t.name}</code>
                  </span>
                  {t.description && <span className="row-sub">{t.description}</span>}
                </li>
              ))}
            </ul>
            {writes > 0 && <p className="needs">{DETAIL.writeNote}</p>}
          </>
        ) : (
          <p className="needs">{a.auth === 'oauth' && a.connection !== 'connected' ? DETAIL.toolsEmptyOauth : DETAIL.toolsEmpty}</p>
        )}
      </section>

      {a.shares && <Shares a={a} onNote={setNote} />}

      <div className="app-foot">
        {a.source === 'own' ? (
          <Button size="sm" variant="danger" onClick={() => setConfirm(true)}>{CONNECTIONS.delete}</Button>
        ) : a.source === 'imported' ? (
          <Button size="sm" variant="ghost" loading={busy === 'remove'} onClick={() => void run('remove', () => removeApp(a.id), undefined, true)}>{CONNECTIONS.remove}</Button>
        ) : (
          a.hidden ? (
            <Button size="sm" variant="ghost" loading={busy === 'hide'} onClick={() => void run('hide', () => patchApp(a.id, { hidden: false }))}>
              {CONNECTIONS.unhide}
            </Button>
          ) : null
        )}
      </div>
      <Dialog size="sm" open={confirm} onClose={() => setConfirm(false)} title={DETAIL.deleteTitle} description={DETAIL.deleteBody}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirm(false)}>{DETAIL.close}</Button>
          <Button variant="danger" loading={busy === 'delete'} onClick={() => void run('delete', () => removeApp(a.id), undefined, true).then(() => setConfirm(false))}>{CONNECTIONS.delete}</Button>
        </>} />
    </div>
  );
}

// 공유 (주인만): 지금 공유된 곳 (경로 · [공유 끊기]) + 새로 공유 (내가 멤버인 스페이스 · 내가 owner · admin 인 조직)
function Shares({ a, onNote }: { a: AppDetail; onNote: (n: Note) => void }) {
  const targets = useShareTargets();
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const shares = a.shares ?? [];
  const taken = new Set(shares.map((s) => `${s.scope_kind}:${s.scope_id}`));
  const options = targets
    .filter((t) => !taken.has(`${t.kind}:${t.id}`))
    .map((t) => ({ value: `${t.kind}:${t.id}`, label: t.name, description: kindLabel(t.kind) }));
  const act = async (what: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(what);
    onNote(null);
    try {
      await fn();
      await bump();
      onNote({ tone: 'ok', text: ok });
      setPick('');
    } catch (e) {
      onNote({ tone: 'danger', text: connError(codeOf(e)) });
    } finally {
      setBusy(null);
    }
  };
  const share = () => {
    const [kind, ...rest] = pick.split(':');
    if (!kind || !rest.length) return;
    void act('share', () => shareApp(a.id, kind, rest.join(':')), DETAIL.shared);
  };
  return (
    <section className="app-block app-shares">
      <h3>{DETAIL.shares}</h3>
      <p className="needs">{DETAIL.sharesSub}</p>
      {shares.length > 0 ? (
        <ul className="rows">
          {shares.map((s) => {
            const where = s.path.at(-1)?.name ?? s.scope_id;
            return (
              <li key={`${s.scope_kind}:${s.scope_id}`} className="row" data-share={s.scope_kind}>
                <span className="row-main"><ScopeBreadcrumb path={s.path} withItem /></span>
                <Button size="sm" variant="ghost" loading={busy === `rm:${s.scope_id}`} aria-label={DETAIL.shareRemoveLabel(where)}
                  onClick={() => void act(`rm:${s.scope_id}`, () => unshareApp(a.id, s.scope_kind, s.scope_id), DETAIL.unshared)}>{DETAIL.shareRemove}</Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rows rows-state">{DETAIL.sharesEmpty}</p>
      )}
      <div className="app-share">
        <Select aria-label={DETAIL.shareTarget} size="sm" options={options} value={pick} placeholder={options.length ? DETAIL.shareTargetPlaceholder : DETAIL.noTargets}
          disabled={!options.length} onChange={setPick} className="app-share-target" />
        <Button size="sm" disabled={!pick} loading={busy === 'share'} onClick={share}>{DETAIL.shareAdd}</Button>
      </div>
      <p className="needs">{DETAIL.shareOrgNote}</p>
    </section>
  );
}

// 정의를 못 읽는 앱 (공유 끊김) = 목록에서 빼기만
function Gone({ id, onGone }: { id: string; onGone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    try {
      await removeApp(id);
      onGone();
      await bump();
    } catch (e) {
      setError(connError(codeOf(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="app-foot">
      {error && <Callout tone="danger" live>{error}</Callout>}
      <Button size="sm" variant="ghost" loading={busy} onClick={() => void remove()}>{CONNECTIONS.remove}</Button>
    </div>
  );
}
