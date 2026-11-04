// 오른쪽 패널 (대화 | 뷰어 | 오른쪽 패널 · 2026-11-04 사용자) — 탭 '진행 상황'(팀 트리 · TeamPanel.tsx) · '파일'(이 대화의 만든 파일 · 보낸 첨부).
// 폭 = 왼쪽 끝 손잡이로 (280~560px · 이 기기에 기억) · 좁은 창(<1100px) = 대화 위 덮개 (사람이 열면 포커스가 닫기로 · Esc · 닫으면 포커스는 머리 토글로).
// 파일 줄을 누르면 가운데 뷰어 (features/files/viewer.ts) · 저장 = 저장 대화상자.
import { useEffect, useRef, useState } from 'react';
import { Icon, IconButton, Spinner } from '@brewai/ui';
import { listFiles, type FileItem } from '../../files/api';
import { SaveButton, SaveNote, useSave } from '../../files/components/SaveButton';
import { KIND_ICON, KIND_LABEL, sizeText } from '../../files/copy';
import { openViewer } from '../../files/viewer';
import { Resizer } from '../../shell/components/Resizer';
import type { Conv } from '../model';
import { SIDE } from '../panel-copy';
import { TeamTab, closeTeamPanel, setSideTab, takeFocusOnOpen, type SideTab } from './TeamPanel';
import '../panel.css';

export const SIDE_MIN = 260;
export const SIDE_MAX = 560;

export function SidePanel({ conv, tab, overlay, width, onWidth, onCommit, onClose }: {
  conv: Conv;
  tab: SideTab;
  overlay: boolean;
  width: number;
  onWidth: (v: number) => void;
  onCommit: (v: number) => void;
  onClose?: () => void; // 닫은 뒤 (대화 화면이 포커스를 머리 토글로)
}) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  const close = () => {
    closeTeamPanel(conv.id);
    onClose?.();
  };
  // 덮개(좁은 창)를 사람이 열었다 = 포커스를 닫기 버튼으로 (토글 · 보내기 버튼이 덮개 밑에 있다)
  useEffect(() => {
    if (takeFocusOnOpen(conv.id) && overlay) closeBtn.current?.focus();
  }, [conv.id, overlay]);
  // 덮개 = Esc 로 닫는다 (포커스가 패널 밖이어도 · 다른 곳이 먼저 쓴 Esc 는 건너뛴다)
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [overlay]);
  const pick = (t: SideTab) => setSideTab(conv.id, t);
  const tabId = (t: SideTab) => `side-${t}-${conv.id}`;
  return (
    <aside className="team-panel side-panel" aria-label={SIDE.panel} data-overlay={overlay || undefined} data-tab={tab}>
      {!overlay && <Resizer label={SIDE.resize} value={width} min={SIDE_MIN} max={SIDE_MAX} onChange={onWidth} onCommit={onCommit} />}
      <div className="team-head side-head">
        <div className="side-tabs" role="tablist" aria-label={SIDE.tabs}>
          {(['team', 'files'] as const).map((t) => (
            <button key={t} type="button" role="tab" id={`${tabId(t)}-tab`} aria-controls={tabId(t)} aria-selected={tab === t}
              tabIndex={tab === t ? 0 : -1} className="side-tab" onClick={() => pick(t)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault();
                const next = t === 'team' ? 'files' : 'team';
                pick(next);
                document.getElementById(`${tabId(next)}-tab`)?.focus();
              }}>
              {t === 'team' ? SIDE.team : SIDE.files}
            </button>
          ))}
        </div>
        <IconButton ref={closeBtn} icon="close" size="sm" label={SIDE.close} onClick={close} />
      </div>
      <div className="side-body" role="tabpanel" id={tabId(tab)} aria-labelledby={`${tabId(tab)}-tab`}>
        {tab === 'team' ? <TeamTab conv={conv} /> : <ThreadFiles conv={conv} />}
      </div>
    </aside>
  );
}

// 이 대화의 파일 = 만든 파일 (make_file · 턴에 안 묶임) + 보낸 첨부 (턴에 묶임). 답이 끝날 때마다 다시 읽는다
function ThreadFiles({ conv }: { conv: Conv }) {
  const last = conv.turns.at(-1)?.answer;
  const key = `${conv.id}:${conv.turns.length}:${last?.status ?? ''}`;
  const [rows, setRows] = useState<FileItem[] | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    listFiles({ thread: conv.id }, ac.signal).then(setRows).catch(() => !ac.signal.aborted && setRows([])); // 서버에 아직 없는 대화 = 빈 목록
    return () => ac.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (rows === null) return <p className="side-empty" aria-busy="true"><Spinner size="sm" />{SIDE.loading}</p>;
  const made = rows.filter((f) => !f.run_id);
  const sent = rows.filter((f) => f.run_id);
  if (!rows.length) {
    return (
      <div className="side-empty">
        <Icon name="file" />
        <p><b>{SIDE.empty}</b></p>
        <p>{SIDE.emptyHint}</p>
      </div>
    );
  }
  return (
    <div className="side-files ui-scroll">
      {made.length > 0 && <FileGroup title={SIDE.made} files={made} />}
      {sent.length > 0 && <FileGroup title={SIDE.sent} files={sent} />}
    </div>
  );
}

function FileGroup({ title, files }: { title: string; files: FileItem[] }) {
  return (
    <section className="side-group" aria-label={title}>
      <h3>{title}</h3>
      <ul className="side-list">
        {files.map((f) => <FileRow key={f.id} f={f} />)}
      </ul>
    </section>
  );
}

function FileRow({ f }: { f: FileItem }) {
  const saving = useSave(f);
  return (
    <li className="side-file" data-kind={f.kind}>
      <button type="button" className="side-open" onClick={() => openViewer({ id: f.id, name: f.name, kind: f.kind, size: f.size })}>
        <span className="side-ico" aria-hidden="true"><Icon name={KIND_ICON[f.kind]} size="sm" /></span>
        <span className="side-name">
          <b title={f.name}>{f.name}</b>
          <span className="side-meta">{saving.st.s === 'idle' || saving.st.s === 'saving' ? `${KIND_LABEL[f.kind]} ${sizeText(f.size)}` : <SaveNote st={saving.st} />}</span>
        </span>
      </button>
      <SaveButton f={f} {...saving} iconOnly />
    </li>
  );
}
