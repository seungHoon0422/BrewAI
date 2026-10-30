// 모델 메뉴 한 줄 (role=option). 포커스는 검색칸에 두고 aria-activedescendant 로 가리킨다 (combobox).
// 1줄 = 회사 아이콘 · 이름(검색어 굵게) · 기본 · 경고 점 · 기능 · 컨텍스트 · 고름 표시 / 2줄 = id (+ 이름이 겹치면 등록한 곳)
import { Badge, Icon, ProviderIcon, StatusDot } from '@brewai/ui';
import { tokensShort } from '../../../lib/format';
import type { Model } from '../api';
import { caps, failNote, PICKER, sourceOf } from '../copy';
import { hitRange } from '../picker';

// 검색어와 맞는 부분을 굵게
function Hit({ text, q }: { text: string; q: string }) {
  const r = hitRange(text, q);
  if (!r) return <>{text}</>;
  return <>{text.slice(0, r[0])}<b className="hit">{text.slice(r[0], r[1])}</b>{text.slice(r[1])}</>;
}

export function ModelRow({ id, sec, m, q, dup, selected, active, onPick, onHover, onLeave }: {
  id: string; sec: 'recent' | 'all'; m: Model; q: string; dup: boolean; selected: boolean; active: boolean;
  onPick: (m: Model) => void; onHover: () => void; onLeave: () => void;
}) {
  const name = dup ? `${m.label} (${m.id} · ${sourceOf(m)})` : m.label;
  const ctx = tokensShort(m.max_input_tokens);
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div id={id} role="option" aria-selected={selected} aria-label={`${name}${failNote(m)}`} data-model={m.id} data-sec={sec} data-active={active || undefined}
      data-dup={dup || undefined} data-health={m.health} className="mopt" title={`${name}${failNote(m)}`}
      onClick={() => onPick(m)} onMouseMove={active ? undefined : onHover} onMouseLeave={onLeave}>
      <span className="l1">
        <ProviderIcon provider={m.provider} />
        <span className="nm"><Hit text={m.label} q={q} /></span>
        {m.is_default && <Badge tone="accent" size="sm" title={PICKER.defaultTitle}>{PICKER.defaultBadge}</Badge>}
        {m.health === 'error' && <StatusDot state="warn" size="sm" className="wdot" />}
        <span className="caps">
          {caps(m).map((c) => <Badge key={c} size="sm" className="cap">{c}</Badge>)}
          {ctx && <span className="mopt-ctx ui-num">{ctx}</span>}
        </span>
        <span className="chk" aria-hidden="true">{selected && <Icon name="check" size="sm" />}</span>
      </span>
      <span className={dup ? 'l2 dup' : 'l2'}>
        <Hit text={m.id} q={q} />
        {dup && <Badge size="sm" variant="outline" className="src">{sourceOf(m)}</Badge>}
      </span>
    </div>
  );
}
