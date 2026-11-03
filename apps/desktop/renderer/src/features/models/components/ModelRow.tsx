// 모델 메뉴 한 줄 (role=option) = 회사 아이콘 · 이름(검색어 굵게) · (실패하면) 경고 점 · 고름 표시. 그 밖은 보이지 않는다.
// 도구를 못 쓰는 모델만 이름 아래 옅은 한 줄 (앱 · 스킬 없이 답한다 · copy.ts NO_TOOLS).
// 포커스는 검색칸(있으면) 또는 목록에 두고 aria-activedescendant 로 가리킨다.
import { Icon, ProviderIcon, StatusDot } from '@brewai/ui';
import type { Model } from '../api';
import { NO_TOOLS, rowTip } from '../copy';
import { hitRange } from '../picker';

// 검색어와 맞는 부분을 굵게
function Hit({ text, q }: { text: string; q: string }) {
  const r = hitRange(text, q);
  if (!r) return <>{text}</>;
  return <>{text.slice(0, r[0])}<b className="hit">{text.slice(r[0], r[1])}</b>{text.slice(r[1])}</>;
}

export function ModelRow({ id, m, q, dup, selected, active, onPick, onHover }: {
  id: string; m: Model; q: string; dup: boolean; selected: boolean; active: boolean;
  onPick: (m: Model) => void; onHover: () => void;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div id={id} role="option" aria-selected={selected} aria-label={rowTip(m, dup)} data-model={m.id} data-active={active || undefined}
      data-health={m.health} data-tools={m.supports_tools ? undefined : 'off'} className="mopt" title={rowTip(m, dup)}
      onClick={() => onPick(m)} onMouseMove={active ? undefined : onHover}>
      <ProviderIcon provider={m.provider} />
      {m.supports_tools ? (
        <span className="nm"><Hit text={m.label} q={q} /></span>
      ) : (
        <span className="nmw">
          <span className="nm"><Hit text={m.label} q={q} /></span>
          <span className="mnotools" aria-hidden="true">{NO_TOOLS.row}</span>
        </span>
      )}
      {m.health === 'error' && <StatusDot state="warn" size="sm" className="wdot" />}
      <span className="chk" aria-hidden="true">{selected && <Icon name="check" size="sm" />}</span>
    </div>
  );
}
