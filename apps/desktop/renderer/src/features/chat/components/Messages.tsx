// 대화 내용 (role=log) — 질문 말풍선 · 답 · 기록 불러오는 중 · 기록 실패. 맨 아래를 보고 있으면 새 글을 따라 내려간다.
import { useLayoutEffect, useRef } from 'react';
import { Button, Spinner, StatusDot } from '@brewai/ui';
import { CHAT, FAILURE_TEXT } from '../copy';
import { reloadThread } from '../hooks';
import type { Conv } from '../model';
import { AnswerView } from './AnswerView';

const STICK_PX = 48;

export function Messages({ conv }: { conv: Conv }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // 위로 올려 읽는 중이면 그대로
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
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
  };
  return (
    <div className="msgs ui-scroll" ref={box} onScroll={onScroll}>
      <div className="col" role="log" aria-label={CHAT.log} aria-live="polite">
        {conv.turns.map((t, i) => (
          <div key={t.id} className="turn">
            <div className="msg user enter"><div className="bubble">{t.ask}</div></div>
            <AnswerView turn={t} latest={i === conv.turns.length - 1} threadId={conv.id} />
          </div>
        ))}
        {conv.load === 'loading' && (
          <p className="msg note"><Spinner size="xs" />{CHAT.loadingHistory}</p>
        )}
        {conv.load === 'error' && conv.loadError && (
          <div className="msg agent fail" role="alert">
            <StatusDot state="fail" className="fdot" />
            <span>{conv.loadError === 'not_found' ? CHAT.historyGone : CHAT.historyFailed(FAILURE_TEXT[conv.loadError])}</span>
            {conv.loadError !== 'not_found' && <Button onClick={() => reloadThread(conv.id)}>{CHAT.retry}</Button>}
          </div>
        )}
      </div>
    </div>
  );
}
