// 대화 — 홈(마크 · 제목 · 제안 3줄 · 입력창) / 프로젝트 화면(머리 · 입력창 · 그 대화들) → 보내면 대화 화면(경로 · 제목 · 공유 · 메시지 · 입력창).
// 상태는 hooks.ts (앱 전체 store): 메뉴를 옮겨도 답은 계속 받고, 진행 상황 화면이 같은 실행을 본다.
// App 이 대화가 바뀔 때마다 key 를 바꿔 이 화면을 새로 만든다 → 입력 중인 글이 비고 입력창에 포커스.
import { useEffect, useRef, useState } from 'react';
import { Icon, Mark } from '@brewai/ui';
import { openChat, openCrumb } from '../../../app/navigate';
import { ProjectHeader } from '../../projects/components/ProjectHeader';
import { ProjectPicker } from '../../projects/components/ProjectPicker';
import { PROJECTS } from '../../projects/copy';
import { useProject } from '../../projects/hooks';
import { ScopeBreadcrumb } from '../../scope/components/ScopeBreadcrumb';
import { focusProject, useCurrentSpace, useScopeState } from '../../scope/hooks';
import { ShareButton } from '../../sharing/components/ShareButton';
import { CHAT, SUGGESTIONS } from '../copy';
import { send, stop, updateThread, useConvBusy, useCurrentConv } from '../hooks';
import { Composer } from './Composer';
import { Messages } from './Messages';
import { ThreadList } from './ThreadList';

export function ChatScreen() {
  const conv = useCurrentConv();
  const busy = useConvBusy();
  const space = useCurrentSpace();
  const project = useProject(useScopeState((s) => s.projectId));
  const [text, setText] = useState('');
  const [moveError, setMoveError] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const loading = conv?.load === 'loading';
  const canSend = text.trim() !== '' && !busy && !loading;

  useEffect(() => input.current?.focus(), []);

  const onSend = () => {
    if (!canSend) return;
    if (send(text)) setText('');
    input.current?.focus();
  };

  // 프로젝트 칩: 새 대화 = 넣을 곳 고르기 · 연 대화 = 같은 스페이스 안에서 옮기기 (내 대화만)
  const scope = conv ? (
    <ProjectPicker mode="move" value={conv.scope.project_id} locked={!conv.scope.mine || busy}
      onChange={(id) => {
        setMoveError(false);
        updateThread(conv.id, { project_id: id }).catch(() => setMoveError(true));
      }} />
  ) : (
    <ProjectPicker mode="new" value={project?.id ?? null} onChange={focusProject} />
  );
  const composer = (
    <Composer input={input} text={text} onText={setText} onSend={onSend} canSend={canSend}
      busy={busy} onStop={() => conv && stop(conv.id)} scope={scope}
      placeholder={loading ? CHAT.placeholderLoading : conv?.turns.length ? CHAT.placeholderThread : project ? PROJECTS.composerHint(project.name) : CHAT.placeholderHome} />
  );

  if (!conv && project) {
    return (
      <section className="view proj">
        <div className="proj-in">
          <ProjectHeader project={project} />
          {composer}
        </div>
        <div className="proj-list ui-scroll">
          <div className="proj-in">
            <ThreadList projectId={project.id} empty={PROJECTS.threadsEmpty} onOpen={openChat} />
          </div>
        </div>
      </section>
    );
  }

  if (!conv) {
    return (
      <section className="view home">
        <div className="hero">
          <Mark size={40} />
          <h1>{CHAT.homeTitle}</h1>
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

  const { scope: where } = conv;
  // 서버에 있는 내 대화 + 공유 스페이스일 때만 (내 스페이스엔 멤버가 없다)
  const onServer = conv.load !== 'local' || conv.turns.some((t) => t.answer.status === 'done');
  const canShare = where.mine && onServer && space?.kind === 'shared' && where.space_id === space.id;
  return (
    <section className="view thread">
      <div className="conv">
        <div className="conv-head">
          <ScopeBreadcrumb path={conv.path} onNavigate={openCrumb} className="conv-scope" />
          <h1 className="t" title={conv.title}>{conv.title}</h1>
          <div className="conv-acts">
            {moveError && <span className="conv-owner" role="status">{CHAT.moveFailed}</span>}
            {!where.mine && where.owner_name && <span className="conv-owner">{where.owner_name}</span>}
            {canShare && (
              <ShareButton shared={where.visibility === 'shared'}
                onChange={(shared) => updateThread(conv.id, { visibility: shared ? 'shared' : 'private' })} />
            )}
          </div>
        </div>
        <Messages conv={conv} />
        <div className="dock2">
          <div className="col">
            {where.mine ? composer : <p className="readonly"><Icon name="lock" size="sm" />{CHAT.readOnly(where.owner_name ?? '')}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
