// 사이드바 프로젝트 목록 = 지금 스페이스의 프로젝트 (GET /api/spaces/{id}/projects) + [새 프로젝트]. 누르면 프로젝트 화면
import { useId, useState } from 'react';
import { Button, Icon, IconButton } from '@brewai/ui';
import { GROUP, kindIcon } from '../../scope/model';
import { PROJECTS } from '../copy';
import { loadProjects, useProjects } from '../hooks';
import { ProjectDialog } from './ProjectDialog';

export function ProjectList({ current, onOpen }: { current: string | null; onOpen: (id: string) => void }) {
  const projects = useProjects();
  const [creating, setCreating] = useState(false);
  const labelId = useId();
  const icon = kindIcon(GROUP) ?? 'folder';
  return (
    <>
      <div className="label">
        <span id={labelId}>{PROJECTS.label}</span>
        <IconButton icon="plus" size="sm" label={PROJECTS.new} className="label-act" onClick={() => setCreating(true)} />
      </div>
      <ul className="list" aria-labelledby={labelId}>
        {projects.list.map((p) => (
          <li key={p.id}>
            <button className="item" type="button" title={p.description || p.name} aria-current={p.id === current ? 'true' : undefined}
              onClick={() => onOpen(p.id)}>
              <Icon name={icon} size="sm" />
              <span className="t">{p.name}</span>
            </button>
          </li>
        ))}
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
