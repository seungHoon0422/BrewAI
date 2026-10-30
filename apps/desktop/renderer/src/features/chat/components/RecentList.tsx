// 사이드바 최근 대화 = 지금 스페이스의 대화 (GET /api/threads?space=) + 이 창에서 막 시작한 대화. 남의 공유 대화엔 닉네임 꼬리표
import { useId, useMemo, useState } from 'react';
import { Button, Spinner } from '@brewai/ui';
import { useScopeState } from '../../scope/hooks';
import { RECENT } from '../copy';
import { loadThreads, recents, useChat } from '../hooks';

const RECENT_FIRST = 12; // 처음엔 12개, '더 보기' 로 전부 (최대 50)

export function RecentList({ current, onOpen }: { current: string | null; onOpen: (id: string) => void }) {
  const threads = useChat((s) => s.threads);
  const convs = useChat((s) => s.convs);
  const spaceId = useScopeState((s) => s.spaceId);
  const items = useMemo(() => recents({ threads, convs }, spaceId), [threads, convs, spaceId]);
  const [more, setMore] = useState(false);
  const labelId = useId();
  const shown = more ? items : items.slice(0, RECENT_FIRST);
  const status = threads.status;
  return (
    <>
      <div className="label" id={labelId}>{RECENT.label}</div>
      <ul className="list" aria-labelledby={labelId}>
        {shown.map((r) => (
          <li key={r.id}>
            <button className="item" type="button" title={r.title}
              aria-current={r.id === current ? 'true' : undefined} onClick={() => onOpen(r.id)}>
              <span className="t">{r.title}</span>
              {!r.mine && r.owner && <span className="owner-tag" title={RECENT.sharedBy(r.owner)}>{r.owner}</span>}
              {r.running && <span className="run" role="img" aria-label={RECENT.running}><Spinner size="xs" /></span>}
            </button>
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
