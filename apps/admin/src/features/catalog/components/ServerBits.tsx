import { Badge } from '@brewai/ui';
import type { AdminServer, McpStatus } from '../api';
import { AUTH_TEXT, MCP_COPY, ORIGIN_TEXT, STATUS_TEXT, type CatalogTab } from '../copy';
import { serverHref } from '../route';

// 표 · 자세히 페이지가 같이 쓰는 작은 조각 (상태 · 로그인 방식 · 이름 링크 · 쓰기 표시)
const STATUS_TONE: Record<McpStatus, 'ok' | 'neutral' | 'danger'> = { active: 'ok', disabled: 'neutral', error: 'danger' };

export const StatusBadge = ({ status }: { status: McpStatus }) => (
  <Badge size="sm" dot tone={STATUS_TONE[status]} className="mcp-status" data-status={status}>{STATUS_TEXT[status]}</Badge>
);

export const OriginBadge = ({ origin }: { origin: AdminServer['origin'] }) => (
  <Badge size="sm" tone={origin === 'admin' ? 'info' : 'neutral'} className="mcp-origin">{ORIGIN_TEXT[origin]}</Badge>
);

// 쓰기 도구 = 지금 바로 허용 (ADR-0013) · 표시만. 승인 카드(slice 07) 뒤 도구별 '승인 필요' 로
export const WriteBadge = () => (
  <Badge size="sm" tone="warn" className="mcp-write" title={MCP_COPY.writeTitle}>{MCP_COPY.writeBadge}</Badge>
);

// 로그인 방식 한 줄: 'OAuth' (+ 로그인 서버 도메인이 MCP 도메인과 다르면 옅게)
export function AuthText({ s }: { s: Pick<AdminServer, 'auth' | 'issuer_domain' | 'domain'> }) {
  const other = s.auth === 'oauth' && s.issuer_domain && s.issuer_domain !== s.domain ? s.issuer_domain : null;
  return (
    <span className="mcp-auth" data-auth={s.auth}>
      {AUTH_TEXT[s.auth]}
      {other && <span className="mcp-sub"> {other}</span>}
    </span>
  );
}

// 이름 칸 = 이름(자세히 페이지 링크) / 부르는 이름(고정폭 · 옅게)
export function ServerName({ s, from }: { s: AdminServer; from?: CatalogTab }) {
  return (
    <span className="mcp-name">
      <a className="mcp-link" href={serverHref(s.id, from)}><b className="ui-ell">{s.name}</b></a>
      <code className="mcp-handle">{s.handle}</code>
    </span>
  );
}
