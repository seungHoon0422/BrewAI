// 프로젝트 설정 서랍 — 만든 사람 · 스페이스 운영: 이름 · 설명 · 지침 · 보관 / 그 밖: 읽기만
import { useState, type FormEvent } from 'react';
import { Button, Callout, Dialog, KeyValue, Sheet } from '@brewai/ui';
import { codeOf } from '../../../lib/api';
import type { Project } from '../api';
import { PROJECTS, projectError } from '../copy';
import { saveProject } from '../hooks';
import { ProjectFields, tidy } from './ProjectForm';

export function ProjectSheet({ project, open, onClose }: { project: Project; open: boolean; onClose: () => void }) {
  const initial = { name: project.name, description: project.description, instructions: project.instructions };
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const t = tidy(value);
  const dirty = t.name !== project.name || t.description !== project.description || t.instructions !== project.instructions;

  const run = async (patch: Parameters<typeof saveProject>[1], after: () => void) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await saveProject(project.id, patch);
      after();
    } catch (e) {
      setError(projectError(codeOf(e)));
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (dirty && t.name) void run(t, () => setSaved(true));
  };

  return (
    <Sheet open={open} onClose={onClose} title={PROJECTS.settings} description={project.name}
      footer={project.can_edit ? <>
        <Button variant="danger" onClick={() => setConfirm(true)} disabled={busy}>{PROJECTS.archive}</Button>
        <span className="grow" />
        <Button variant="primary" type="submit" form="project-edit" loading={busy} disabled={!dirty || !t.name}>{PROJECTS.save}</Button>
      </> : undefined}>
      {project.can_edit ? (
        <form id="project-edit" className="form" onSubmit={submit} noValidate>
          {error && <Callout tone="danger" live onDismiss={() => setError(null)}>{error}</Callout>}
          {saved && <Callout tone="ok" live onDismiss={() => setSaved(false)}>{PROJECTS.saved}</Callout>}
          <ProjectFields value={value} onChange={(v) => { setValue(v); setSaved(false); }} />
        </form>
      ) : (
        <div className="form">
          <KeyValue items={[
            { label: PROJECTS.name, value: project.name },
            { label: PROJECTS.description, value: project.description || '—' },
            { label: PROJECTS.instructions, value: <span className="pre">{project.instructions || '—'}</span> },
          ]} />
          <p className="form-note">{PROJECTS.readOnly}</p>
        </div>
      )}
      <Dialog size="sm" open={confirm} onClose={() => setConfirm(false)} title={PROJECTS.archiveTitle} description={PROJECTS.archiveBody}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirm(false)}>{PROJECTS.cancel}</Button>
          <Button variant="danger" loading={busy} onClick={() => void run({ archived: true }, () => { setConfirm(false); onClose(); })}>
            {PROJECTS.archive}
          </Button>
        </>} />
    </Sheet>
  );
}
