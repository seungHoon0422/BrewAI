// 사이드바 프로젝트 목록 = 지금 스페이스의 프로젝트 (GET /api/spaces/{id}/projects) + [새 프로젝트]. 이름을 누르면 프로젝트 화면.
// 프로젝트마다 그 프로젝트 대화가 아래로 묶인다 (▸ 로 펼치기 · 최근 5개 + '모두 보기' = 프로젝트 화면). 지금 연 대화 · 화면의 프로젝트는 저절로 펼친다.
// 펼친 프로젝트는 이 기기에 기억한다 (localStorage · 못 쓰면 기억 없이)
import { useId, useMemo, useState } from 'react';
import { Button, Icon, IconButton } from '@brewai/ui';
import { ThreadItem, useRecents } from '../../chat/components/RecentList';
import { GROUP, kindIcon } from '../../scope/model';
import { PROJECTS } from '../copy';
import { loadProjects, useProjects } from '../hooks';
import { ProjectDialog } from './ProjectDialog';

const OPEN_KEY = 'brewai.sidebar.projects.open';
const IN_PROJECT = 5;

function readOpen(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
function saveOpen(s: Set<string>) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...s].slice(-50)));
  } catch {
    // 기억 없이
  }
}

export function ProjectList({ current, thread, onOpen, onOpenThread }: {
  current: string | null; // 지금 연 프로젝트 화면
  thread: string | null; // 지금 연 대화
  onOpen: (id: string) => void;
  onOpenThread: (id: string) => void;
}) {
  const projects = useProjects();
  const recents = useRecents();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(readOpen);
  const [closed, setClosed] = useState<Set<string>>(() => new Set()); // 이번에 직접 접은 것 (저절로 펼침보다 먼저)
  const labelId = useId();
  const icon = kindIcon(GROUP) ?? 'folder';
  const byProject = useMemo(() => {
    const m = new Map<string, typeof recents>();
    for (const r of recents) if (r.project) m.set(r.project, [...(m.get(r.project) ?? []), r]);
    return m;
  }, [recents]);
  const threadProject = recents.find((r) => r.id === thread)?.project ?? null;
  const toggle = (id: string, now: boolean) => {
    const next = new Set(open);
    const shut = new Set(closed);
    if (now) {
      next.delete(id);
      shut.add(id);
    } else {
      next.add(id);
      shut.delete(id);
    }
    setOpen(next);
    setClosed(shut);
    saveOpen(next);
  };

  return (
    <>
      <div className="label">
        <span id={labelId}>{PROJECTS.label}</span>
        <IconButton icon="plus" size="sm" label={PROJECTS.new} className="label-act" onClick={() => setCreating(true)} />
      </div>
      <ul className="list" aria-labelledby={labelId}>
        {projects.list.map((p) => {
          const chats = byProject.get(p.id) ?? [];
          const expanded = !closed.has(p.id) && (open.has(p.id) || p.id === threadProject || p.id === current);
          const listId = `proj-chats-${p.id}`;
          return (
            <li key={p.id} className="proj-node" data-open={expanded ? '' : undefined}>
              <div className="proj-row">
                <button className="item" type="button" title={p.description || p.name} aria-current={p.id === current ? 'true' : undefined}
                  onClick={() => onOpen(p.id)}>
                  <Icon name={icon} size="sm" />
                  <span className="t">{p.name}</span>
                </button>
                {chats.length > 0 && (
                  <IconButton size="sm" className="proj-toggle" icon={expanded ? 'chevron-down' : 'chevron-right'}
                    label={PROJECTS.chatsOf(p.name)} aria-expanded={expanded} aria-controls={listId}
                    onClick={() => toggle(p.id, expanded)} />
                )}
              </div>
              {expanded && chats.length > 0 && (
                <ul className="list proj-chats" id={listId} aria-label={PROJECTS.chatsOf(p.name)}>
                  {chats.slice(0, IN_PROJECT).map((r) => (
                    <li key={r.id}><ThreadItem r={r} current={thread} onOpen={onOpenThread} /></li>
                  ))}
                  {chats.length > IN_PROJECT && (
                    <li>
                      <button className="item more" type="button" onClick={() => onOpen(p.id)}>{PROJECTS.allChats(chats.length)}</button>
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
        {projects.list.length === 0 && projects.status === 'loading' && <li className="item muted">{PROJECTS.loading}</li>}
        {projects.list.length === 0 && projects.status === 'ready' && (
          <li>
            <button className="item more" type="button" onClick={() => setCreating(true)}>
              <Icon name="plus" size="sm" /><span className="t">{PROJECTS.new}</span>
            </button>
          </li>
        )}
        {projects.status === 'error' && (
          <li className="item muted">
            <span className="t">{PROJECTS.failed}</span>
            <Button variant="ghost" size="sm" className="retry" onClick={() => void loadProjects()}>{PROJECTS.retry}</Button>
          </li>
        )}
      </ul>
      <ProjectDialog open={creating} onClose={() => setCreating(false)} onCreated={onOpen} />
    </>
  );
}
