// 대화 — 홈(마크 · 제목 · 제안 · 앱으로 해 보기(쓸 수 있는 앱이 있을 때만) · 입력창) / 프로젝트 화면(머리 · 입력창 · 그 대화들) → 보내면 대화 화면(경로 · 제목 · 공유 · 메시지 · 입력창).
// 제안을 누르면 입력창에 넣지 않고 바로 보낸다. 홈에서 보내면 홈이 빠지고 말풍선이 대화 자리로 올라간다 (motion.ts).
// 상태는 hooks.ts (앱 전체 store): 메뉴를 옮겨도 답은 계속 받고, 진행 상황 화면이 같은 실행을 본다.
// App 이 대화가 바뀔 때마다 key 를 바꿔 이 화면을 새로 만든다 → 입력 중인 글이 비고 입력창에 포커스.
import { useEffect, useRef, useState } from 'react';
import { Icon, IconButton, Mark, cx } from '@brewai/ui';
import { openChat, openCrumb } from '../../../app/navigate';
import { isReady, useConnections } from '../../connections/hooks';
import { ProjectHeader } from '../../projects/components/ProjectHeader';
import { ProjectPicker } from '../../projects/components/ProjectPicker';
import { PROJECTS } from '../../projects/copy';
import { useProject } from '../../projects/hooks';
import { ScopeBreadcrumb } from '../../scope/components/ScopeBreadcrumb';
import { focusProject, useCurrentSpace, useScopeState } from '../../scope/hooks';
import { devBuild } from '../../../lib/bridge';
import { ShareButton } from '../../sharing/components/ShareButton';
import { CHAT, SUGGESTIONS, TEAM, TOOL_TRY, appStarters, type Starter } from '../copy';
import { send, stop, updateThread, useConvBusy, useCurrentConv } from '../hooks';
import { leaveHome } from '../motion';
import { Composer } from './Composer';
import { DraftChips } from '../../files/components/FileChips';
import { ProjectFiles } from '../../files/components/ProjectFiles';
import { addFiles, take, uploading as isUploading, useDrafts, usePlans } from '../../files/hooks';
import { effectiveModel, useModelState } from '../../models/hooks';
import { Messages } from './Messages';
import { SampleMenu } from './SampleMenu';
import { TeamPanel, closeTeamPanel, openTeamPanel, useTeamPanel } from './TeamPanel';
import { ThreadList } from './ThreadList';

