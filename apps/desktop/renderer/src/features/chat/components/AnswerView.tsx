// 답 한 칸 = (생각 · 도구 상태 줄 + 펼치는 패널) → 글(마크다운) → 아래 한 줄 (답한 모델 · 걸린 시간). 실패 = 이유 + 고치는 곳 + 다시 시도.
// 글은 흐르는 동안에도 마크다운으로 (날것 문법 글자 없음 · 일정한 속도로 펼침) — markdown/render.tsx.
import { Button, StatusDot, providerLabel } from '@brewai/ui';
import { seconds } from '../../../lib/format';
import { ModelName } from '../../models/components/ModelName';
import { CHAT, FAILURE_TEXT, detailText, joinParts } from '../copy';
import { retry, retryWithoutReasoning } from '../hooks';
import { Markdown } from '../markdown/render';
import { isLive, type Answer, type Turn } from '../model';
import { hasTeam, skippedThinking, thought, usedTools } from '../trace';
import { AppCards } from './AppCards';
import { openTeamPanel } from './TeamPanel';
import { TraceView } from './TraceView';

// teamRun = 이 대화에서 팀이 생긴 마지막 답 (오른쪽에서 보기 = 이 답을 패널에 · 그 뒤 새 팀이 생기면 새 팀으로)
export function AnswerView({ turn, latest, threadId, teamRun = null }: { turn: Turn; latest: boolean; threadId: string; teamRun?: string | null }) {
  const a = turn.answer;
  const live = isLive(a);
  const body = a.parts.length > 0 || a.status !== 'failed';
  const worked = thought(a) || usedTools(a) || skippedThinking(a);
  // 상태 줄: 생각 · 도구가 있었거나, 이 창에서 방금 보낸 마지막 답이 흐르는 중 · 멈춤
  const trace = worked || (latest && !a.fromHistory && (live || a.status === 'stopped'));
  const texts = a.parts.filter((p) => p.kind === 'text');
  return (
    <>
      {body && (
        <div className="msg agent enter" aria-busy={live}>
          {trace && <TraceView a={a} onTeam={hasTeam(a) ? () => openTeamPanel(threadId, { runId: a.runId, over: teamRun }) : undefined} />}
          {texts.map((p, i) => (
            <Markdown key={p.id} id={p.id} className="txt" text={p.text} live={live && i === texts.length - 1} />
          ))}
          {a.cards.length > 0 && <AppCards cards={a.cards} parts={a.parts} threadId={threadId} runId={a.runId} active={latest} />}
          {(a.model || a.status === 'stopped') && (
            <div className="afoot">
              {a.status === 'stopped' && latest && !a.fromHistory && (
                <Button size="sm" icon="refresh" onClick={() => retry(threadId)}>{CHAT.retry}</Button>
              )}
              <Byline a={a} withTime={!live} />
            </div>
          )}
        </div>
      )}
      {a.status === 'failed' && a.failure && (latest ? (
        <Failed a={a} threadId={threadId} />
      ) : (
        <p className="msg note">{failText(a)}</p>
      ))}
    </>
  );
}

const failText = (a: Answer) => detailText(a.failureDetail)?.text || (a.failure ? FAILURE_TEXT[a.failure] : '');

// 실패 = 한 줄(왜) + 고치는 곳(hint) + 어느 모델(이름 · 게이트웨이 id) + 다시 시도 (생각 때문이면 '생각 끄고 다시'도)
function Failed({ a, threadId }: { a: Answer; threadId: string }) {
  const d = detailText(a.failureDetail);
  return (
    <div className="msg agent fail enter" role="alert" data-detail={a.failureDetail ?? undefined}>
      <StatusDot state="fail" className="fdot" />
      <span className="fmain">
        <span className="ftxt">{failText(a)}</span>
        {d && <span className="fhint">{d.hint}</span>}
        {a.model && d && <span className="fmodel"><span>{a.model.label}</span><span>{a.model.id}</span></span>}
      </span>
      <span className="facts">
        {d?.reasoningOff && a.reasoning !== 'off' && (
          <Button onClick={() => retryWithoutReasoning(threadId)}>{CHAT.retryNoThink}</Button>
        )}
        <Button onClick={() => retry(threadId)}>{CHAT.retry}</Button>
      </span>
    </div>
  );
}

// 답한 모델 (회사 아이콘 · 이름) + 걸린 시간 — 칸 나눔 (생각 깊이는 여기서 보이지 않는다)
function Byline({ a, withTime }: { a: Answer; withTime?: boolean }) {
  if (!a.model) return null;
  const took = withTime ? seconds(a.durationMs) : '';
  return (
    <span className="by" title={joinParts([providerLabel(a.model.provider, a.model.provider_label), a.model.label])}>
      <ModelName model={a.model} size="sm" showId={false} />
      {took && <span className="x ui-num">{took}</span>}
    </span>
  );
}
