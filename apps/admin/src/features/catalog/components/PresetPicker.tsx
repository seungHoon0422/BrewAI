import { useId, useMemo, useState } from 'react';
import { Avatar, Badge, Chip, Input } from '@brewai/ui';
import type { Load } from '../../../shared/load';
import { PRESET_CATEGORIES, type McpPreset, type PresetCategory } from '../api';
import { PRESET_COPY as C } from '../copy';

// 추천 서버 = 서버 추가 대화상자 위의 빠른 선택 (conductor GET /api/admin/mcp/presets).
// 줄 = 머리글자 · 이름 · 한 줄 설명 · 로그인 배지. 누르면 onPick (칸만 채움 · 추가는 사람이). 못 씀 · 추가됨 = 누를 수 없음 + 이유
// 12개 넘으면 찾기 + 분류 칩. 순서 = 쓸 수 있는 것 → 추가됨 → 못 씀 (파일 순서 유지)
const FILTER_FROM = 12;
const rank = (p: McpPreset) => (!p.available ? 2 : p.added ? 1 : 0);

export function PresetPicker({ load, pickedId, onPick }: {
  load: Load<McpPreset[]>;
  pickedId: string | null;
  onPick: (p: McpPreset) => void;
}) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<PresetCategory | 'all'>('all');
  const titleId = useId();
  const all = useMemo(() => (load.kind === 'ok' ? load.data : []), [load]);
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

  if (load.kind === 'loading') return <p className="mcp-presets-state" role="status">{C.loading}</p>;
  if (load.kind === 'error') return <p className="mcp-presets-state">{C.failed}</p>;
  if (!all.length) return null;

  return (
    <section className="mcp-presets" aria-labelledby={titleId}>
      <div className="mcp-presets-head">
        <span id={titleId} className="mcp-presets-title">{C.title}</span>
        <span className="mcp-presets-hint">{C.hint}</span>
      </div>
      {all.length > FILTER_FROM && (
        <div className="mcp-presets-tools">
          <Input size="sm" type="search" icon="search" value={query} aria-label={C.search} placeholder={C.searchPlaceholder}
            onChange={(e) => setQuery(e.target.value)} />
          <div className="mcp-presets-cats" role="group" aria-label={C.filter}>
            <Chip selected={cat === 'all'} count={all.length} onClick={() => setCat('all')}>{C.all}</Chip>
            {PRESET_CATEGORIES.filter((c) => counts[c]).map((c) => (
              <Chip key={c} selected={cat === c} count={counts[c]} onClick={() => setCat(c)}>{C.category[c]}</Chip>
            ))}
          </div>
        </div>
      )}
      {shown.length ? (
        <ul className="mcp-presets-list" aria-label={C.list}>
          {shown.map((p) => (
            <li key={p.id}>
              <button type="button" className="mcp-preset" disabled={!p.available || p.added} aria-pressed={p.id === pickedId}
                data-state={!p.available ? 'off' : p.added ? 'added' : undefined} onClick={() => onPick(p)}>
                <span aria-hidden="true" className="mcp-preset-mark"><Avatar name={p.vendor} size="sm" /></span>
                <span className="mcp-preset-body">
                  <span className="mcp-preset-top">
                    <b className="mcp-preset-name">{p.name}</b>
                    <Badge size="sm" variant="outline">{C.auth[p.auth]}</Badge>
                    {p.added && <Badge size="sm" tone="ok" dot>{C.added}</Badge>}
                    {!p.available && <Badge size="sm">{C.unavailable}</Badge>}
                  </span>
                  <span className="mcp-preset-desc">{p.available ? p.description : p.reason}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mcp-presets-state">{C.empty}</p>
      )}
    </section>
  );
}
