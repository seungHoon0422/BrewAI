// 대화 — 프로토타입 홈(마크 · 제목 · 제안 3줄 · 입력창) → 보내면 대화 화면(.thread: 제목 줄 · 메시지 · 아래 입력창).
// 글은 conductor 에서 조각으로 흘러 들어온다 (AG-UI TEXT_MESSAGE_CONTENT). 툴·승인 카드·진행 상황 패널은 slice 03 부터.
// '새 대화' = App 이 key 를 바꿔 이 화면을 새로 만든다 → 상태가 비고, 진행 중인 요청은 unmount 에서 끊는다.
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { ApiError, listModels, runChat, type Failure, type Model, type Turn } from '../api';
import { Icon, Mark, type IconName } from '../icons';
import { href } from '../menu';

const SUGGESTIONS: readonly { icon: IconName; text: string; prompt: string; need?: string }[] = [
  { icon: 'mail', text: "'견적 요청' 메일에 답장 초안 쓰기", prompt: "'견적 요청' 메일에 답장 초안 써줘", need: '연결 필요' },
  { icon: 'team', text: '노트북 3종 비교표 — 여럿이 나눠서 조사', prompt: '노트북 3종 가격·무게·배터리 비교표 만들어줘' },
  { icon: 'cal', text: '내일 10시 회의 자료 준비', prompt: '내일 10시 회의 자료 준비해줘', need: '연결 필요' },
];
const PH_HOME = '예: 이번 주 메일에서 할 일만 뽑아줘';
const PH_THREAD = '이어서 요청하거나 질문하세요';

const FAILURE_TEXT: Record<Failure, string> = {
  offline: '서버에 연결할 수 없어요',
  gateway: '모델에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요',
  config: '이 모델을 지금 쓸 수 없어요. 관리자에게 알려 주세요',
  no_models: '쓸 수 있는 모델이 없어요. 관리자에게 알려 주세요',
  cut: '답이 중간에 끊겼어요',
  server: '답을 받지 못했어요',
};

type Status = 'idle' | 'waiting' | 'streaming' | 'failed';

export function Chat() {
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [modelErr, setModelErr] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const run = useRef<AbortController | null>(null);
  const thread = useRef(crypto.randomUUID());
  const busy = status === 'waiting' || status === 'streaming';
  const canSend = text.trim() !== '' && !busy;

  useEffect(() => input.current?.focus(), [turns.length === 0]);

  // 기본 모델 = /api/models 첫 항목. 실패하면 '기본 모델' 그대로 두고 보낼 때 서버가 고른다
  useEffect(() => {
    const ctrl = new AbortController();
    listModels(ctrl.signal).then(
      (ms) => setModel(ms[0] ?? null),
      (e) => { if ((e as Error).name !== 'AbortError') setModelErr(true); },
    );
    return () => ctrl.abort();
  }, []);

  useEffect(() => () => run.current?.abort(), []); // 새 대화 · 메뉴 이동 = 진행 중인 답 끊기

  const start = (history: Turn[]) => {
    const ctrl = new AbortController();
    run.current = ctrl;
    const answer: Turn = { id: crypto.randomUUID(), role: 'assistant', content: '' };
    setTurns([...history, answer]);
    setStatus('waiting');
    setFailure(null);
    runChat({
      threadId: thread.current,
      turns: history,
      model: model?.id,
      signal: ctrl.signal,
      onDelta: (d) => {
        setStatus('streaming');
        setTurns((ts) => ts.map((t) => (t.id === answer.id ? { ...t, content: t.content + d } : t)));
      },
    }).then(
      () => setStatus('idle'),
      (e) => {
        if ((e as Error).name === 'AbortError') return;
        setFailure(e instanceof ApiError ? e.kind : 'server');
        setStatus('failed');
        // 받은 글이 없으면 빈 답 칸은 지운다 (다시 시도 = 같은 질문을 다시 보낸다)
        setTurns((ts) => ts.filter((t) => t.id !== answer.id || t.content !== ''));
      },
    );
  };

  const send = () => {
    if (!canSend) return;
    const ask: Turn = { id: crypto.randomUUID(), role: 'user', content: text.trim() };
    setText('');
    start([...turns.filter((t) => t.content !== ''), ask]);
  };
  // 마지막 사용자 질문까지 남기고 다시 보낸다 (끊긴 답 조각은 버린다)
  const retry = () => {
    const last = turns.map((t) => t.role).lastIndexOf('user');
    if (last >= 0) start(turns.slice(0, last + 1));
  };

  const composer = (
    <Composer input={input} text={text} onText={setText} onSend={send} canSend={canSend}
      placeholder={turns.length ? PH_THREAD : PH_HOME} model={model} modelErr={modelErr} />
  );

  if (turns.length === 0) {
    return (
      <section className="view home">
        <div className="hero">
          <Mark className="mark" />
          <h1>무엇을 맡길까요?</h1>
        </div>
        <div className="dock">
          <ul className="suggest">
            {SUGGESTIONS.map((s) => (
              <li key={s.prompt}>
                <button className="sg" type="button" onClick={() => { setText(s.prompt); input.current?.focus(); }}>
                  <Icon name={s.icon} />
                  {s.text}
                  {s.need && <span className="need">{s.need}</span>}
                </button>
              </li>
            ))}
          </ul>
          {composer}
        </div>
      </section>
    );
  }

  const title = turns.find((t) => t.role === 'user')?.content ?? '새 대화';
  return (
    <section className="view thread">
      <div className="conv">
        <div className="conv-head">
          <h1 className="t">{title}</h1>
        </div>
        <Messages turns={turns} status={status} failure={failure} onRetry={retry} />
        <div className="dock2"><div className="col">{composer}</div></div>
      </div>
    </section>
  );
}

