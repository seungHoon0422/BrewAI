// 스페이스 '파일' 메뉴 (slice 07) — 이 스페이스의 대화 첨부 · 프로젝트 파일을 한곳에. 칩(전체 · 대화 · 프로젝트) · 카드 격자
// · 카드 = 썸네일 · 이름 · 종류 크기 · 어디에 붙었나(누르면 그 대화 · 프로젝트로) · 올린 사람 · 지우기(확인). 판정은 서버 (볼 수 있는 것만 온다).
import { useEffect, useState } from 'react';
import { Button, Callout, Chip, Dialog, Icon } from '@brewai/ui';
import { openChat, openProject } from '../../../app/navigate';
import { codeOf } from '../../../lib/api';
import { ago } from '../../../lib/format';
import { useCurrentSpace } from '../../scope/hooks';
import { Count, Empty, Page, Section } from '../../shell/components/Page';
import { deleteFile, listFiles, type FileItem } from '../api';
import { FILES, KIND_LABEL, WHERE_LABEL, fileError, sizeText } from '../copy';
import { FileThumb } from './FileChips';

type Filter = 'all' | 'thread' | 'project';

export function FilesScreen() {
  const space = useCurrentSpace();
  const [rows, setRows] = useState<FileItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [confirm, setConfirm] = useState<FileItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const load = () => {
    if (!space) return;
    setFailed(false);
    listFiles({ space: space.id }).then(setRows, () => setFailed(true));
  };
  useEffect(load, [space?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sent = (rows ?? []).filter((f) => f.where.kind !== 'draft'); // 보내기 전 첨부는 입력창에만
  const count = (k: Filter) => (k === 'all' ? sent.length : sent.filter((f) => f.where.kind === k).length);
  const shown = filter === 'all' ? sent : sent.filter((f) => f.where.kind === filter);
  const remove = async (f: FileItem) => {
    setBusy(true);
    try {
      await deleteFile(f.id);
      setRows((r) => r?.filter((x) => x.id !== f.id) ?? r);
      setNote({ tone: 'ok', text: FILES.deleted(f.name) });
      setConfirm(null);
    } catch (e) {
      setNote({ tone: 'danger', text: fileError(codeOf(e)) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page id="files" sub={FILES.sub}>
      {note && <Callout tone={note.tone} live onDismiss={() => setNote(null)} className="sec-note">{note.text}</Callout>}
      <Section title={FILES.title} extra={rows && <Count n={sent.length} />}>
        {sent.length > 0 && (
          <div className="files-filter" role="group" aria-label={FILES.filter}>
            {(['all', 'thread', 'project'] as const).map((k) => (
              <Chip key={k} selected={filter === k} count={count(k)} onClick={() => setFilter(k)}>{k === 'all' ? FILES.all : WHERE_LABEL[k]}</Chip>
            ))}
          </div>
        )}
        {failed ? (
          <Empty icon="file" title={FILES.loadFailed} text={FILES.emptyText} action={<Button onClick={load}>{FILES.retry}</Button>} />
        ) : rows === null ? (
          <p className="rows rows-state">{FILES.loading}</p>
        ) : shown.length === 0 ? (
          <Empty icon="file" title={FILES.empty} text={FILES.emptyText} />
        ) : (
          <ul className="file-cards" aria-label={FILES.list} data-filter={filter}>
            {shown.map((f) => (
              <li key={f.id} className="file-card" data-kind={f.kind} data-where={f.where.kind}>
                <span className="file-card-top">
                  <FileThumb file={f} />
                  <span className="file-card-name">
                    <b title={f.name}>{f.name}</b>
                    <span>{KIND_LABEL[f.kind]} {sizeText(f.size)}{f.pages ? ` ${FILES.pages(f.pages)}` : ''}</span>
                  </span>
                </span>
                <button type="button" className="file-where" onClick={() => (f.where.kind === 'thread' ? openChat(f.where.id!) : openProject(f.where.id!))}>
                  <Icon name={f.where.kind === 'thread' ? 'chat' : 'folder'} size="sm" />
                  <span>{WHERE_LABEL[f.where.kind]} {f.where.title || FILES.untitled}</span>
                </button>
                <span className="file-card-foot">
                  <span>{f.owner_name ? FILES.by(f.owner_name) : ''} {ago(f.created_at)}</span>
                  <Button size="sm" variant="ghost" aria-label={FILES.deleteLabel(f.name)} onClick={() => setConfirm(f)}>{FILES.delete}</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Dialog size="sm" open={confirm !== null} onClose={() => setConfirm(null)} title={FILES.deleteTitle} description={FILES.deleteBody}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirm(null)}>{FILES.cancel}</Button>
          <Button variant="danger" loading={busy} onClick={() => confirm && void remove(confirm)}>{FILES.delete}</Button>
        </>} />
    </Page>
  );
}
