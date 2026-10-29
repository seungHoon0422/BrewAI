import { useEffect, useState } from 'react';
import data from 'virtual:brewai-docs';
import { AdminApiError, listAdminModels, type AdminModel, type LoadError } from '../api';
import { Icon, type IconName } from '../icons';

type Stat = { label: string; value: string; sub: string; icon: IconName };
// 게이트웨이 카드 = conductor GET /api/admin/models 의 실제 결과 (Models.tsx 와 같은 호출 · 읽기 전용)
type Gateway = { kind: 'loading' } | { kind: 'ok'; rows: AdminModel[] } | { kind: 'error'; error: LoadError };

const GATEWAY_DOWN: Record<LoadError, { value: string; sub: string }> = {
  conductor: { value: 'conductor 꺼짐', sub: 'npm run api 로 켜기' },
  gateway: { value: '꺼짐', sub: 'LiteLLM · npm run gateway 로 켜기' },
  gateway_error: { value: '오류', sub: 'LiteLLM 이 오류를 냈어요 · 게이트웨이 로그 확인' },
  gateway_auth: { value: '인증 실패', sub: '.env 의 LITELLM_MASTER_KEY 확인' },
  server: { value: '확인 실패', sub: '모델 목록을 읽지 못했어요' },
};

function gatewayStats(g: Gateway): Stat[] {
  if (g.kind === 'loading') {
    return [
      { label: '게이트웨이', value: '확인 중…', sub: 'LiteLLM', icon: 'plug' },
      { label: '노출 모델', value: '—', sub: '후보 0 · 숨김 —', icon: 'cube' },
    ];
  }
  if (g.kind === 'error') {
    return [
      { label: '게이트웨이', ...GATEWAY_DOWN[g.error], icon: 'plug' },
      { label: '노출 모델', value: '—', sub: '게이트웨이 연결 후', icon: 'cube' },
    ];
  }
  // 게이트웨이에 지금 있는 모델만 센다 (사라진 모델은 따로)
  const present = g.rows.filter((r) => r.status === 'present');
  const shown = present.filter((r) => r.state === 'exposed').length;
  const candidates = present.filter((r) => r.state === 'candidate').length;
  const missing = g.rows.length - present.length;
  const providers = new Set(present.map((r) => r.provider)).size;
  return [
    { label: '게이트웨이', value: '연결됨', sub: `LiteLLM · 모델 ${present.length}개${providers > 1 ? ` · 회사 ${providers}곳` : ''}`, icon: 'plug' },
    {
      label: '노출 모델',
      value: String(shown),
      sub: `후보 ${candidates} · 숨김 ${present.length - shown - candidates}${missing ? ` · 사라짐 ${missing}` : ''}`,
      icon: 'cube',
    },
  ];
}

// 나머지는 아직 연결 전이라 0 · —
const LATER: Stat[] = [
  { label: '승인 대기', value: '0', sub: 'P1-2 승인 카드부터', icon: 'shield' },
  { label: '오늘 비용', value: '—', sub: 'Langfuse 연결 후 · P1-3', icon: 'receipt' },
];

// docs/roadmap.json 완료 기준 id 와 맞춘다
const NEXT = [
  { id: 'P1-2', what: '승인 기록', how: '승인 카드의 허용 · 거절을 감사 기록으로' },
  { id: 'P1-3', what: '트레이스', how: 'user.id · session.id 로 Langfuse trace 열기' },
  { id: 'P2-1·2', what: '모델', how: '노출 · 표시 이름 · 순서 · 기본 모델 편집 → 금요일 E2E 로 판정 (새 모델은 후보로 숨김)' },
  { id: 'P2-3', what: '관리자 로그인', how: '사용자 앱과 따로 배포 · 인증' },
  { id: 'P3', what: '카탈로그', how: 'MCP · Skill 허용 목록 · 버전/해시 고정' },
  { id: 'P6', what: '사용자·예산', how: '월 예산 · 사용량 · 정책' },
];

export default function Overview() {
  const [gateway, setGateway] = useState<Gateway>({ kind: 'loading' });
  useEffect(() => {
    const ctrl = new AbortController();
    listAdminModels(ctrl.signal).then(
      (rows) => setGateway({ kind: 'ok', rows }),
      (e) => {
        if ((e as Error).name !== 'AbortError') setGateway({ kind: 'error', error: e instanceof AdminApiError ? e.kind : 'server' });
      },
    );
    return () => ctrl.abort();
  }, []);
  const stats = [...gatewayStats(gateway), ...LATER];

  return (
    <>
      <dl className="stats">
        {stats.map((s) => (
          <div className="stat" key={s.label} data-state={s.label === '게이트웨이' ? gateway.kind : undefined}>
            <dt>
              <Icon name={s.icon} />
              {s.label}
            </dt>
            <dd className={s.value === '—' ? 'v none' : 'v'}>{s.value}</dd>
            <dd className="sub">{s.sub}</dd>
          </div>
        ))}
      </dl>

      <a className="tome" href="#/docs/board">
        <span>
          <span aria-hidden="true">👤</span> 내가 할 일 <b>{data.board.mine.length}</b>
        </span>
        <span>
          <span aria-hidden="true">❓</span> 컨펌 필요 <b>{data.board.confirm.length}</b>
        </span>
        <span className="go">
          문서 › 보드
          <Icon name="right" />
        </span>
      </a>

      <section className="sec" aria-labelledby="next-title">
        <h2 id="next-title">다음에 채울 것</h2>
        <ol className="todo">
          {NEXT.map((n) => (
            <li key={n.id}>
              <span className="rid">{n.id}</span>
              <b>{n.what}</b>
              <span className="how">{n.how}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
