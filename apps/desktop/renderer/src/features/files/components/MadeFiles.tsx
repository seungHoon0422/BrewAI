// 답 아래 '만든 파일' 칩 (slice 08 · make_file 결과) — 종류 아이콘 · 이름 · 종류 크기 · 저장 (데스크톱 = 저장 대화상자 · 어디에 쓸지는 사람이 고른다).
// PDF · 이미지 칩 = 누르면 앱 안 미리보기 서랍 (PDF = 서버가 그린 쪽 그림 · data: 주소) + 저장. 파일 자체는 그 대화 파일 (스페이스 '파일' 화면에도 있다)
// · 지워졌으면 저장이 '지워진 파일이에요'.
import { useEffect, useState } from 'react';
import { Button, Icon, Sheet, Spinner } from '@brewai/ui';
import { getFile, pageOf, saveFile, thumbOf, type MadeFile } from '../api';
import { FILES, KIND_ICON, KIND_LABEL, sizeText } from '../copy';

type SaveState = { s: 'idle' | 'saving' | 'saved' | 'failed'; note?: string };
const PREVIEW_PAGES = 30; // 서랍에 그리는 앞 쪽 수 (나머지는 저장해서)
const canPreview = (f: MadeFile) => f.kind === 'pdf' || f.kind === 'image';

function useSave(f: MadeFile) {
  const [st, setSt] = useState<SaveState>({ s: 'idle' });
  const save = async () => {
    setSt({ s: 'saving' });
    const r = await saveFile(f);
    setSt(r.ok ? { s: 'saved' } : r.code === 'cancelled' ? { s: 'idle' } : { s: 'failed', note: FILES.saveFailed(r.code) });
  };
  return { st, save };
}

function SaveButton({ f, st, save }: { f: MadeFile } & ReturnType<typeof useSave>) {
  return (
    <Button size="sm" variant="ghost" icon="download" loading={st.s === 'saving'} aria-label={FILES.saveLabel(f.name)} onClick={() => void save()}>
      {FILES.save}
    </Button>
  );
}

function MadeChip({ f }: { f: MadeFile }) {
  const saving = useSave(f);
  const { st } = saving;
  const [open, setOpen] = useState(false);
  const body = (
    <>
      <span className="fc-thumb" aria-hidden="true"><Icon name={KIND_ICON[f.kind]} size="sm" /></span>
      <span className="fc-body">
        <b title={f.name}>{f.name}</b>
        <span className="fc-meta" role="status">
          {st.s === 'saved' ? <span className="fc-ok"><Icon name="check" size="sm" />{FILES.saved}</span>
            : st.s === 'failed' ? <span className="fc-err">{st.note}</span>
            : <span>{KIND_LABEL[f.kind]} {sizeText(f.size)}</span>}
        </span>
      </span>
    </>
  );
  return (
    <li className="fc fc-made" data-kind={f.kind} data-state={st.s}>
      {canPreview(f) ? (
        <button type="button" className="fc-open" aria-label={FILES.previewLabel(f.name)} aria-haspopup="dialog" onClick={() => setOpen(true)}>{body}</button>
      ) : body}
      <SaveButton f={f} {...saving} />
      {canPreview(f) && <Preview f={f} open={open} onClose={() => setOpen(false)} saving={saving} />}
    </li>
  );
}

// 미리보기 서랍 = 쪽 그림을 위에서부터 (한 장씩 차례로 받는다 · 서버가 그려 기억) · 아래 = 저장
function Preview({ f, open, onClose, saving }: { f: MadeFile; open: boolean; onClose: () => void; saving: ReturnType<typeof useSave> }) {
  const [total, setTotal] = useState<number | null>(null);
  const [srcs, setSrcs] = useState<(string | null)[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setFailed(false);
    void (async () => {
      if (f.kind === 'image') {
        const src = await thumbOf(f.id);
        if (!live) return;
        setTotal(1);
        setSrcs([src]);
        setFailed(!src);
        return;
      }
      const info = await getFile(f.id).catch(() => null);
      if (!live) return;
      if (!info) return setFailed(true);
      const n = Math.max(1, info.pages ?? 1);
      setTotal(n);
      const got: (string | null)[] = [];
      for (let i = 1; i <= Math.min(n, PREVIEW_PAGES) && live; i++) {
        got.push(await pageOf(f.id, i));
        if (live) setSrcs([...got]);
      }
      if (live && got.length && got.every((s) => !s)) setFailed(true);
    })();
    return () => {
      live = false;
    };
  }, [open, f.id, f.kind]);
  const { st } = saving;
  return (
    <Sheet open={open} onClose={onClose} title={f.name} className="pv-sheet"
      description={total !== null && f.kind === 'pdf' ? `${KIND_LABEL[f.kind]} ${FILES.pagesCount(total)}` : KIND_LABEL[f.kind]}
      footer={
        <>
          {st.s === 'saved' && <span className="fc-ok" role="status"><Icon name="check" size="sm" />{FILES.saved}</span>}
          {st.s === 'failed' && <span className="fc-err" role="status">{st.note}</span>}
          <SaveButton f={f} {...saving} />
        </>
      }>
      {failed ? (
        <p className="pv-note" role="alert">{FILES.previewFailed}</p>
      ) : (
        <ol className="pv-pages" aria-label={FILES.preview}>
          {srcs.map((src, i) => (
            <li key={i} className="pv-page">{src ? <img src={src} alt={FILES.pageAlt(i + 1)} /> : <span className="pv-note">{FILES.previewFailed}</span>}</li>
          ))}
          {total !== null && srcs.length < Math.min(total, PREVIEW_PAGES) && (
            <li className="pv-page pv-wait" aria-busy="true"><Spinner size="sm" />{FILES.pageLoading}</li>
          )}
          {total === null && <li className="pv-page pv-wait" aria-busy="true"><Spinner size="sm" />{FILES.pageLoading}</li>}
        </ol>
      )}
      {total !== null && total > PREVIEW_PAGES && <p className="pv-note">{FILES.previewMore(PREVIEW_PAGES)}</p>}
    </Sheet>
  );
}

export function MadeFiles({ files }: { files: MadeFile[] }) {
  if (!files.length) return null;
  return (
    <ul className="fc-list fc-made-list" aria-label={FILES.made}>
      {files.map((f) => <MadeChip key={f.id} f={f} />)}
    </ul>
  );
}
