// 대화 — 프로토타입 홈(마크 · 제목 · 제안 3줄 · 입력창) → 보내면 대화 화면(.thread: 제목 줄 · 메시지 · 아래 입력창).
// 상태는 chat/session.ts (앱 전체 store): 메뉴를 옮겨도 답은 계속 받고, 진행 상황 화면이 같은 실행을 본다.
// 답 = 생각 블록 · 도구 카드 · 글 + 상태 줄 (chat/Answer.tsx). 모델 · 생각 깊이 = 입력창 모델 버튼 (chat/ModelPicker.tsx).
// App 이 대화가 바뀔 때마다 key 를 바꿔 이 화면을 새로 만든다 → 입력 중인 글이 비고 입력창에 포커스.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Icon, Mark, type IconName } from '../icons';
import { href } from '../menu';
import { AnswerView } from '../chat/Answer';
import { ModelPicker } from '../chat/ModelPicker';
import { FAILURE_TEXT } from '../chat/text';
import { convBusy, reloadThread, send, stop, useSession, type Conv } from '../chat/session';

const SUGGESTIONS: readonly { icon: IconName; text: string; prompt: string; need?: string }[] = [
  { icon: 'mail', text: "'견적 요청' 메일에 답장 초안 쓰기", prompt: "'견적 요청' 메일에 답장 초안 써줘", need: '연결 필요' },
  { icon: 'team', text: '노트북 3종 비교표 — 여럿이 나눠서 조사', prompt: '노트북 3종 가격·무게·배터리 비교표 만들어줘' },
  { icon: 'cal', text: '내일 10시 회의 자료 준비', prompt: '내일 10시 회의 자료 준비해줘', need: '연결 필요' },
];
const PH_HOME = '예: 이번 주 메일에서 할 일만 뽑아줘';
const PH_THREAD = '이어서 요청하거나 질문하세요';
const PH_LOADING = '대화 기록을 불러오는 중이에요';

export function Chat() {
  const conv = useSession((s) => (s.current ? s.convs[s.current] : undefined));
  const busy = useSession((s) => convBusy(s, s.current));
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const loading = conv?.load === 'loading';
  const canSend = text.trim() !== '' && !busy && !loading;

  useEffect(() => input.current?.focus(), []);

  const onSend = () => {
    if (!canSend) return;
    if (send(text)) setText('');
    input.current?.focus();
  };

  const composer = (
    <Composer input={input} text={text} onText={setText} onSend={onSend} canSend={canSend}
      busy={busy} onStop={() => conv && stop(conv.id)}
      placeholder={loading ? PH_LOADING : conv?.turns.length ? PH_THREAD : PH_HOME} />
  );

  if (!conv) {
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

  return (
    <section className="view thread">
      <div className="conv">
        <div className="conv-head">
          <h1 className="t" title={conv.title}>{conv.title}</h1>
        </div>
        <Messages conv={conv} />
        <div className="dock2"><div className="col">{composer}</div></div>
      </div>
    </section>
  );
}

function Messages({ conv }: { conv: Conv }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // 맨 아래를 보고 있으면 새 글을 따라 내려간다 (위로 올려 읽는 중이면 그대로)
  const turns = conv.turns.length;
  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  useLayoutEffect(() => {
    stick.current = true; // 새 질문 = 아래로
  }, [turns]);
  const onScroll = () => {
    const el = box.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  return (
    <div className="msgs" ref={box} onScroll={onScroll}>
      <div className="col" role="log" aria-label="대화 내용" aria-live="polite">
        {conv.turns.map((t, i) => (
          <div key={t.id} className="turn">
            <div className="msg user enter"><div className="bubble">{t.ask}</div></div>
            <AnswerView turn={t} latest={i === conv.turns.length - 1} threadId={conv.id} />
          </div>
        ))}
        {conv.load === 'loading' && (
          <p className="msg note"><span className="spin12" aria-hidden="true" />대화 기록을 불러오는 중…</p>
        )}
        {conv.load === 'error' && conv.loadError && (
          <div className="msg agent fail" role="alert">
            <span>{conv.loadError === 'not_found' ? '대화를 찾지 못했어요. 지워졌을 수 있어요' : `대화 기록을 불러오지 못했어요 · ${FAILURE_TEXT[conv.loadError]}`}</span>
            {conv.loadError !== 'not_found' && <button className="btn" type="button" onClick={() => reloadThread(conv.id)}>다시 시도</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function Composer({ input, text, onText, onSend, canSend, busy, onStop, placeholder }: {
  input: RefObject<HTMLTextAreaElement | null>;
  text: string;
  onText: (v: string) => void;
  onSend: () => void;
  canSend: boolean;
  busy: boolean;
  onStop: () => void;
  placeholder: string;
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
          <ModelPicker />
          <button className="ib" type="button" aria-label="음성 입력" title="음성 입력 · 준비 중" disabled>
            <Icon name="mic" />
          </button>
          {busy ? (
            <button className="send stop" type="button" aria-label="멈추기" title="멈추기" onClick={onStop}>
              <Icon name="stop" />
            </button>
          ) : (
            <button className="send" type="button" aria-label="보내기" title="보내기" disabled={!canSend} onClick={onSend}>
              <Icon name="up" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
