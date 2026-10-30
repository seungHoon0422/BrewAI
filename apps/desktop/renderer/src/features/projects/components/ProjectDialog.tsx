// 새 프로젝트 — 이름 · 설명 · 지침 (지금 스페이스에 · 멤버 누구나). 만들면 그 프로젝트 화면으로
import { useState, type FormEvent } from 'react';
import { Button, Callout, Dialog } from '@brewai/ui';
import { codeOf } from '../../../lib/api';
import type { ProjectInput } from '../api';
import { PROJECTS, projectError } from '../copy';
import { makeProject } from '../hooks';
import { ProjectFields, tidy } from './ProjectForm';

const EMPTY: ProjectInput = { name: '', description: '', instructions: '' };

export function ProjectDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [value, setValue] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setValue(EMPTY);
    setError(null);
    onClose();
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !value.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const p = await makeProject(tidy(value));
      close();
      onCreated(p.id);
    } catch (err) {
      setError(projectError(codeOf(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} title={PROJECTS.createTitle} description={PROJECTS.createSub} dismissible={!busy}
      footer={<>
        <Button variant="ghost" onClick={close} disabled={busy}>{PROJECTS.cancel}</Button>
        <Button variant="primary" type="submit" form="project-new" loading={busy} disabled={!value.name.trim()}>{PROJECTS.create}</Button>
      </>}>
      <form id="project-new" className="form" onSubmit={submit} noValidate>
        {error && <Callout tone="danger" live>{error}</Callout>}
        <ProjectFields value={value} onChange={setValue} autoFocus />
      </form>
    </Dialog>
  );
}
