// 대화 화면 문구 한곳 (한국어). 서버 글은 그대로 띄우지 않고 code → 문구.
import type { Failure, Reasoning, RunStatus, StepStatus } from '../api';

export const FAILURE_TEXT: Record<Failure, string> = {
  offline: '서버에 연결할 수 없어요',
  gateway: '모델에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요',
  config: '이 모델을 지금 쓸 수 없어요. 관리자에게 알려 주세요',
  no_models: '쓸 수 있는 모델이 없어요. 관리자에게 알려 주세요',
  model_gone: '고른 모델을 더 이상 쓸 수 없어요. 다른 모델을 골라 다시 시도해 주세요',
  busy: '이 대화에서 아직 답을 쓰는 중이에요. 끝난 뒤 다시 보내 주세요',
  too_long: '질문이 너무 길어요. 나눠서 보내 주세요',
  run_limit: '단계가 너무 많아 멈췄어요. 질문을 나눠서 다시 시도해 주세요',
  not_found: '대화를 찾지 못했어요',
  cut: '답이 중간에 끊겼어요',
  server: '답을 받지 못했어요',
};

// 진행 상황 목록의 짧은 실패 이유 (error_code). 사용자 앱이라 '관리자' 같은 말은 쓰지 않는다
const RUN_ERROR_TEXT: Record<string, string> = {
  provider_auth_failed: '모델 키 문제',
  gateway_auth_failed: '게이트웨이 인증 실패',
  gateway_unreachable: '모델에 연결 못 함',
  run_limit: '단계가 너무 많음',
  model_error: '모델 오류',
  internal_error: '서버 오류',
  client_disconnected: '중간에 멈춤',
  interrupted: '서버가 다시 켜져 멈춤',
};
export const runErrorText = (code: string | null) => (code && RUN_ERROR_TEXT[code]) || '실패';

export const REASONING: readonly { id: Reasoning; label: string; sub: string }[] = [
  { id: 'off', label: '끄기', sub: '바로 답해요' },
  { id: 'low', label: '보통', sub: '조금 생각하고 답해요' },
  { id: 'high', label: '깊게', sub: '오래 생각해요 · 느려요' },
];
export const reasoningLabel = (r: Reasoning) => REASONING.find((x) => x.id === r)?.label ?? '끄기';

export const RUN_STATUS: Record<RunStatus, { label: string; dot: 'run' | 'ok' | 'fail' | 'stop' }> = {
  running: { label: '진행 중', dot: 'run' },
  done: { label: '완료', dot: 'ok' },
  error: { label: '실패', dot: 'fail' },
  cancelled: { label: '멈춤', dot: 'stop' },
};
export const STEP_DOT: Record<StepStatus, 'run' | 'ok' | 'fail' | 'stop'> = { running: 'run', done: 'ok', error: 'fail', cancelled: 'stop' };

// 단계 이름 → 화면 이름. 툴 이름은 /api/tools 의 label (계산기 · 현재 시각)
export function stepLabel(name: string, tools: Record<string, string>): string {
  if (name === 'thinking') return '생각';
  if (name === 'writing') return '답 쓰기';
  if (name.startsWith('tool:')) {
    const tool = name.slice(5);
    return tools[tool] ?? tool;
  }
  return name;
}

// 지금 하는 일 한 줄 (상태 줄)
export function stepDoing(name: string | null, tools: Record<string, string>): string {
  if (name === 'thinking') return '생각하는 중';
  if (name === 'writing') return '답 쓰는 중';
  if (name?.startsWith('tool:')) return `${stepLabel(name, tools)} 실행 중`;
  return '응답 기다리는 중';
}

// 걸린 시간: 0.4초 · 12초 · 1분 5초
export function seconds(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return `${s.toFixed(1)}초`;
  if (s < 60) return `${Math.round(s)}초`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return r ? `${m}분 ${r}초` : `${m}분`;
}

// '방금' · '3분 전' · '2시간 전' · '10월 28일'
export function ago(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 45) return '방금';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}분 전`;
  if (s < 86400) return `${Math.round(s / 3600)}시간 전`;
  const d = new Date(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export const titleOf = (text: string) => {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? text.trim();
  return line.length <= 80 ? line : `${line.slice(0, 79)}…`;
};
