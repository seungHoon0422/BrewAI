// 저장 단추 + 상태 (답의 만든 파일 칩 · 오른쪽 패널 '파일' 줄 · 뷰어 머리) — 데스크톱 = 저장 대화상자 (어디에 쓸지는 사람이 고른다)
import { useState } from 'react';
import { Button, Icon } from '@brewai/ui';
import { saveFile } from '../api';
import { FILES } from '../copy';

export type SaveState = { s: 'idle' | 'saving' | 'saved' | 'failed'; note?: string };

export function useSave(f: { id: string; name: string }) {
  const [st, setSt] = useState<SaveState>({ s: 'idle' });
  const save = async () => {
    setSt({ s: 'saving' });
    const r = await saveFile(f);
    setSt(r.ok ? { s: 'saved' } : r.code === 'cancelled' ? { s: 'idle' } : { s: 'failed', note: FILES.saveFailed(r.code) });
  };
  return { st, save };
}

export function SaveButton({ f, st, save, iconOnly }: { f: { id: string; name: string }; iconOnly?: boolean } & ReturnType<typeof useSave>) {
  return (
    <Button size="sm" variant="ghost" icon="download" loading={st.s === 'saving'} aria-label={FILES.saveLabel(f.name)} onClick={() => void save()}>
      {iconOnly ? undefined : FILES.save}
    </Button>
  );
}

// 저장 결과 한 줄 (저장했어요 · 실패 이유) — role=status
export function SaveNote({ st }: { st: SaveState }) {
  if (st.s === 'saved') return <span className="fc-ok" role="status"><Icon name="check" size="sm" />{FILES.saved}</span>;
  if (st.s === 'failed') return <span className="fc-err" role="status">{st.note}</span>;
  return null;
}
