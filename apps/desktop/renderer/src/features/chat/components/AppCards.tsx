// 답 아래 앱 카드 (ADR-0013 · slice 05) — 연결이 필요해서 멈췄을 때 · 공유된 앱을 아직 안 가져왔을 때.
//   A (mode ask)    '<앱> 연결이 필요해요' + '다음부터 바로 로그인 화면을 열까요?' [켜고 로그인] [설정에서 할게요]
//   B (mode auto)   '<앱> 로그인 화면을 열었어요' (묻지 않고 바로 열림) [다시 열기] [그만두기]
//   C (mode manual) '<앱> 앱이 아직 연결되지 않았어요' [연결된 앱 열기] · 연결되면 [이어서 하기]
//   D (가져오기 전)  '<앱> 앱을 먼저 가져와야 해요' + 공유된 곳 [연결된 앱 열기]
// 버튼은 대화의 마지막 답에서만 (이어서 하기는 마지막 실행이 그 호출로 멈췄을 때만 된다). 판정 · 다시 계산은 서버.
// 로그인 화면이 서버와 다른 도메인이면 '로그인 <도메인>' 을 보인다. 쓰기 도구 대기 = 할 일(도구 · 인자)을 보이고 연결 뒤에도 [이어서 하기] 를 누른다.
import type { ReactNode } from 'react';
import { Button, Icon, Meta, Spinner } from '@brewai/ui';
import { go } from '../../../app/router';
import { connError } from '../../connections/copy';
import { focusApp, useConnections } from '../../connections/hooks';
import { kindLabel } from '../../scope/model';
import { APP_CARD } from '../copy';
import { approveCard, cancelCard, cardReady, connectCard, declineCard, resumeCard } from '../hooks';
import type { AppCard, AuthCard, ImportCard, Part } from '../model';

type CardsProps = { cards: AppCard[]; parts?: Part[]; threadId: string; runId: string; active: boolean };

export function AppCards({ cards, parts = [], threadId, runId, active }: CardsProps) {
  useConnections((s) => s.apps); // 연결 상태가 바뀌면 다시 그린다 (C 의 [이어서 하기])
  const shown = cards.filter((c) => c.kind === 'import' || c.phase !== 'done');
  if (!shown.length) return null;
  return (
    <div className="app-cards">
      {shown.map((c) => c.kind === 'auth'
        ? <AuthCardView key={c.callId} c={c} args={argsOf(parts, c.callId)} threadId={threadId} runId={runId} active={active} />
        : <ImportCardView key={c.server.id} c={c} active={active} />)}
    </div>
  );
}

// 멈춘 호출의 인자 (도구 조각 · 한 줄 JSON · 길면 자른다)
function argsOf(parts: Part[], callId: string): string {
  const p = parts.find((x) => x.kind === 'tool' && x.id === callId);
  if (!p || p.kind !== 'tool') return '';
  const text = p.args !== undefined ? JSON.stringify(p.args) : p.argsText;
  return text && text !== '{}' ? (text.length > 240 ? `${text.slice(0, 240)}…` : text) : '';
}

const openSettings = (serverId: string) => {
  focusApp(serverId);
  go('connections');
};

