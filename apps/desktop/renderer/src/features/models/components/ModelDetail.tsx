// 자세히 (넓은 창 = 메뉴 오른쪽 칸 · 좁은 창 = 왼쪽에 뜨는 카드): 이름 · id(복사) · 회사 · 계열 · 컨텍스트 · 출력 · 기능 · 출처 · 상태
import { useEffect, useState } from 'react';
import { Callout, IconButton, ProviderIcon, providerLabel } from '@brewai/ui';
import { ago, tokensShort } from '../../../lib/format';
import type { Model } from '../api';
import { caps, DETAIL, healthShort, SOURCE } from '../copy';

const COPIED_MS = 1600;

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {}
    ta.remove();
  }
}

export function ModelDetail({ m, dup, card }: { m: Model; dup: boolean; card?: boolean }) {
  const [copied, setCopied] = useState(false);
  const failing = m.health === 'error';
  useEffect(() => setCopied(false), [m.id]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);
  const when = m.health_at ? ` · ${ago(m.health_at)}` : '';
  const status = failing ? `${DETAIL.warn} ${healthShort(m.health_code)}${when}` : m.health === 'ok' ? `${DETAIL.ok}${when}` : DETAIL.unchecked;
  const rows: [string, string][] = [
    [DETAIL.context, tokensShort(m.max_input_tokens) ?? DETAIL.empty],
    ...(m.max_output_tokens ? [[DETAIL.output, tokensShort(m.max_output_tokens) ?? DETAIL.empty] as [string, string]] : []),
    [DETAIL.caps, caps(m).join(' · ') || DETAIL.empty],
    [DETAIL.source, m.source ? SOURCE[m.source] : DETAIL.unknownSource],
    [DETAIL.status, status],
  ];
  return (
    <aside className={card ? 'mdetail card' : 'mdetail'} aria-label={DETAIL.region(m.label)} data-health={m.health}>
      <div className="dh">
        <ProviderIcon provider={m.provider} size="lg" />
        <b>{m.label}</b>
      </div>
      <div className="did">
        <code className={dup ? 'dup' : undefined}>{m.id}</code>
        <IconButton icon={copied ? 'check' : 'copy'} label={DETAIL.copyId} size="sm" onClick={() => void copyText(m.id).then(() => setCopied(true))} />
        {copied && <span className="copied" role="status">{DETAIL.copied}</span>}
      </div>
      <p className="dfam">{[providerLabel(m.provider, m.provider_label), m.family ? DETAIL.family(m.family) : ''].filter(Boolean).join(' · ')}</p>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className={k === DETAIL.status && failing ? 'warn' : undefined}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {failing && <Callout tone="warn" className="dnote">{DETAIL.failingNote}</Callout>}
      {dup && <Callout className="dnote">{DETAIL.dupNote}</Callout>}
    </aside>
  );
}
