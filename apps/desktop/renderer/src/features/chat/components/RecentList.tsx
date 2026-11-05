// 사이드바 최근 대화 = 지금 스페이스의 프로젝트 밖 대화 (GET /api/threads?space=) + 이 창에서 막 시작한 대화. 남의 공유 대화엔 닉네임 꼬리표.
// 프로젝트 대화는 사이드바 프로젝트 줄 아래에 묶인다 (ProjectList). 목록에 없는 프로젝트(보관 등)의 대화는 여기 남는다
import { useId, useMemo, useState } from 'react';
import { Button, Spinner } from '@brewai/ui';
import { useProjects } from '../../projects/hooks';
import { useScopeState } from '../../scope/hooks';
import { RECENT } from '../copy';
import { loadThreads, recents, useChat, type RecentItem } from '../hooks';

const RECENT_FIRST = 12; // 처음엔 12개, '더 보기' 로 전부 (최대 50)

// 지금 스페이스의 대화 전부 (새 것이 위) — 최근 목록 · 프로젝트 묶음이 같이 쓴다
export function useRecents(): RecentItem[] {
  const threads = useChat((s) => s.threads);
  const convs = useChat((s) => s.convs);
  const spaceId = useScopeState((s) => s.spaceId);
  return useMemo(() => recents({ threads, convs }, spaceId), [threads, convs, spaceId]);
}

// 대화 한 줄 (최근 · 프로젝트 묶음 공통)
export function ThreadItem({ r, current, onOpen }: { r: RecentItem; current: string | null; onOpen: (id: string) => void }) {
  return (
    <button className="item" type="button" title={r.title} aria-current={r.id === current ? 'true' : undefined} onClick={() => onOpen(r.id)}>
      <span className="t">{r.title}</span>
      {!r.mine && r.owner && <span className="owner-tag" title={RECENT.sharedBy(r.owner)}>{r.owner}</span>}
      {r.running && <span className="run" role="img" aria-label={RECENT.running}><Spinner size="xs" /></span>}
    </button>
  );
}

export function RecentList({ current, onOpen }: { current: string | null; onOpen: (id: string) => void }) {
  const all = useRecents();
  const projects = useProjects();
  const items = useMemo(() => {
    const known = new Set(projects.list.map((p) => p.id));
    return all.filter((r) => !r.project || !known.has(r.project));
  }, [all, projects.list]);
  const status = useChat((s) => s.threads.status);
  const [more, setMore] = useState(false);
  const labelId = useId();
  const shown = more ? items : items.slice(0, RECENT_FIRST);
  return (
    <>
      <div className="label" id={labelId}>{RECENT.label}</div>
      <ul className="list" aria-labelledby={labelId}>
        {shown.map((r) => (
          <li key={r.id}>
            <ThreadItem r={r} current={current} onOpen={onOpen} />
          </li>
        ))}
        {items.length > RECENT_FIRST && (
          <li>
            <button className="item more" type="button" onClick={() => setMore((v) => !v)}>
              {more ? RECENT.less : RECENT.more(items.length - RECENT_FIRST)}
            </button>
          </li>
        )}
        {items.length === 0 && status === 'loading' && <li className="item muted">{RECENT.loading}</li>}
        {items.length === 0 && status === 'ready' && <li className="item muted">{RECENT.empty}</li>}
        {status === 'error' && (
          <li className="item muted">
            <span className="t">{RECENT.failed}</span>
            <Button variant="ghost" size="sm" className="retry" onClick={() => void loadThreads()}>{RECENT.retry}</Button>
          </li>
        )}
      </ul>
    </>
  );
}
