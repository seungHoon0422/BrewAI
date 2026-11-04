// 답 아래 '만든 파일' 칩 (slice 08 · make_file 결과) — 종류 아이콘 · 이름 · 종류 크기 · 저장 (데스크톱 = 저장 대화상자 · 어디에 쓸지는 사람이 고른다).
// 파일 자체는 그 대화 파일 (스페이스 '파일' 화면에도 있다) · 지워졌으면 저장이 '지워진 파일이에요'.
import { useState } from 'react';
import { Button, Icon } from '@brewai/ui';
import { saveFile, type MadeFile } from '../api';
import { FILES, KIND_ICON, KIND_LABEL, sizeText } from '../copy';

type SaveState = { s: 'idle' | 'saving' | 'saved' | 'failed'; note?: string };

function MadeChip({ f }: { f: MadeFile }) {
  const [st, setSt] = useState<SaveState>({ s: 'idle' });
  const save = async () => {
    setSt({ s: 'saving' });
    const r = await saveFile(f);
    setSt(r.ok ? { s: 'saved' } : r.code === 'cancelled' ? { s: 'idle' } : { s: 'failed', note: FILES.saveFailed(r.code) });
  };
  return (
    <li className="fc fc-made" data-kind={f.kind} data-state={st.s}>
      <span className="fc-thumb" aria-hidden="true"><Icon name={KIND_ICON[f.kind]} size="sm" /></span>
      <span className="fc-body">
        <b title={f.name}>{f.name}</b>
        <span className="fc-meta" role="status">
          {st.s === 'saved' ? <span className="fc-ok"><Icon name="check" size="sm" />{FILES.saved}</span>
            : st.s === 'failed' ? <span className="fc-err">{st.note}</span>
            : <span>{KIND_LABEL[f.kind]} {sizeText(f.size)}</span>}
        </span>
      </span>
      <Button size="sm" variant="ghost" icon="download" loading={st.s === 'saving'} aria-label={FILES.saveLabel(f.name)} onClick={() => void save()}>
        {FILES.save}
      </Button>
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
