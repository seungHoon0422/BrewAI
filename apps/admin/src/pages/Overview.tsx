import data from 'virtual:brewai-docs';
import { Icon, type IconName } from '../icons';

// 값은 전부 지금의 실제 상태다 (연결 전이라 미연결 · 0 · —)
const STATS: { label: string; value: string; sub: string; icon: IconName }[] = [
  { label: '게이트웨이', value: '미연결', sub: 'LiteLLM · P2에서 동기화', icon: 'plug' },
  { label: '노출 모델', value: '0', sub: '후보 0 · 숨김 0', icon: 'cube' },
  { label: '승인 대기', value: '0', sub: 'P1-2 승인 카드부터', icon: 'shield' },
  { label: '오늘 비용', value: '—', sub: 'Langfuse 연결 후 · P1-3', icon: 'receipt' },
];

// docs/roadmap.json 완료 기준 id 와 맞춘다
const NEXT = [
  { id: 'P1-2', what: '승인 기록', how: '승인 카드의 허용 · 거절을 감사 기록으로' },
  { id: 'P1-3', what: '트레이스', how: 'user.id · session.id 로 Langfuse trace 열기' },
  { id: 'P2-1·2', what: '모델', how: '게이트웨이 동기화 · 새 모델은 후보로 숨김' },
  { id: 'P2-3', what: '관리자 로그인', how: '사용자 앱과 따로 배포 · 인증' },
  { id: 'P3', what: '카탈로그', how: 'MCP · Skill 허용 목록 · 버전/해시 고정' },
  { id: 'P6', what: '사용자·예산', how: '월 예산 · 사용량 · 정책' },
];

export default function Overview() {
  return (
    <>
      <dl className="stats">
        {STATS.map((s) => (
          <div className="stat" key={s.label}>
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
