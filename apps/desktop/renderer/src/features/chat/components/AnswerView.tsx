// 답 한 칸 = (생각 · 도구 상태 줄 + 펼치는 패널) → 글 → 아래 한 줄 (답한 모델 · 생각 깊이 · 걸린 시간). 실패 = 이유 + 고치는 곳 + 다시 시도.
import { Button, StatusDot, providerLabel } from '@brewai/ui';
import { seconds } from '../../../lib/format';
import { ModelName } from '../../models/components/ModelName';
import { reasoningTag } from '../../models/copy';
import { CHAT, FAILURE_TEXT, detailText } from '../copy';
import { retry, retryWithoutReasoning } from '../hooks';
import { isLive, type Answer, type Turn } from '../model';
import { skippedThinking, thought, usedTools } from '../trace';
import { TraceView } from './TraceView';

export function AnswerView({ turn, latest, threadId }: { turn: Turn; latest: boolean; threadId: string }) {
  const a = turn.answer;
  const live = isLive(a);
  const body = a.parts.length > 0 || a.status !== 'failed';
  const worked = thought(a) || usedTools(a) || skippedThinking(a);
  // 상태 줄: 생각 · 도구가 있었거나, 이 창에서 방금 보낸 마지막 답이 흐르는 중 · 멈춤
  const trace = worked || (latest && !a.fromHistory && (live || a.status === 'stopped'));
  return (
    <>
      {body && (
        <div className="msg agent enter" aria-busy={live}>
          {trace && <TraceView a={a} />}
          {a.parts.map((p) => (p.kind === 'text' ? <div key={p.id} className="txt">{p.text}</div> : null))}
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

// 실패 = 한 줄(왜) + 고치는 곳(hint) + 다시 시도 (생각 때문이면 '생각 끄고 다시'도)
function Failed({ a, threadId }: { a: Answer; threadId: string }) {
  const d = detailText(a.failureDetail);
  return (
    <div className="msg agent fail enter" role="alert" data-detail={a.failureDetail ?? undefined}>
      <StatusDot state="fail" className="fdot" />
      <span className="fmain">
        <span className="ftxt">{failText(a)}</span>
        {d && <span className="fhint">{d.hint}</span>}
        {a.model && d && <span className="fmodel">{a.model.label} · {a.model.id}</span>}
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

// 답한 모델 (회사 아이콘 · 이름 · 생각 깊이 · 걸린 시간) — 같은 이름의 다른 모델이 있으면 id 도
function Byline({ a, withTime }: { a: Answer; withTime?: boolean }) {
  if (!a.model) return null;
  const extra = [reasoningTag(a.reasoning), withTime ? seconds(a.durationMs) : ''].filter(Boolean);
  return (
    <span className="by" title={`${providerLabel(a.model.provider, a.model.provider_label)} · ${a.model.id}`}>
      <ModelName model={a.model} size="sm" />
      {extra.map((x) => <span key={x} className="x">· {x}</span>)}
    </span>
  );
}
