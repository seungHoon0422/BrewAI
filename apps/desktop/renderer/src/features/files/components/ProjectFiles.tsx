// 프로젝트 파일 (프로젝트 화면 · slice 07) — 올리기 · 목록(칩) · 빼기. 이 프로젝트의 모든 대화가 목록 한 줄을 보고 필요할 때 read_file 로 읽는다.
import { useEffect, useRef, useState } from 'react';
import { Button, Callout, IconButton } from '@brewai/ui';
import { codeOf } from '../../../lib/api';
import { deleteFile, listFiles, uploadFile, type FileItem } from '../api';
import { FILES, KIND_LABEL, fileError, sizeText } from '../copy';
import { FileThumb } from './FileChips';

export function ProjectFiles({ projectId, spaceId }: { projectId: string; spaceId: string }) {
  const [rows, setRows] = useState<FileItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    listFiles({ project: projectId }).then(setRows, () => setRows([]));
  }, [projectId]);
  const add = async (files: File[]) => {
    setBusy(true);
    setNote(null);
    for (const f of files) {
      try {
        const got = await uploadFile(f, f.name, { space: spaceId, project: projectId });
        setRows((r) => [got, ...r]);
        setNote({ tone: 'ok', text: FILES.uploaded(got.name) });
      } catch (e) {
        setNote({ tone: 'danger', text: `${f.name}: ${fileError(codeOf(e))}` });
      }
    }
    setBusy(false);
  };
  const remove = async (f: FileItem) => {
    try {
      await deleteFile(f.id);
      setRows((r) => r.filter((x) => x.id !== f.id));
    } catch (e) {
      setNote({ tone: 'danger', text: fileError(codeOf(e)) });
    }
  };
  return (
    <section className="proj-files" aria-label={FILES.projectTitle}>
      <div className="proj-files-head">
        <h2>{FILES.projectTitle}</h2>
        <span className="count ui-num">{rows.length}</span>
        <span className="grow" />
        <Button size="sm" icon="plus" loading={busy} onClick={() => picker.current?.click()}>{FILES.upload}</Button>
        <input ref={picker} type="file" multiple hidden aria-hidden="true" tabIndex={-1} data-testid="project-file-input"
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = '';
            if (files.length) void add(files);
          }} />
      </div>
      <p>{FILES.projectSub}</p>
      {note && <Callout tone={note.tone} live onDismiss={() => setNote(null)}>{note.text}</Callout>}
      {rows.length > 0 ? (
        <ul className="fc-list" aria-label={FILES.projectTitle}>
          {rows.map((f) => (
            <li key={f.id} className="fc" data-kind={f.kind}>
              <FileThumb file={f} />
              <span className="fc-body">
                <b title={f.name}>{f.name}</b>
                <span className="fc-meta"><span>{KIND_LABEL[f.kind]} {sizeText(f.size)}</span></span>
              </span>
              <IconButton icon="close" size="sm" variant="ghost" label={FILES.remove(f.name)} onClick={() => void remove(f)} />
            </li>
          ))}
        </ul>
      ) : (
        <p>{FILES.projectEmpty}</p>
      )}
    </section>
  );
}
