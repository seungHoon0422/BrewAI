// 개요 화면 문구. 카드 라벨 · 값은 E2E 가 읽는다 (e2e/admin-models.spec.ts '개요: …')
import type { IconName } from '@brewai/ui';
import type { LoadError } from '../../shared/http';

export type Stat = { label: string; value: string; sub: string; icon: IconName };

export const GATEWAY = '게이트웨이';
export const EXPOSED = '노출 모델';

export const GATEWAY_DOWN: Record<LoadError, { value: string; sub: string }> = {
  conductor: { value: 'conductor 꺼짐', sub: 'npm run api 로 켜기' },
  gateway: { value: '꺼짐', sub: 'LiteLLM, npm run gateway 로 켜기' },
  gateway_error: { value: '오류', sub: 'LiteLLM 이 오류를 냈어요. 게이트웨이 로그 확인' },
  gateway_auth: { value: '인증 실패', sub: '.env 의 LITELLM_MASTER_KEY 확인' },
  server: { value: '확인 실패', sub: '모델 목록을 읽지 못했어요' },
};

export const OVERVIEW_COPY = {
  checking: '확인 중…',
  litellm: 'LiteLLM',
  exposedLoading: '후보 0, 숨김 —',
  afterGateway: '게이트웨이 연결 후',
  connected: '연결됨',
  gatewaySub: (models: number, providers: number) => `LiteLLM, 모델 ${models}개${providers > 1 ? `, 회사 ${providers}곳` : ''}`,
  exposedSub: (candidates: number, hidden: number, missing: number) => `후보 ${candidates}, 숨김 ${hidden}${missing ? `, 사라짐 ${missing}` : ''}`,
  mine: '내가 할 일',
  confirm: '컨펌 필요',
  toBoard: '문서 › 보드',
  next: '다음에 채울 것',
} as const;

// 나머지는 아직 연결 전이라 0 · —
export const LATER: Stat[] = [
  { label: '승인 대기', value: '0', sub: 'P1-2 승인 카드부터', icon: 'shield' },
  { label: '오늘 비용', value: '—', sub: 'Langfuse 연결 후 (P1-3)', icon: 'receipt' },
];

// docs/roadmap.json 완료 기준 id 와 맞춘다
export const NEXT = [
  { id: 'P1-2', what: '승인 기록', how: '승인 카드의 허용과 거절을 감사 기록으로' },
  { id: 'P1-3', what: '트레이스', how: 'user.id, session.id 로 Langfuse trace 열기' },
  { id: 'P2-1~2', what: '모델', how: '노출, 표시 이름, 순서, 기본 모델 편집 → 금요일 E2E 로 판정 (새 모델은 후보로 숨김)' },
  { id: 'P2-3', what: '관리자 로그인', how: '사용자 앱과 따로 배포, 인증' },
  { id: 'P3', what: '카탈로그', how: 'MCP, Skill 허용 목록, 버전/해시 고정' },
  { id: 'P6', what: '사용자와 예산', how: '월 예산, 사용량, 정책' },
];
