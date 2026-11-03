// 대화 내용 (role=log) — 질문 말풍선 · 답 · 기록 불러오는 중 · 기록 실패. 맨 아래를 보고 있으면 새 글을 따라 내려간다.
// 답 글은 상태와 따로 펼쳐지므로(markdown/reveal) 높이가 바뀔 때마다(ResizeObserver) 따라간다.
// 새 질문 = 뚝 끊겨 올라가지 않게 부드럽게 내려간다 (말풍선은 아래에서 떠오른다 · chat.css) · 홈에서 막 보낸 첫 말풍선 = 입력 자리에서 올라온다 (motion.ts)
import { SentChips } from '../../files/components/FileChips';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { reduceMotion } from '../../../lib/hooks';
import { Button, Spinner, StatusDot } from '@brewai/ui';
import { CHAT, FAILURE_TEXT } from '../copy';
import { reloadThread } from '../hooks';
import type { Conv } from '../model';
import { arriveFromHome } from '../motion';
import { AnswerView } from './AnswerView';
import { lastTeamAnswer } from './TeamPanel';

const STICK_PX = 48;
const GLIDE_MS = 420; // 새 질문 뒤 부드럽게 내려가는 동안은 순간 이동으로 덮지 않는다

export function Messages({ conv }: { conv: Conv }) {
  const box = useRef<HTMLDivElement>(null);
  const col = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // 위로 올려 읽는 중이면 그대로
  const glideUntil = useRef(0);
  const seen = useRef<number | null>(null); // 처음 그린 턴 수 (처음 = 바로 아래로 · 그 뒤 늘면 부드럽게)
  const turns = conv.turns.length;
  const teamRun = lastTeamAnswer(conv)?.runId ?? null; // 오른쪽 진행 상황이 기본으로 보이는 답
  const follow = (el: HTMLElement) => {
    if (performance.now() < glideUntil.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); // 미끄러지는 중 = 목표만 새로
    else el.scrollTop = el.scrollHeight;
  };
  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) follow(el);
  });
  useLayoutEffect(() => {
    const el = box.current;
    const first = seen.current == null;
    const grew = !first && turns > (seen.current ?? 0);
    seen.current = turns;
    stick.current = true; // 새 질문 = 아래로
    if (!el || !grew || reduceMotion()) return;
    glideUntil.current = performance.now() + GLIDE_MS;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [turns]);
  // 홈에서 막 보낸 첫 질문 (이 화면이 그려진 첫 순간에만)
  useLayoutEffect(() => {
    const t = conv.turns[0];
    const bubble = col.current?.querySelector<HTMLElement>('.turn .msg.user .bubble');
    if (t && !t.resumed && conv.turns.length === 1 && bubble) arriveFromHome(bubble, t.ask);
  }, []); // 처음 한 번
  useEffect(() => {
    const el = box.current;
    const inner = col.current;
    if (!el || !inner || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stick.current) follow(el);
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []); // follow 는 ref 만 본다
  const onScroll = () => {
    const el = box.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
  };
  return (
    <div className="msgs ui-scroll" ref={box} onScroll={onScroll}>
      <div ref={col} className="col" role="log" aria-label={CHAT.log} aria-live="polite">
        {conv.turns.map((t, i) => (
          <div key={t.id} className="turn">
            {!t.resumed && (
              <div className="msg user enter">
                {t.files && <SentChips files={t.files} />}
                {t.ask && <div className="bubble">{t.ask}</div>}
              </div>
            )}
            <AnswerView turn={t} latest={i === conv.turns.length - 1} threadId={conv.id} teamRun={teamRun} />
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
