// 입력창 — 위 줄(범위 칩 · 앱 연결) + 흰 상자(첨부 칩 · 글 · 첨부 · 모델 · 음성 · 보내기/멈추기). Enter = 보내기 · Shift+Enter = 줄바꿈.
// 범위 칩(프로젝트 고르기 · 옮기기)은 부르는 쪽이 scope 로 넘긴다 — 입력창은 층을 모른다. tools = 첨부 옆 단추 (개발 빌드의 '샘플' 메뉴).
// 첨부 (slice 07) = + 버튼 · 끌어다 놓기 · 붙여넣기 → onFiles (올리기는 부르는 쪽 · features/files) · chips = 칩 줄 (전달 배지)
import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Icon, IconButton, cx } from '@brewai/ui';
import { FILES } from '../../files/copy';
import { href } from '../../../app/menu';
import { ModelPicker } from '../../models/components/ModelPicker';
import { CHAT } from '../copy';

export function Composer({ input, text, onText, onSend, canSend, busy, onStop, placeholder, scope, tools, onFiles, chips }: {
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
  onFiles?: (files: File[]) => void;
  chips?: ReactNode;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const onDrag = (e: DragEvent<HTMLDivElement>) => {
    if (!onFiles || !hasFiles(e)) return;
    e.preventDefault();
    setOver(e.type !== 'dragleave');
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!onFiles || !hasFiles(e)) return;
    e.preventDefault();
    setOver(false);
    onFiles(Array.from(e.dataTransfer.files));
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (!onFiles || !files.length) return; // 글 붙여넣기는 그대로
    e.preventDefault();
    onFiles(files);
  };
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
        <a href={href('settings/connections')}>
          <Icon name="link" size="sm" />{CHAT.connectApps}
        </a>
      </div>
      <div className={cx('box', over && 'is-drop')} onDragEnter={onDrag} onDragOver={onDrag} onDragLeave={onDrag} onDrop={onDrop}>
        {over && <div className="drop-hint" aria-hidden="true"><Icon name="paperclip" />{FILES.drop}</div>}
        {chips}
        <textarea ref={input} rows={1} aria-label={CHAT.input} placeholder={placeholder}
          value={text} onChange={(e) => onText(e.target.value)} onKeyDown={onKeyDown} onPaste={onPaste} />
        <div className="ctrl">
          {onFiles ? (
            <>
              <IconButton icon="plus" label={CHAT.attach} title={FILES.attachHint} onClick={() => picker.current?.click()} />
              <input ref={picker} type="file" multiple hidden aria-hidden="true" tabIndex={-1} data-testid="attach-input"
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.txt,.md,.csv,.json,.tsv,.log,.py,.ts,.tsx,.js,.jsx,.java,.go,.rs,.sql,.yaml,.yml,.html,.css,.xml,.docx,.xlsx,.pptx"
                onChange={(e) => {
                  const files = Array.from(e.currentTarget.files ?? []);
                  e.currentTarget.value = '';
                  if (files.length) onFiles(files);
                }} />
            </>
          ) : (
            <IconButton icon="plus" label={CHAT.attach} title={CHAT.attachSoon} disabled />
          )}
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
