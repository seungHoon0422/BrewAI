import { useId, useMemo, useState } from 'react';
import { Badge, Chip, Input } from '@brewai/ui';
import { PRESET_CATEGORIES, type Preset, type PresetCategory } from '../api';
import { PRESET as C } from '../copy';
import type { PresetLoad } from '../hooks';
import { AppIcon } from './AppIcon';

// 추천 서버 = 앱 추가 대화상자 위의 빠른 선택 (conductor GET /api/me/mcp/presets · 관리자 콘솔 PresetPicker 와 같은 모양).
// 줄 = 서비스 아이콘 (conductor 가 받아 둔 사이트 그림 · 못 쓰는 서버 = 받지 않고 첫 글자) · 이름 · 한 줄 설명 · 로그인 배지. 누르면 onPick (칸만 채움 · 추가는 사람이). 못 씀 · 추가됨 = 누를 수 없음 + 이유
// 12개 넘으면 찾기 + 분류 칩. 순서 = 쓸 수 있는 것 → 추가됨 → 못 씀 (파일 순서 유지)
const FILTER_FROM = 12;
const rank = (p: Preset) => (!p.available ? 2 : p.added ? 1 : 0);

export function PresetPicker({ load, pickedId, onPick }: {
  load: PresetLoad;
  pickedId: string | null;
  onPick: (p: Preset) => void;
}) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<PresetCategory | 'all'>('all');
  const titleId = useId();
  const all = useMemo(() => (load.status === 'ready' ? load.data : []), [load]);
  const counts = useMemo(() => {
    const out: Partial<Record<PresetCategory, number>> = {};
    for (const p of all) out[p.category] = (out[p.category] ?? 0) + 1;
    return out;
  }, [all]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((p) => cat === 'all' || p.category === cat)
      .filter((p) => !q || [p.name, p.vendor, p.description, p.url].some((x) => x.toLowerCase().includes(q)))
      .map((p, i) => ({ p, i }))
      .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
      .map(({ p }) => p);
  }, [all, cat, query]);

  if (load.status === 'loading') return <p className="app-presets-state" role="status">{C.loading}</p>;
  if (load.status === 'error') return <p className="app-presets-state">{C.failed}</p>;
  if (!all.length) return null;

  return (
    <section className="app-presets" aria-labelledby={titleId}>
      <div className="app-presets-head">
        <span id={titleId} className="app-presets-title">{C.title}</span>
        <span className="app-presets-hint">{C.hint}</span>
      </div>
      {all.length > FILTER_FROM && (
        <div className="app-presets-tools">
          <Input size="sm" type="search" icon="search" value={query} aria-label={C.search} placeholder={C.searchPlaceholder}
            onChange={(e) => setQuery(e.target.value)} />
          <div className="app-presets-cats" role="group" aria-label={C.filter}>
            <Chip selected={cat === 'all'} count={all.length} onClick={() => setCat('all')}>{C.all}</Chip>
            {PRESET_CATEGORIES.filter((c) => counts[c]).map((c) => (
              <Chip key={c} selected={cat === c} count={counts[c]} onClick={() => setCat(c)}>{C.category[c]}</Chip>
            ))}
          </div>
        </div>
      )}
      {shown.length ? (
        <ul className="app-presets-list" aria-label={C.list}>
          {shown.map((p) => (
            <li key={p.id}>
              <button type="button" className="app-preset" disabled={!p.available || p.added} aria-pressed={p.id === pickedId}
                data-state={!p.available ? 'off' : p.added ? 'added' : undefined} onClick={() => onPick(p)}>
                <span aria-hidden="true" className="app-preset-mark"><AppIcon preset={p.available ? p.id : null} name={p.vendor} /></span>
                <span className="app-preset-body">
                  <span className="app-preset-top">
                    <b className="app-preset-name">{p.name}</b>
                    <Badge size="sm" variant="outline">{C.auth[p.auth]}</Badge>
                    {p.added && <Badge size="sm" tone="ok" dot>{C.added}</Badge>}
                    {!p.available && <Badge size="sm">{C.unavailable}</Badge>}
                  </span>
                  <span className="app-preset-desc">{p.available ? p.description : p.reason}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="app-presets-state">{C.empty}</p>
      )}
    </section>
  );
}
