// 프로젝트 화면 머리 — 이름(h1) · 설명 · 만든 사람 · 지침 꼬리표 · 로컬 폴더 줄 · ⚙ 설정 서랍
import { useState } from 'react';
import { Badge, Icon, IconButton } from '@brewai/ui';
import { GROUP, kindIcon } from '../../scope/model';
import type { Project } from '../api';
import { PROJECTS } from '../copy';
import { ProjectFolder } from './ProjectFolder';
import { ProjectSheet } from './ProjectSheet';

export function ProjectHeader({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="proj-head">
      <span className="ui-tile" data-size="lg" aria-hidden="true"><Icon name={kindIcon(GROUP) ?? 'folder'} /></span>
      <div className="proj-titles">
        <h1>{project.name}</h1>
        {project.description && <p className="proj-desc">{project.description}</p>}
        <p className="proj-meta">
          {project.created_by_name && <span>{PROJECTS.by(project.created_by_name)}</span>}
          {project.instructions && <Badge size="sm" tone="accent" variant="outline">{PROJECTS.hasInstructions}</Badge>}
        </p>
        <ProjectFolder projectId={project.id} />
      </div>
      <IconButton icon="gear" label={PROJECTS.settings} onClick={() => setOpen(true)} />
      <ProjectSheet key={`${project.id}:${open}`} project={project} open={open} onClose={() => setOpen(false)} />
    </header>
  );
}