function AuthCardView({ c, args, threadId, runId, active }: { c: AuthCard; args: string; threadId: string; runId: string; active: boolean }) {
  const name = c.server.name || c.server.handle;
  const ready = cardReady(c);
  const variant = c.mode === 'ask' ? 'ask' : c.mode === 'auto' ? 'auto' : 'manual';
  const title = c.phase === 'opening' ? APP_CARD.autoTitle(name)
    : c.write && ready && c.phase === 'idle' ? APP_CARD.writeReadyTitle(name)
    : c.reason === 'expired' ? APP_CARD.expiredTitle(name)
    : c.reason === 'insufficient_scope' ? APP_CARD.scopeTitle(name)
    : variant === 'ask' ? APP_CARD.askTitle(name)
    : variant === 'auto' ? (c.autoOpen ? APP_CARD.autoTitle(name) : APP_CARD.autoLimitedTitle(name))
    : APP_CARD.manualTitle(name);
  const connect = () => void connectCard(threadId, runId, c.callId);
  const settings = <Button size="sm" variant="ghost" onClick={() => openSettings(c.server.id)}>{APP_CARD.openSettings}</Button>;

  let body = '';
  let acts: ReactNode = null;
  let busy: string | null = null;
  if (c.phase === 'opening') {
    busy = APP_CARD.opening;
    body = APP_CARD.autoBody;
    acts = <>
      <Button size="sm" iconEnd="external" onClick={connect}>{APP_CARD.reopen}</Button>
      <Button size="sm" variant="ghost" onClick={() => void cancelCard(threadId, runId, c.callId)}>{APP_CARD.stop}</Button>
    </>;
  } else if (c.phase === 'resuming') {
    busy = APP_CARD.resuming;
  } else if (ready && c.phase !== 'failed') {
    body = c.write ? APP_CARD.writeReadyBody : APP_CARD.readyBody;
    acts = <Button size="sm" variant="primary" icon="refresh" onClick={() => void resumeCard(threadId, runId, c.callId)}>{APP_CARD.resume}</Button>;
  } else if (c.phase === 'failed') {
    body = APP_CARD.failed(connError(c.error));
    acts = <>
      {ready
        ? <Button size="sm" variant="primary" icon="refresh" onClick={() => void resumeCard(threadId, runId, c.callId)}>{APP_CARD.resume}</Button>
        : <Button size="sm" variant="primary" iconEnd="external" onClick={connect}>{APP_CARD.open}</Button>}
      {settings}
    </>;
  } else if (c.phase === 'stopped') {
    body = APP_CARD.stopped;
    acts = <><Button size="sm" iconEnd="external" onClick={connect}>{APP_CARD.open}</Button>{settings}</>;
  } else if (variant === 'ask') {
    body = APP_CARD.askBody;
    acts = <>
      <Button size="sm" variant="primary" iconEnd="external" onClick={() => void approveCard(threadId, runId, c.callId)}>{APP_CARD.askYes}</Button>
      <Button size="sm" variant="ghost" onClick={() => void declineCard(threadId, runId, c.callId)}>{APP_CARD.askNo}</Button>
    </>;
  } else if (variant === 'auto') {
    body = c.autoOpen ? APP_CARD.autoBody : APP_CARD.autoLimitedBody;
    acts = <><Button size="sm" variant="primary" iconEnd="external" onClick={connect}>{c.autoOpen ? APP_CARD.reopen : APP_CARD.open}</Button>{settings}</>;
  } else {
    body = APP_CARD.manualBody;
    acts = settings;
  }

  const login = c.server.issuerDomain && c.server.issuerDomain !== c.server.domain ? APP_CARD.loginAt(c.server.issuerDomain) : null;
  return (
    <section className="app-card" data-card={variant} data-phase={c.phase} data-ready={ready || undefined} data-server={c.server.handle}
      data-write={c.write || undefined} role="group" aria-label={APP_CARD.region(name)}>
      <span className="ac-ico" aria-hidden="true"><Icon name="plug" size="sm" /></span>
      <div className="ac-main">
        <b className="ac-title">{title}</b>
        {login && <Meta className="ac-meta" items={[login]} />}
        {busy && <span className="ac-busy" role="status"><Spinner size="xs" />{busy}</span>}
        {body && <p className="ac-body">{body}</p>}
        {c.write && (
          <div className="ac-will" aria-label={APP_CARD.willRun}>
            <span className="ac-will-k">{APP_CARD.willRun}</span>
            <b>{c.label ?? APP_CARD.writeTool}</b>
            {args && <code className="ac-args">{args}</code>}
          </div>
        )}
        {active && acts && <div className="ac-acts">{acts}</div>}
      </div>
    </section>
  );
}

function ImportCardView({ c, active }: { c: ImportCard; active: boolean }) {
  const at = c.via[0]?.path.at(-1);
  const where = at ? [at.name, kindLabel(at.kind)].filter(Boolean).join(' ') : '';
  return (
    <section className="app-card" data-card="import" role="group" aria-label={APP_CARD.region(c.server.name)}>
      <span className="ac-ico" aria-hidden="true"><Icon name="plug" size="sm" /></span>
      <div className="ac-main">
        <b className="ac-title">{APP_CARD.importTitle(c.server.name)}</b>
        <p className="ac-body">{APP_CARD.importBody(where)}</p>
        {active && (
          <div className="ac-acts">
            <Button size="sm" variant="ghost" onClick={() => go('connections')}>{APP_CARD.openSettings}</Button>
          </div>
        )}
      </div>
    </section>
  );
}
