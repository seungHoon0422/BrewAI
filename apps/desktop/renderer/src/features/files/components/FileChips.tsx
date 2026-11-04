// 첨부 칩 — 입력창(보내기 전: 올리는 중 · 전달 배지 · 예상 토큰 · 빼기) · 내 말풍선(보낸 첨부). 썸네일 = data: 주소만 (CSP)
import { useEffect, useState } from 'react';
import { Icon, IconButton, Spinner, cx } from '@brewai/ui';
import { thumbOf, type FileItem, type Plan } from '../api';
import { FILES, KIND_ICON, KIND_LABEL, MODE_HINT, REASON, modeLabel, sizeText } from '../copy';
import { removeDraft, type Draft } from '../hooks';

function useThumb(file: FileItem | null, preview: string | null): string | null {
  const [src, setSrc] = useState<string | null>(preview);
  useEffect(() => {
    if (preview) return setSrc(preview);
    if (!file || file.kind !== 'image') return setSrc(null);
    let live = true;
    void thumbOf(file.id).then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [file?.id, preview]); // eslint-disable-line react-hooks/exhaustive-deps
  return src;
}

function Thumb({ file, preview, kind }: { file: FileItem | null; preview: string | null; kind: FileItem['kind'] | null }) {
  const src = useThumb(file, preview);
  return (
    <span className="fc-thumb" aria-hidden="true">
      {src ? <img src={src} alt="" /> : <Icon name={kind ? KIND_ICON[kind] : 'file'} size="sm" />}
    </span>
  );
}

// 파일 화면 · 프로젝트 파일 칩의 썸네일 (이미지 = 미리보기 · 그 밖 = 종류 아이콘)
export const FileThumb = ({ file }: { file: FileItem }) => <Thumb file={file} preview={null} kind={file.kind} />;

// 입력창 위 칩 줄 (보내기 전)
export function DraftChips({ drafts, plans, draftKey }: { drafts: Draft[]; plans: Record<string, Plan>; draftKey: string }) {
  if (!drafts.length) return null;
  const ready = drafts.filter((d) => d.file);
  const blocked = ready.some((d) => plans[d.file!.id]?.mode === 'blocked');
  return (
    <div className="fc-wrap">
      <ul className="fc-list" aria-label={FILES.chips}>
        {drafts.map((d) => {
          const plan = d.file ? plans[d.file.id] : undefined;
          return (
            <li key={d.local} className={cx('fc', d.status === 'error' && 'is-error')} data-state={d.status} data-mode={plan?.mode}>
              <Thumb file={d.file} preview={d.preview} kind={d.file?.kind ?? null} />
              <span className="fc-body">
                <b title={d.name}>{d.name}</b>
                <span className="fc-meta">
                  {d.status === 'uploading' ? <><Spinner size="sm" />{FILES.uploading}</>
                    : d.status === 'error' ? <span className="fc-err">{d.error}</span>
                    : <>
                      <span title={d.resized ? FILES.resized : undefined}>{d.file ? KIND_LABEL[d.file.kind] : ''} {sizeText(d.size)}</span>
                      {plan && d.file && <span className="fc-mode" data-mode={plan.mode} title={plan.reason ? REASON[plan.reason] ?? MODE_HINT[plan.mode] : MODE_HINT[plan.mode]}>
                        {modeLabel(plan.mode, d.file.kind)}
                      </span>}
                    </>}
                </span>
              </span>
              <IconButton icon="close" size="sm" variant="ghost" label={FILES.remove(d.name)} onClick={() => removeDraft(draftKey, d.local)} />
            </li>
          );
        })}
      </ul>
      {ready.length > 0 && (
        <p className="fc-sum" aria-live="polite">
          {FILES.total(ready.length)}{blocked && <span className="fc-warn"><Icon name="alert" size="sm" />{FILES.blockedWarn}</span>}
        </p>
      )}
    </div>
  );
}

// 내 말풍선 아래 (보낸 첨부 · 기록에서 다시 열어도)
export function SentChips({ files }: { files: FileItem[] }) {
  if (!files.length) return null;
  return (
    <ul className="fc-list fc-sent" aria-label={FILES.chips}>
      {files.map((f) => (
        <li key={f.id} className="fc" data-kind={f.kind}>
          <Thumb file={f} preview={null} kind={f.kind} />
          <span className="fc-body">
            <b title={f.name}>{f.name}</b>
            <span className="fc-meta"><span>{KIND_LABEL[f.kind]} {sizeText(f.size)}</span></span>
          </span>
        </li>
      ))}
    </ul>
  );
}
