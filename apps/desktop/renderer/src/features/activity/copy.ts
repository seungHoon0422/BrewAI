// 진행 상황 문구 한곳 (한국어). 사용자 앱이라 '관리자' 같은 말은 쓰지 않는다.
import type { DotState } from '@brewai/ui';
import type { StepStatus } from '../chat/api';
import type { RunStatus } from './api';

export const ACTIVITY = {
  sub: '맡긴 일을 지금 어디까지 했는지, 어떤 모델이 어떤 도구를 썼는지 보여요.',
  live: '지금 하는 일',
  liveEmpty: '진행 중인 작업이 없어요',
  liveEmptyText: '대화에서 일을 맡기면 생각, 도구 사용, 답 쓰기 단계가 여기에 실시간으로 쌓여요.',
  liveEmptyAction: '일 맡기기',
  recent: '최근 실행',
  loading: '불러오는 중…',
  loadFailed: (why: string) => `실행 기록을 불러오지 못했어요: ${why}`,
  retry: '다시 시도',
  recentEmpty: '아직 실행 기록이 없어요',
  openChat: '대화 열기',
  steps: '단계',
} as const;

export const RUN_STATUS: Record<RunStatus, { label: string; dot: DotState }> = {
  running: { label: '진행 중', dot: 'run' },
  done: { label: '완료', dot: 'ok' },
  error: { label: '실패', dot: 'fail' },
  cancelled: { label: '멈춤', dot: 'stop' },
};
export const STEP_DOT: Record<StepStatus, DotState> = { running: 'run', done: 'ok', error: 'fail', cancelled: 'stop', waiting: 'wait' };

// 목록의 짧은 실패 이유 (error_code)
const RUN_ERROR_TEXT: Record<string, string> = {
  provider_auth_failed: '모델 키 문제',
  gateway_auth_failed: '게이트웨이 인증 실패',
  provider_rejected: '모델 설정 문제',
  gateway_unreachable: '모델에 연결 못 함',
  run_limit: '단계가 너무 많음',
  model_error: '모델 오류',
  internal_error: '서버 오류',
  client_disconnected: '중간에 멈춤',
  interrupted: '서버가 다시 켜져 멈춤',
};
export const runErrorText = (code: string | null) => (code && RUN_ERROR_TEXT[code]) || '실패';
