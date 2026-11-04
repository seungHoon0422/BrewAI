// 문서 디자인 견본 카드 (설정 › 스킬) — 디자인마다 견본 쪽 그림 · 이름 · 한 줄 설명 · 고르는 말. 그림 = 우리 API 에서 data: 주소로 (CSP)
import { useEffect, useState } from 'react';
import { Spinner } from '@brewai/ui';
import { designPreview, listDesigns, type DesignInfo } from '../api';
import { SKILLS } from '../copy';

function Thumb({ id, label }: { id: string; label: string }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void designPreview(id).then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [id]);
  return (
    <span className="dz-thumb" aria-hidden="true">
      {src ? <img src={src} alt="" /> : src === undefined ? <Spinner size="sm" /> : null}
      <span className="ui-sr">{label}</span>
    </span>
  );
}

export function DesignCards() {
  const [designs, setDesigns] = useState<DesignInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    listDesigns(ctl.signal).then(setDesigns).catch(() => !ctl.signal.aborted && setFailed(true));
    return () => ctl.abort();
  }, []);
  if (failed) return <p className="needs" role="alert">{SKILLS.designsFailed}</p>;
  if (!designs) return <p className="needs">{SKILLS.loading}</p>;
  return (
    <ul className="dz-list" aria-label={SKILLS.designList}>
      {designs.map((d) => (
        <li key={d.id} className="dz-card" data-design={d.id}>
          <Thumb id={d.id} label={d.label} />
          <span className="dz-body">
            <b><i className="dz-dot" style={d.accent ? { background: d.accent } : undefined} aria-hidden="true" />{d.label}</b>
            <span className="dz-desc">{d.description}</span>
            <span className="dz-hint">{SKILLS.designHint(d.label)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
