import { useRef, type KeyboardEvent } from 'react';
import data from 'virtual:brewai-docs';
import { Callout } from '@brewai/ui';
import { useHash } from '../../../app/hash';
import Adrs from '../../../docs/Adrs';
import Architecture from '../../../docs/Architecture';
import Board from '../../../docs/Board';
import Progress from '../../../docs/Progress';
import Report from '../../../docs/Report';
import Stack from '../../../docs/Stack';
import { DOC_TABS, DOCS_COPY } from '../copy';
import '../docs.css';

// 문서 = 레포 파일(HANDOFF · roadmap · slices · ADR · REPORT …)을 빌드할 때 읽은 것 (docs-plugin.ts)
// 주소: #/docs → 보드 · #/docs/<탭> · #/docs/board/<카드> · #/docs/adr/<번호>
// 탭 = 주소가 정한다 (누르기 = 기록을 쌓는다 · 화살표 = 기록 없이 바꾼다) → @brewai/ui Tabs 대신 같은 클래스(ui-tab*)로 직접 그린다
export function docsRoute(hash: string) {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/');
  const i = DOC_TABS.findIndex((t) => t.id === parts[1]);
  return { index: Math.max(0, i), rest: i < 0 ? [] : parts.slice(2).filter(Boolean) };
}

const hrefOf = (i: number) => `#/docs/${DOC_TABS[i].id}`;

export default function DocsScreen() {
  const { index, rest } = docsRoute(useHash());
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tab = DOC_TABS[index];

  // 탭 키보드: ← → Home End (카탈로그와 같다). 키로 옮길 땐 기록을 쌓지 않는다
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const last = DOC_TABS.length - 1;
    const next =
      e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : -1;
    if (next < 0) return;
    e.preventDefault();
    window.location.replace(hrefOf(next));
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="docs">
      {data.errors.length > 0 && <Callout tone="warn">{DOCS_COPY.unreadable(data.errors.join(', '))}</Callout>}
      <div className="ui-tabs" data-variant="line">
        <div className="ui-tablist ui-scroll" role="tablist" aria-label={DOCS_COPY.tabs} onKeyDown={onKeyDown}>
          {DOC_TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`docs-tab-${t.id}`}
              className="ui-tab"
              aria-selected={i === index}
              aria-controls="docs-panel"
              tabIndex={i === index ? 0 : -1}
              onClick={() => {
                if (window.location.hash !== hrefOf(i)) window.location.hash = hrefOf(i);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ui-tabpanel" role="tabpanel" id="docs-panel" aria-labelledby={`docs-tab-${tab.id}`} tabIndex={0}>
          {tab.id === 'board' && <Board data={data} sel={rest[0] ?? null} />}
          {tab.id === 'progress' && <Progress data={data} />}
          {tab.id === 'architecture' && <Architecture data={data} />}
          {tab.id === 'stack' && <Stack data={data} />}
          {tab.id === 'adr' && <Adrs adrs={data.adrs} sel={rest[0] ?? null} />}
          {tab.id === 'report' && <Report info={data.report} />}
        </div>
      </div>
    </div>
  );
}
