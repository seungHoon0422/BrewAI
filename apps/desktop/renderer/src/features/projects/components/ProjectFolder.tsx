// 프로젝트 머리의 로컬 폴더 줄 (slice 09) — 연결 없음 = [로컬 폴더 연결] · 연결됨 = 폴더 이름 · 경로 · 읽기만 · 바꾸기 · 연결 끊기.
// 폴더는 main 의 대화상자로 고르고(bridge.folder.pick), 규칙 판정은 conductor 가 한다. conductor 가 이 PC 가 아니면(enabled=false) 안 그린다.
import { useEffect, useState } from 'react';
import { Badge, Button, Callout, Icon } from '@brewai/ui';
import { codeOf, isAbort } from '../../../lib/api';
import { bridge } from '../../../lib/bridge';
import { deleteFolder, getFolder, putFolder, type FolderState } from '../api';
import { FOLDER, folderError } from '../copy';

export function ProjectFolder({ projectId }: { projectId: string }) {
  const [state, setState] = useState<FolderState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    setState(null);
    setError(null);
    getFolder(projectId, ctl.signal).then(setState, (e) => {
      if (!isAbort(e)) setState({ enabled: false, folder: null });
    });
    return () => ctl.abort();
  }, [projectId]);

  if (!state?.enabled || !bridge?.folder) return null;

  const run = async (work: () => Promise<FolderState | null>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await work();
      if (next) setState(next);
    } catch (e) {
      setError(folderError(codeOf(e)));
    } finally {
      setBusy(false);
    }
  };
  const connect = () =>
    void run(async () => {
      const picked = await bridge!.folder!.pick({ title: FOLDER.pickTitle });
      return picked.ok ? putFolder(projectId, picked.path) : null;
    });
  const disconnect = () =>
    void run(async () => {
      await deleteFolder(projectId);
      return { enabled: true, folder: null };
    });

  const f = state.folder;
  return (
    <div className="proj-folder" data-testid="project-folder">
      {f ? (
        <div className="proj-folder-row">
          <Icon name="folder" size="sm" />
          <span className="proj-folder-name">{f.name}</span>
          <span className="proj-folder-path" title={f.path}>{f.path}</span>
          <Badge size="sm" variant="outline">{FOLDER.readOnly}</Badge>
          <span className="grow" />
          <Button size="sm" variant="ghost" onClick={connect} disabled={busy}>{FOLDER.change}</Button>
          <Button size="sm" variant="ghost" onClick={disconnect} disabled={busy}>{FOLDER.disconnect}</Button>
        </div>
      ) : (
        <div className="proj-folder-row">
          <Button size="sm" icon="folder" onClick={connect} loading={busy}>{FOLDER.connect}</Button>
          <span className="proj-folder-hint">{FOLDER.hint}</span>
        </div>
      )}
      {f && !f.ok && <Callout tone="warn">{FOLDER.missing}</Callout>}
      {error && <Callout tone="danger" live onDismiss={() => setError(null)}>{error}</Callout>}
    </div>
  );
}
