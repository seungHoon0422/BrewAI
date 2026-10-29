import { useRef, type KeyboardEvent } from 'react';
import data from 'virtual:brewai-docs';
import Adrs from '../docs/Adrs';
import Architecture from '../docs/Architecture';
import Progress from '../docs/Progress';
import Report from '../docs/Report';
import Stack from '../docs/Stack';
import { useHash } from '../hash';
import { Note } from '../ui';

// 문서 = 레포 파일(HANDOFF · roadmap · slices · ADR · REPORT …)을 빌드할 때 읽은 것 (docs-plugin.ts)
// 주소: #/docs → 진행 현황 · #/docs/<탭> · #/docs/adr/<번호>
const TABS = [
  { id: 'progress', label: '진행 현황' },
  { id: 'architecture', label: '아키텍처' },
  { id: 'stack', label: '구성' },
  { id: 'adr', label: '결정 기록' },
  { id: 'report', label: '보고서' },
] as const;

export function docsRoute(hash: string) {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/');
  const i = TABS.findIndex((t) => t.id === parts[1]);
  return { index: Math.max(0, i), rest: i < 0 ? [] : parts.slice(2).filter(Boolean) };
}

const hrefOf = (i: number) => `#/docs/${TABS[i].id}`;

export default function Docs() {
  const { index, rest } = docsRoute(useHash());
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tab = TABS[index];

  // 탭 키보드: ← → Home End (카탈로그와 같다). 키로 옮길 땐 기록을 쌓지 않는다
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const last = TABS.length - 1;
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
    <>
      {data.errors.length > 0 && <Note icon="alert">읽지 못한 것: {data.errors.join(' · ')}</Note>}
      <div className="tabs scroll" role="tablist" aria-label="문서 종류" onKeyDown={onKeyDown}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`docs-tab-${t.id}`}
            className="tab"
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
      <div role="tabpanel" id="docs-panel" aria-labelledby={`docs-tab-${tab.id}`} tabIndex={0}>
        {tab.id === 'progress' && <Progress data={data} />}
        {tab.id === 'architecture' && <Architecture data={data} />}
        {tab.id === 'stack' && <Stack data={data} />}
        {tab.id === 'adr' && <Adrs adrs={data.adrs} sel={rest[0] ?? null} />}
        {tab.id === 'report' && <Report info={data.report} />}
      </div>
    </>
  );
}
