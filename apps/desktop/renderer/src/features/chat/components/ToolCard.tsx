// 도구 블록 (상태 줄 패널 안) = 카드: 아이콘 타일 · 이름 · '도구' 꼬리표 · 상태(+걸린 시간) / 입력(핵심 인자 값) · 결과(제목과 링크 목록 또는 발췌).
// 날것 JSON 은 '원문' 토글 뒤에 (기본 접힘). 생각 블록(조용한 글)과 한눈에 다르게 — 테두리 있는 면 · 굵은 이름 · 상태 글.
// MCP 앱 도구 = 앱 아이콘 (서비스 사이트 그림 · 없으면 첫 글자 · connections AppIcon) · '<앱>: <도구>' 이름 · 쓰기 도구는 '쓰기' 배지 (지금은 표시만 · 승인은 slice 07) · 연결 대기 = 자물쇠.
// 앱 도구 고르기(use_app)는 카드가 아니라 한 줄 메모 (AppNote).
import { useId, useState } from 'react';
import { Badge, Icon, Spinner } from '@brewai/ui';
import { seconds } from '../../../lib/format';
import { AppIcon } from '../../connections/components/AppIcon';
import { TOOL, TRACE } from '../copy';
import type { ToolPart } from '../model';
import { TOOL_STATE_ICON, appNote, toolIcon, toolView } from '../tools';

// took = 보여 줄 시간 글 (병렬 묶음 = 실행 시간 · 없으면 부르기 시작 ~ 결과)
export function ToolCard({ p, took }: { p: ToolPart; took?: string }) {
  const icon = TOOL_STATE_ICON[p.status];
  const tm = took ?? (p.ms != null ? seconds(p.ms) : '');
  const v = toolView(p);
  const [raw, setRaw] = useState(false);
  const rawId = useId();
  return (
    <div className="tp-tool" data-kind="tool" data-state={p.status} data-tool={p.name} data-app={p.app?.handle} data-write={p.app?.write || undefined}
      role="group" aria-label={p.name === 'use_skill' ? TOOL.skillGroup : p.app ? TOOL.appGroup(p.label) : TOOL.group(p.label)}>
      <div className="th">
        <span className="ttile" aria-hidden="true">{p.app ? <AppIcon handle={p.app.handle} name={p.app.name || p.app.handle} size="xs" /> : <Icon name={toolIcon(p)} size="sm" />}</span>
        <b title={p.name}>{p.label}</b>
        {p.app?.write && <Badge size="sm" tone="warn" className="twrite" title={TOOL.writeTitle}>{TOOL.write}</Badge>}
        <span className="tkind" aria-hidden="true">{TRACE.tool}</span>
        <span className="tst">
          {p.status === 'running' ? <Spinner size="xs" /> : icon && <Icon name={icon} size="sm" />}
          <span>{TOOL.state[p.status]}</span>
          {p.status !== 'running' && tm && <span className="tm ui-num">{tm}</span>}
        </span>
      </div>
      <dl>
        {v.rows.map((r) => (
          <div key={r.k} className={r.err ? 'err' : undefined} data-row={r.k}>
            <dt>{r.k}</dt>
            <dd className={r.mono ? 'mono' : undefined} title={r.v}>{r.v}</dd>
          </div>
        ))}
      </dl>
      {v.links.length > 0 && (
        <ul className="tp-links" aria-label={TOOL.links}>
          {v.links.map((l, i) => (
            <li key={`${i}:${l.url ?? l.title}`}>
              {l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer" title={l.url}>{l.title}</a> : <span className="lt">{l.title}</span>}
              {l.domain && <span className="ld">{l.domain}</span>}
            </li>
          ))}
          {v.more > 0 && <li className="lmore">{TOOL.more(v.more)}</li>}
        </ul>
      )}
      {(v.note || v.raw) && (
        <div className="tfoot">
          {v.note && <span className="tnote">{v.note}</span>}
          {v.raw && (
            <button type="button" className="traw-btn" aria-expanded={raw} aria-controls={rawId} onClick={() => setRaw((x) => !x)}>
              {raw ? TOOL.rawHide : TOOL.rawShow}
            </button>
          )}
        </div>
      )}
      {v.raw && <pre className="traw ui-scroll" id={rawId} hidden={!raw} aria-label={TOOL.raw}>{raw ? v.raw : ''}</pre>}
    </div>
  );
}

// 앱 도구 고르기 = 한 줄 메모 ('Exa 웹 검색 연결, 도구 2개') · 도구 이름은 마우스를 올리면 · 연결 기다림은 상태 글
// apps = 앱 handle → 이름 (결과가 오기 전 · 연결 기다림에도 이름으로)
export function AppNote({ p, apps }: { p: ToolPart; apps: Record<string, string> }) {
  const n = appNote(p, apps);
  return (
    <p className="tp-note" data-kind="app-pick" data-tool={p.name} data-state={p.status} data-app={p.app?.handle} title={n.tools || undefined}>
      {p.status === 'running' ? <Spinner size="xs" />
        : p.status === 'waiting' || p.status === 'error' || !p.app ? <Icon name={p.status === 'waiting' ? 'lock' : p.status === 'error' ? 'close' : 'plug'} size="sm" />
        : <AppIcon handle={p.app.handle} name={p.app.name || apps[p.app.handle] || p.app.handle} size="xs" />}
      <span className="tn">{n.text}</span>
      {n.tools && <span className="tn-tools">{n.tools}</span>}
    </p>
  );
}
