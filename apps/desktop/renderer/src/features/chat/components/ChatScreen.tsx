// 대화 — 홈(마크 · 제목 · 제안 · 앱으로 해 보기(쓸 수 있는 앱이 있을 때만) · 입력창) / 프로젝트 화면(머리 · 입력창 · 그 대화들) → 보내면 대화 화면(경로 · 제목 · 공유 · 메시지 · 입력창).
// 제안을 누르면 입력창에 넣지 않고 바로 보낸다. 홈에서 보내면 홈이 빠지고 말풍선이 대화 자리로 올라간다 (motion.ts).
// 상태는 hooks.ts (앱 전체 store): 메뉴를 옮겨도 답은 계속 받고, 진행 상황 화면이 같은 실행을 본다.
// App 이 대화가 바뀔 때마다 key 를 바꿔 이 화면을 새로 만든다 → 입력 중인 글이 비고 입력창에 포커스.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
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
import { FileViewer } from '../../files/components/FileViewer';
import { FILES } from '../../files/copy';
import { closeViewer, readWidth, saveWidth, setActiveThread, useViewer } from '../../files/viewer';
import { Resizer } from '../../shell/components/Resizer';
import { SIDE } from '../panel-copy';
import { SIDE_MAX, SIDE_MIN, SidePanel } from './SidePanel';
import { closeTeamPanel, openFilesPanel, openTeamPanel, useSidePanel } from './TeamPanel';
import { ThreadList } from './ThreadList';

// 폭 기억 (이 기기) · 대화 칸은 최소 CHAT_MIN (뷰어 · 패널이 넓어져도 입력창이 쓸 만하게)
const SIDE_KEY = 'brewai.chat.sideWidth';
const VIEW_KEY = 'brewai.chat.viewerWidth';
const VIEW_MIN = 320;
const CHAT_MIN = 360;

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
  const panel = useSidePanel(conv); // 오른쪽 패널 (진행 상황 · 파일)
  const toggle = useRef<HTMLButtonElement>(null); // 패널을 닫으면 포커스가 돌아올 곳 (덮개가 덮던 머리 토글)
  const filesToggle = useRef<HTMLButtonElement>(null);
  const lastToggle = useRef<HTMLButtonElement | null>(null);
  const viewing = useViewer(conv?.id ?? null); // 가운데 파일 뷰어 (이 대화에서 연 파일)
  const [sideW, setSideW] = useState(() => readWidth(SIDE_KEY, 340, SIDE_MIN, SIDE_MAX));
  const [viewW, setViewW] = useState(() => readWidth(VIEW_KEY, 560, VIEW_MIN, 4000));
  const [boxW, setBoxW] = useState(0); // 대화 화면 폭 (뷰어 최대 = 대화가 CHAT_MIN 을 지키는 만큼)
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
  useEffect(() => {
    setActiveThread(conv?.id ?? null);
    return () => setActiveThread(null);
  }, [conv?.id]);
  const box = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoxW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [conv?.id]);

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
  const togglePanel = () => {
    lastToggle.current = toggle.current;
    if (panel.open && panel.tab === 'team') closeTeamPanel(conv.id);
    else openTeamPanel(conv.id);
  };
  const toggleFiles = () => {
    lastToggle.current = filesToggle.current;
    if (panel.open && panel.tab === 'files') closeTeamPanel(conv.id);
    else openFilesPanel(conv.id);
  };
  // 열 = 대화 | 뷰어 | 오른쪽 패널. 칸에 들어가는지는 창이 아니라 이 화면의 실제 폭(boxW · 왼쪽 사이드바를 뺀 폭)으로 판정한다 —
  // 안 들어가면 그 칸은 덮개 (최소 폭 합이 화면보다 크면 문서 전체가 밀리던 것 · 2026-11-04). 대화는 늘 CHAT_MIN 을 지킨다
  const wide = panel.wide;
  const room = boxW || 1600;
  // 뷰어가 열려 있으면 패널이 먼저 줄어든다 (SIDE_MIN 까지) = 세 칸이 되도록 · 그래도 모자라면 뷰어만 덮개
  const sideInline = panel.open && wide && room >= CHAT_MIN + SIDE_MIN;
  const sideRoom = viewing ? Math.max(SIDE_MIN, room - CHAT_MIN - VIEW_MIN) : room - CHAT_MIN;
  const sideCol = sideInline ? Math.min(sideW, sideRoom, room - CHAT_MIN) : 0;
  const viewMax = room - CHAT_MIN - sideCol;
  const viewInline = !!viewing && wide && viewMax >= VIEW_MIN;
  const viewCol = viewInline ? Math.min(viewW, viewMax) : 0;
  const cols = [`minmax(${viewCol || sideCol ? CHAT_MIN : 0}px,1fr)`, viewCol && `${viewCol}px`, sideCol && `${sideCol}px`].filter(Boolean).join(' ');
  return (
    <section ref={box} className={cx('view thread', sideCol + viewCol > 0 && 'has-side')} style={{ '--thread-cols': cols } as CSSProperties}>
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
            {panel.team && <IconButton ref={toggle} icon="team" size="sm" label={TEAM.toggle} pressed={panel.open && panel.tab === 'team'} onClick={togglePanel} />}
            <IconButton ref={filesToggle} icon="file" size="sm" label={SIDE.filesToggle} pressed={panel.open && panel.tab === 'files'} onClick={toggleFiles} />
          </div>
        </div>
        <Messages conv={conv} />
        <div className="dock2">
          <div className="col">
            {where.mine ? composer : <p className="readonly"><Icon name="lock" size="sm" />{CHAT.readOnly(where.owner_name ?? '')}</p>}
          </div>
        </div>
      </div>
      {viewing && (
        <FileViewer file={viewing} overlay={!viewInline} onClose={closeViewer}
          handle={viewInline && <Resizer label={FILES.viewerResize} value={viewCol} min={VIEW_MIN} max={viewMax} onChange={setViewW} onCommit={(v) => saveWidth(VIEW_KEY, v)} />} />
      )}
      {panel.open && (
        <SidePanel conv={conv} tab={panel.tab} overlay={!sideInline} width={sideCol || sideW} onWidth={setSideW} onCommit={(v) => saveWidth(SIDE_KEY, v)}
          onClose={() => (lastToggle.current ?? filesToggle.current)?.focus()} />
      )}
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