export function ChatScreen() {
  const conv = useCurrentConv();
  const busy = useConvBusy();
  const space = useCurrentSpace();
  const project = useProject(useScopeState((s) => s.projectId));
  // 앱 제안 = 지금 바로 쓸 수 있는 앱(연결됨 · 인증 없음) 중 첫 번째 이름으로. 없으면 스킬 제안만
  const readyApp = useConnections((s) => s.apps.data?.mine.find((a) => !a.hidden && isReady(a))?.name ?? null);
  const [text, setText] = useState('');
  const [moveError, setMoveError] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const view = useRef<HTMLElement>(null);
  const loading = conv?.load === 'loading';
  const panel = useTeamPanel(conv); // 오른쪽 진행 상황 (팀이 생긴 대화만)
  const toggle = useRef<HTMLButtonElement>(null); // 패널을 닫으면 포커스가 돌아올 곳 (덮개가 덮던 머리 토글)
  // 첨부 (slice 07): 입력창마다 따로 (새 대화 = 'new') · 전달 배지 = 지금 고른 모델로 서버에 묻는다
  const draftKey = conv?.id ?? 'new';
  const drafts = useDrafts(draftKey);
  const modelId = useModelState((s) => effectiveModel(s)?.id ?? null);
  const readyIds = drafts.flatMap((d) => (d.file ? [d.file.id] : []));
  const plans = usePlans(readyIds, modelId);
  const pending = drafts.some((d) => d.status === 'uploading');
  const canSend = (text.trim() !== '' || readyIds.length > 0) && !pending && !busy && !loading;
  const onFiles = (files: File[]) => addFiles(draftKey, files, { space: conv?.scope.space_id ?? space?.id ?? null, project: null });

  useEffect(() => input.current?.focus(), []);

  // 새 대화(홈 · 프로젝트 화면)에서 보내면 이 화면이 대화 화면으로 바뀐다 → 바뀌기 직전 자리를 넘긴다 (from = 글이 있던 자리)
  const sendFrom = (ask: string, from: Element | null, files: ReturnType<typeof take> = []) => {
    if (!conv) leaveHome(view.current, ask.trim(), from);
    return send(ask, files);
  };
  const onSend = () => {
    if (!canSend || isUploading(draftKey)) return;
    if (sendFrom(text, input.current, take(draftKey))) setText('');
    input.current?.focus();
  };
  // 제안 = 바로 보낸다 (입력창은 그대로 · 쓰던 글이 있어도 지우지 않는다)
  const onStarter = (s: Starter, el: HTMLElement) => {
    if (busy || loading) return;
    sendFrom(s.prompt, el.querySelector('.sg-t') ?? el);
  };
  // 개발용 샘플 = 제안과 같은 길 (메뉴 칸은 닫히며 사라지니 출발 자리는 입력창)
  // 포커스 = 입력창으로 (메뉴는 닫히며 샘플 단추로 돌려놓는데, 보내는 동안 그 단추가 disabled 가 되어 포커스가 body 로 빠진다 → 그 다음 프레임에)
  const onSample = (prompt: string) => {
    if (busy || loading) return;
    sendFrom(prompt, input.current);
    requestAnimationFrame(() => input.current?.focus());
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
    <Composer input={input} text={text} onText={setText} onSend={onSend} canSend={canSend} onFiles={onFiles}
      chips={<DraftChips drafts={drafts} plans={plans} draftKey={draftKey} />}
      busy={busy} onStop={() => conv && stop(conv.id)} scope={scope}
      tools={devBuild && <SampleMenu onPick={onSample} disabled={busy || loading} />}
      placeholder={loading ? CHAT.placeholderLoading : conv?.turns.length ? CHAT.placeholderThread : project ? PROJECTS.composerHint(project.name) : CHAT.placeholderHome} />
  );

  if (!conv && project) {
    return (
      <section className="view proj" ref={view}>
        <div className="proj-in">
          <ProjectHeader project={project} />
          {composer}
          <ProjectFiles projectId={project.id} spaceId={project.space_id} />
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
      <section className="view home" ref={view}>
        <div className="hero">
          <Mark size={40} />
          <h1>{CHAT.homeTitle}</h1>
        </div>
        <div className="dock">
          <div className="suggest-box">
            <StarterList items={SUGGESTIONS} onPick={onStarter} />
            {readyApp && (
              <>
                <h2 className="suggest-h" id="tool-try">{TOOL_TRY.label}</h2>
                <StarterList items={appStarters(readyApp)} onPick={onStarter} labelledBy="tool-try" />
              </>
            )}
          </div>
          {composer}
        </div>
      </section>
    );
  }

  const { scope: where } = conv;
  // 서버에 있는 내 대화 + 공유 스페이스일 때만 (내 스페이스엔 멤버가 없다)
  const onServer = conv.load !== 'local' || conv.turns.some((t) => t.answer.status === 'done');
  const canShare = where.mine && onServer && space?.kind === 'shared' && where.space_id === space.id;
  const togglePanel = () => (panel.open ? closeTeamPanel(conv.id) : openTeamPanel(conv.id));
  return (
    <section className={cx('view thread', panel.open && 'has-team')}>
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
            {panel.team && <IconButton ref={toggle} icon="team" size="sm" label={TEAM.toggle} pressed={panel.open} onClick={togglePanel} />}
          </div>
        </div>
        <Messages conv={conv} />
        <div className="dock2">
          <div className="col">
            {where.mine ? composer : <p className="readonly"><Icon name="lock" size="sm" />{CHAT.readOnly(where.owner_name ?? '')}</p>}
          </div>
        </div>
      </div>
      {panel.open && <TeamPanel conv={conv} overlay={!panel.wide} onClose={() => toggle.current?.focus()} />}
    </section>
  );
}

// 제안 줄 = 아이콘 · 글 · 오른쪽 꼬리표 (동시 실행 · 여러 단계). 누르면 바로 보낸다
function StarterList({ items, onPick, labelledBy }: { items: readonly Starter[]; onPick: (s: Starter, el: HTMLElement) => void; labelledBy?: string }) {
  return (
    <ul className="suggest" aria-labelledby={labelledBy}>
      {items.map((s) => (
        <li key={s.prompt}>
          <button className="sg" type="button" data-prompt={s.prompt} onClick={(e) => onPick(s, e.currentTarget)}>
            <Icon name={s.icon} />
            <span className="sg-t">{s.text}</span>
            {s.tag && <span className="need">{s.tag}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
