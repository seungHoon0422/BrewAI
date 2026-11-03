// 입력창 — 위 줄(범위 칩 · 앱 연결) + 흰 상자(글 · 첨부 · 모델 · 음성 · 보내기/멈추기). Enter = 보내기 · Shift+Enter = 줄바꿈.
// 범위 칩(프로젝트 고르기 · 옮기기)은 부르는 쪽이 scope 로 넘긴다 — 입력창은 층을 모른다. tools = 첨부 옆 단추 (개발 빌드의 '샘플' 메뉴).
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { Icon, IconButton } from '@brewai/ui';
import { href } from '../../../app/menu';
import { ModelPicker } from '../../models/components/ModelPicker';
import { CHAT } from '../copy';

export function Composer({ input, text, onText, onSend, canSend, busy, onStop, placeholder, scope, tools }: {
  input: RefObject<HTMLTextAreaElement | null>;
  text: string;
  onText: (v: string) => void;
  onSend: () => void;
  canSend: boolean;
  busy: boolean;
  onStop: () => void;
  placeholder: string;
  scope?: ReactNode;
  tools?: ReactNode;
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
      <div className="composer-ctx">
        {scope}
        <a href={href('connections')}>
          <Icon name="link" size="sm" />{CHAT.connectApps}
        </a>
      </div>
      <div className="box">
        <textarea ref={input} rows={1} aria-label={CHAT.input} placeholder={placeholder}
          value={text} onChange={(e) => onText(e.target.value)} onKeyDown={onKeyDown} />
        <div className="ctrl">
          <IconButton icon="plus" label={CHAT.attach} title={CHAT.attachSoon} disabled />
          {tools}
          <span className="grow" />
          <ModelPicker />
          <IconButton icon="mic" label={CHAT.voice} title={CHAT.voiceSoon} disabled />
          {busy ? (
            <IconButton icon="stop" label={CHAT.stop} variant="primary" shape="round" className="send-stop" onClick={onStop} />
          ) : (
            <IconButton icon="arrow-up" label={CHAT.send} variant="primary" shape="round" disabled={!canSend} onClick={onSend} />
          )}
        </div>
      </div>
    </div>
  );
}
