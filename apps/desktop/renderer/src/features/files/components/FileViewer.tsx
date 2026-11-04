// 파일 뷰어 (대화 | 뷰어 | 오른쪽 패널 · 2026-11-04 사용자) — 머리 = 이름 · 종류 크기 · 작게 / % / 크게 · 폭 맞춤 · 저장 · 닫기.
// PDF = 서버가 그린 쪽 그림 (앞 30쪽씩 · 더 보기) · 이미지 = 그대로 · Word · Excel · PowerPoint · 글 = 뽑은 글 조각 (쪽 · 시트 · 슬라이드 이름)
// · 뽑은 글이 없으면 '저장해서 열어 주세요'. 그림 = data: 주소 (CSP img-src 'self' data:). 좁은 창 = 대화 위 덮개 (Esc 로 닫힘).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, IconButton, Spinner } from '@brewai/ui';
import { getFile, getText, pageOf, thumbOf, type TextChunk } from '../api';
import { FILES, KIND_ICON, KIND_LABEL, sizeText } from '../copy';
import type { ViewFile } from '../viewer';
import { SaveButton, SaveNote, useSave } from './SaveButton';
import '../viewer.css';

const BATCH = 30; // 한 번에 그리는 쪽 수
const ZOOMS = [50, 67, 75, 90, 100, 110, 125, 150, 175, 200];

// handle = 왼쪽 끝 폭 손잡이 (넓은 창만 · 대화 화면이 준다)
export function FileViewer({ file, overlay, onClose, handle }: { file: ViewFile; overlay: boolean; onClose: () => void; handle?: ReactNode }) {
  const [zoom, setZoom] = useState(100);
  const saving = useSave(file);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => setZoom(100), [file.id]);
  // 덮개 = Esc 로 닫는다 · 열리면 포커스를 닫기로 (뒤의 입력창이 덮인다)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!overlay) return;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [overlay]);
  const at = ZOOMS.indexOf(zoom);
  const step = (d: number) => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (at < 0 ? 4 : at) + d))]);
  return (
    <aside className="fv" aria-label={FILES.viewer} data-kind={file.kind} data-overlay={overlay || undefined}>
      {handle}
      <div className="fv-head">
        <span className="fv-ico" aria-hidden="true"><Icon name={KIND_ICON[file.kind]} size="sm" /></span>
        <span className="fv-name">
          <b title={file.name}>{file.name}</b>
          <span className="fv-meta">{KIND_LABEL[file.kind]} {sizeText(file.size)}</span>
        </span>
        <span className="fv-zoom" role="group" aria-label={FILES.zoomLabel}>
          <IconButton icon="minus" size="sm" label={FILES.zoomOut} onClick={() => step(-1)} disabled={zoom <= ZOOMS[0]} />
          <output className="fv-pct ui-num" aria-live="polite">{zoom}%</output>
          <IconButton icon="plus" size="sm" label={FILES.zoomIn} onClick={() => step(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} />
          <button type="button" className="fv-fit" onClick={() => setZoom(100)} aria-pressed={zoom === 100}>{FILES.zoomFit}</button>
        </span>
        <SaveButton f={file} {...saving} iconOnly />
        <IconButton ref={closeBtn} icon="close" size="sm" label={FILES.viewerClose} onClick={onClose} />
      </div>
      <SaveNoteRow st={saving.st} />
      <div className="fv-body ui-scroll" tabIndex={0} aria-label={file.name}>
        <div className="fv-sheet" style={{ width: `${zoom}%` }} data-zoom={zoom}>
          {file.kind === 'pdf' ? <PdfPages file={file} /> : file.kind === 'image' ? <ImageView file={file} /> : <TextView file={file} saving={saving} />}
        </div>
      </div>
    </aside>
  );
}

function SaveNoteRow({ st }: { st: ReturnType<typeof useSave>['st'] }) {
  if (st.s !== 'saved' && st.s !== 'failed') return null;
  return <p className="fv-note"><SaveNote st={st} /></p>;
}

function PdfPages({ file }: { file: ViewFile }) {
  const [total, setTotal] = useState<number | null>(null);
  const [srcs, setSrcs] = useState<(string | null)[]>([]);
  const [want, setWant] = useState(BATCH);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setTotal(null);
    setSrcs([]);
    setWant(BATCH);
    setFailed(false);
  }, [file.id]);
  useEffect(() => {
    let live = true;
    void (async () => {
      let n = total;
      if (n === null) {
        const info = await getFile(file.id).catch(() => null);
        if (!live) return;
        if (!info) return setFailed(true);
        n = Math.max(1, info.pages ?? 1);
        setTotal(n);
      }
      const got = [...srcs];
      for (let i = got.length + 1; i <= Math.min(n, want) && live; i++) {
        got.push(await pageOf(file.id, i));
        if (live) setSrcs([...got]);
      }
      if (live && got.length && got.every((s) => !s)) setFailed(true);
    })();
    return () => {
      live = false;
    };
  }, [file.id, want]); // eslint-disable-line react-hooks/exhaustive-deps
  if (failed) return <p className="fv-note" role="alert">{FILES.previewFailed}</p>;
  const waiting = total === null || srcs.length < Math.min(total, want);
  return (
    <>
      <ol className="fv-pages" aria-label={total === null ? FILES.preview : FILES.pagesCount(total)}>
        {srcs.map((src, i) => (
          <li key={i} className="fv-page">{src ? <img src={src} alt={FILES.pageAlt(i + 1)} /> : <span className="fv-note">{FILES.previewFailed}</span>}</li>
        ))}
        {waiting && <li className="fv-page fv-wait" aria-busy="true"><Spinner size="sm" />{FILES.pageLoading}</li>}
      </ol>
      {!waiting && total !== null && total > want && (
        <button type="button" className="fv-more" onClick={() => setWant((w) => w + BATCH)}>{FILES.morePages(Math.min(BATCH, total - want))}</button>
      )}
    </>
  );
}

function ImageView({ file }: { file: ViewFile }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setSrc(undefined);
    void thumbOf(file.id).then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [file.id]);
  if (src === undefined) return <p className="fv-wait" aria-busy="true"><Spinner size="sm" /></p>;
  if (!src) return <p className="fv-note" role="alert">{FILES.previewFailed}</p>;
  return <img className="fv-img" src={src} alt={file.name} />;
}

function TextView({ file, saving }: { file: ViewFile; saving: ReturnType<typeof useSave> }) {
  const [got, setGot] = useState<{ chunks: TextChunk[]; truncated: boolean } | null | undefined>(undefined);
  useEffect(() => {
    const ac = new AbortController();
    setGot(undefined);
    getText(file.id, ac.signal).then(setGot).catch(() => !ac.signal.aborted && setGot(null));
    return () => ac.abort();
  }, [file.id]);
  if (got === undefined) return <p className="fv-wait" aria-busy="true"><Spinner size="sm" /></p>;
  const chunks = got?.chunks.filter((c) => c.text.trim()) ?? [];
  if (!chunks.length) {
    return (
      <div className="fv-empty">
        <p>{FILES.noPreview(KIND_LABEL[file.kind])}</p>
        <SaveButton f={file} {...saving} />
      </div>
    );
  }
  return (
    <div className="fv-text">
      {chunks.map((c, i) => (
        <section key={`${i}:${c.label}`} className="fv-chunk">
          {chunks.length > 1 && <h3>{c.label}</h3>}
          <p>{c.text}</p>
        </section>
      ))}
      {got?.truncated && <p className="fv-note">{FILES.textCut}</p>}
    </div>
  );
}