function Messages({ turns, status, failure, onRetry }: {
  turns: Turn[];
  status: Status;
  failure: Failure | null;
  onRetry: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const last = turns[turns.length - 1];
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight; // 프로토타입 scrollDown()
  }, [turns, status]);
  return (
    <div className="msgs" ref={box}>
      <div className="col" role="log" aria-label="대화 내용" aria-live="polite">
        {turns.map((t) =>
          t.role === 'user' ? (
            <div key={t.id} className="msg user enter"><div className="bubble">{t.content}</div></div>
          ) : (
            <div key={t.id} className="msg agent enter" aria-busy={t === last && (status === 'waiting' || status === 'streaming')}>
              {t.content || (status === 'waiting' && t === last && (
                <span className="waittext"><span className="spin12" aria-hidden="true" />생각하는 중</span>
              ))}
            </div>
          ),
        )}
        {status === 'failed' && failure && (
          <div className="msg agent fail enter" role="alert">
            <span>{FAILURE_TEXT[failure]}</span>
            <button className="btn" type="button" onClick={onRetry}>다시 시도</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Composer({ input, text, onText, onSend, canSend, placeholder, model, modelErr }: {
  input: RefObject<HTMLTextAreaElement | null>;
  text: string;
  onText: (v: string) => void;
  onSend: () => void;
  canSend: boolean;
  placeholder: string;
  model: Model | null;
  modelErr: boolean;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 조합 중 Enter 는 글자 확정이라 보내지 않는다
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  };
  return (
    <div className="composer">
      <div className="ctx">
        <button type="button" disabled title="프로젝트 선택 · 준비 중">
          <Icon name="folder" />프로젝트<Icon name="down" />
        </button>
        <a href={href('connections')}>
          <Icon name="link" />앱 연결하기
        </a>
      </div>
      <div className="box">
        <textarea ref={input} rows={1} aria-label="요청 입력" placeholder={placeholder}
          value={text} onChange={(e) => onText(e.target.value)} onKeyDown={onKeyDown} />
        <div className="ctrl">
          <button className="ib" type="button" aria-label="파일 첨부" title="파일 첨부 · 준비 중" disabled>
            <Icon name="plus" />
          </button>
          <span className="grow" />
          <button className="model" type="button" disabled
            title={modelErr ? '서버에 연결할 수 없어요' : '허용된 모델만 보여요 · 고르기는 준비 중'}>
            {model?.label ?? '기본 모델'}<Icon name="down" />
          </button>
          <button className="ib" type="button" aria-label="음성 입력" title="음성 입력 · 준비 중" disabled>
            <Icon name="mic" />
          </button>
          <button className="send" type="button" aria-label="보내기" title="보내기" disabled={!canSend} onClick={onSend}>
            <Icon name="up" />
          </button>
        </div>
      </div>
    </div>
  );
}
