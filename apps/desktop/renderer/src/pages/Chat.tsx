// 대화 홈 — 프로토타입 홈 (마크 · 제목 · 제안 3줄 · 입력창). 대화는 다음 조각에서 연결 → 보내면 안내만 한다.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, Mark, type IconName } from '../icons';
import { href } from '../menu';

const SUGGESTIONS: readonly { icon: IconName; text: string; prompt: string; need?: string }[] = [
  { icon: 'mail', text: "'견적 요청' 메일에 답장 초안 쓰기", prompt: "'견적 요청' 메일에 답장 초안 써줘", need: '연결 필요' },
  { icon: 'team', text: '노트북 3종 비교표 — 여럿이 나눠서 조사', prompt: '노트북 3종 가격·무게·배터리 비교표 만들어줘' },
  { icon: 'cal', text: '내일 10시 회의 자료 준비', prompt: '내일 10시 회의 자료 준비해줘', need: '연결 필요' },
];

export function Chat() {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const canSend = text.trim() !== '';

  useEffect(() => input.current?.focus(), []);

  const send = () => {
    if (canSend) setNote('아직 보낼 수 없어요. 대화 연결은 준비 중이에요.');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 조합 중 Enter 는 글자 확정이라 보내지 않는다
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const edit = (value: string) => {
    setText(value);
    setNote('');
  };

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
              <button className="sg" type="button" onClick={() => { edit(s.prompt); input.current?.focus(); }}>
                <Icon name={s.icon} />
                {s.text}
                {s.need && <span className="need">{s.need}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="composer">
          <div className="ctx">
            <button type="button" disabled title="프로젝트 선택 · 준비 중">
              <Icon name="folder" />프로젝트<Icon name="down" />
            </button>
            <a href={href('connections')}>
              <Icon name="link" />앱 연결하기
            </a>
            <span className="hint" role="status">{note && <span>{note}</span>}</span>
          </div>
          <div className="box">
            <textarea ref={input} rows={1} aria-label="요청 입력" placeholder="예: 이번 주 메일에서 할 일만 뽑아줘"
              value={text} onChange={(e) => edit(e.target.value)} onKeyDown={onKeyDown} />
            <div className="ctrl">
              <button className="ib" type="button" aria-label="파일 첨부" title="파일 첨부 · 준비 중" disabled>
                <Icon name="plus" />
              </button>
              <span className="grow" />
              <button className="model" type="button" disabled title="허용된 모델만 보여요 · 서버 연결 후 고를 수 있어요">
                기본 모델<Icon name="down" />
              </button>
              <button className="ib" type="button" aria-label="음성 입력" title="음성 입력 · 준비 중" disabled>
                <Icon name="mic" />
              </button>
              <button className="send" type="button" aria-label="보내기" title="보내기" disabled={!canSend} onClick={send}>
                <Icon name="up" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
