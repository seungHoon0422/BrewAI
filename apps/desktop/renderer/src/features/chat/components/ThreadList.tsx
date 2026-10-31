// 프로젝트 화면의 대화 목록 — 그 프로젝트의 내 대화 + 공유된 대화 (남의 것엔 닉네임). 누르면 그 대화
import { Badge, Icon, Meta, Spinner } from '@brewai/ui';
import { ago } from '../../../lib/format';
import { THREADS } from '../copy';
import { useThreadList } from '../hooks';

export function ThreadList({ projectId, empty, onOpen }: { projectId: string; empty: string; onOpen: (id: string) => void }) {
  const threads = useThreadList(projectId);
  if (threads.status === 'loading' && !threads.list.length) return <div className="rows-state"><Spinner size="sm" />{THREADS.loading}</div>;
  if (threads.status === 'error') return <div className="rows-state">{THREADS.failed}</div>;
  if (!threads.list.length) return <p className="rows-state">{empty}</p>;
  return (
    <ul className="rows" aria-label={THREADS.label}>
      {threads.list.map((t) => (
        <li key={t.id} className="thread-row">
          <button type="button" className="row thread-open" onClick={() => onOpen(t.id)}>
            <Icon name="chat" size="sm" />
            <span className="row-main">
              <b className="ui-ell">{t.title}</b>
              <Meta className="row-sub" items={[ago(t.updated_at), !t.mine && t.owner_name]} />
            </span>
            {t.visibility === 'shared' && <Badge size="sm">{THREADS.shared}</Badge>}
          </button>
        </li>
      ))}
    </ul>
  );
}
