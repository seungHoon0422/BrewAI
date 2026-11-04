// 답 아래 '만든 파일' 칩 (slice 08 · make_file 결과) — 종류 아이콘 · 이름 · 종류 크기 · 저장 (데스크톱 = 저장 대화상자 · 어디에 쓸지는 사람이 고른다).
// 칩을 누르면 가운데 파일 뷰어 (대화 | 뷰어 | 오른쪽 패널 · features/files/viewer.ts · 대화는 그대로 이어 간다).
// 파일 자체는 그 대화 파일 (오른쪽 패널 '파일' · 스페이스 '파일' 화면에도) · 지워졌으면 저장이 '지워진 파일이에요'.
import { Icon } from '@brewai/ui';
import type { MadeFile } from '../api';
import { FILES, KIND_ICON, KIND_LABEL, sizeText } from '../copy';
import { openViewer } from '../viewer';
import { SaveButton, SaveNote, useSave } from './SaveButton';

function MadeChip({ f }: { f: MadeFile }) {
  const saving = useSave(f);
  const { st } = saving;
  return (
    <li className="fc fc-made" data-kind={f.kind} data-state={st.s}>
      <button type="button" className="fc-open" aria-label={FILES.openLabel(f.name)} onClick={() => openViewer(f)}>
        <span className="fc-thumb" aria-hidden="true"><Icon name={KIND_ICON[f.kind]} size="sm" /></span>
        <span className="fc-body">
          <b title={f.name}>{f.name}</b>
          <span className="fc-meta">
            {st.s === 'saved' || st.s === 'failed' ? <SaveNote st={st} /> : <span>{KIND_LABEL[f.kind]} {sizeText(f.size)}</span>}
          </span>
        </span>
      </button>
      <SaveButton f={f} {...saving} />
    </li>
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
