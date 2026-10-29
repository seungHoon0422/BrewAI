import { useRef, useState, type KeyboardEvent } from 'react';
import { EmptyTable, Note } from '../ui';

const TABS = [
  { id: 'mcp', label: 'MCP 서버', empty: '등록된 MCP 서버 없음 — P3에서 허용 목록부터' },
  { id: 'skill', label: 'Skill', empty: '등록된 Skill 없음 — P3에서 허용 목록부터' },
] as const;
const COLS = ['이름', '등급', '허용', '버전/해시 고정'];

export default function Catalog() {
  const [cur, setCur] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tab = TABS[cur];

  // 탭 키보드: ← → Home End
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const last = TABS.length - 1;
    const next =
      e.key === 'ArrowRight' ? (cur === last ? 0 : cur + 1)
      : e.key === 'ArrowLeft' ? (cur === 0 ? last : cur - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : -1;
    if (next < 0) return;
    e.preventDefault();
    setCur(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <>
      <Note icon="shield">설치는 허용 목록 · 버전/해시 고정 · 사람 승인을 모두 거칩니다.</Note>
      <div className="tabs" role="tablist" aria-label="카탈로그 종류" onKeyDown={onKeyDown}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`cat-tab-${t.id}`}
            className="tab"
            aria-selected={i === cur}
            aria-controls="cat-panel"
            tabIndex={i === cur ? 0 : -1}
            onClick={() => setCur(i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="cat-panel" aria-labelledby={`cat-tab-${tab.id}`} tabIndex={0}>
        <EmptyTable label={`${tab.label} 목록`} cols={COLS} icon="box">
          {tab.empty}
        </EmptyTable>
      </div>
    </>
  );
}
