// 모델 고르기 문구 한곳 (한국어) — 입력창 모델 버튼 · 모델 메뉴 · 답한 모델 꼬리표.
// 사용자 앱이라 '관리자' 같은 말은 쓰지 않는다 (e2e desktop.spec: 어느 화면에도 관리자 문구 없음).
import type { Reasoning } from '../../lib/api';
import type { Model } from './api';

export const REASONING: readonly { id: Reasoning; label: string; sub: string }[] = [
  { id: 'off', label: '끄기', sub: '바로 답해요' },
  { id: 'low', label: '보통', sub: '필요할 때 생각하고 답해요' }, // 게이트웨이에는 effort medium (agent.py REASONING_EFFORT)
  { id: 'high', label: '깊게', sub: '오래 생각해요. 느려요' },
];
export const reasoningLabel = (r: Reasoning) => REASONING.find((x) => x.id === r)?.label ?? '끄기';
// 답 아래 줄 · 진행 상황 꼬리표: '생각 깊게'
export const reasoningTag = (r: Reasoning | string) => (r === 'low' || r === 'high' ? `생각 ${reasoningLabel(r)}` : '');

// 모델 연결 실패 짧은 이유 (모델 메뉴 경고 · /api/models health_code). 데스크톱 사용자 말로
export const HEALTH_SHORT: Record<string, string> = {
  provider_key_missing: '키 없음',
  provider_key_invalid: '키 틀림',
  provider_model_not_found: '모델 이름 없음',
  reasoning_unsupported: '생각 설정 거절',
  provider_bad_request: '요청 거절',
  gateway_budget_exceeded: '사용 한도 초과',
  gateway_key_invalid: '게이트웨이 키 틀림',
  gateway_model_denied: '이 키로 못 씀',
  gateway_model_missing: '게이트웨이에 없음',
  provider_rate_limited: '요청 제한',
  provider_unavailable: '모델 서버 응답 없음',
  gateway_unreachable: '게이트웨이 꺼짐',
  gateway_auth_failed: '게이트웨이 인증 실패',
  provider_auth_failed: '키 문제',
  provider_rejected: '설정 문제',
  model_error: '모델 오류',
};
export const healthShort = (code: string | null | undefined) =>
  (code && Object.prototype.hasOwnProperty.call(HEALTH_SHORT, code) ? HEALTH_SHORT[code] : null) ?? '연결 실패';

// 등록한 곳 (LiteLLM model_info.db_model) — 이름이 같은 두 모델을 가른다
export const SOURCE: Record<string, string> = { config: 'config.yaml', ui: 'LiteLLM 관리 화면', mixed: 'config.yaml + 관리 화면' };
export const sourceOf = (m: Model) => (m.source ? SOURCE[m.source] : '출처 모름');

export const PICKER = {
  fallback: '기본 모델', // 목록이 없을 때 버튼 글
  allowed: '허용된 모델만 보여요',
  failingSr: '최근 연결 실패',
  dialog: '모델과 생각 깊이',
  search: '모델 검색',
  searchPlaceholder: '모델 이름으로 찾기',
  refreshing: '목록 새로 읽는 중',
  list: '모델',
  loading: '모델 목록을 불러오는 중…',
  offline: '서버에 연결할 수 없어요',
  loadFailed: '모델 목록을 불러오지 못했어요',
  retry: '다시 시도',
  none: '쓸 수 있는 모델이 없어요',
  noMatch: (q: string) => `'${q}'에 맞는 모델이 없어요`,
  clearSearch: '검색 지우기',
  depth: '생각 깊이',
  depthLocked: '이 모델은 생각 깊이를 고를 수 없어요',
  // 고른 모델이 숨겨지거나 사라져 기본으로 돌아갔을 때 (잠깐 뜨는 알림)
  fellBack: (label: string) => `${label} 모델을 더 이상 쓸 수 없어서 기본 모델로 바꿨어요`,
} as const;

// 도구를 못 쓰는 모델 (supports_tools false = 이 모델로는 앱 · 스킬이 안 실린다). 사용자 말로만 (고치는 곳은 관리자 콘솔이 안내)
export const NO_TOOLS = {
  row: '앱과 스킬 없이 답해요', // E2E: 메뉴 줄 아래 옅은 글 .mnotools
  long: '이 모델로는 앱과 스킬을 쓸 수 없어요', // E2E: 툴팁 · 화면 읽기 이름 · 모델 버튼 툴팁
};

// 이름 · 실패 이유 (툴팁 · 화면 읽기 프로그램 이름). 게이트웨이 id 는 쓰지 않는다
export const failNote = (m: Model) =>
  (m.health === 'error' ? `, 최근 연결 실패 (${healthShort(m.health_code)})` : '') + (m.supports_tools ? '' : `, ${NO_TOOLS.long}`);
export const buttonTip = (m: Model, provider: string) =>
  `${m.label}, ${provider}` + (m.health === 'error' ? `, 최근 연결에 실패했어요 (${healthShort(m.health_code)})` : '')
  + (m.supports_tools ? '' : `, ${NO_TOOLS.long}`);
// 메뉴 한 줄 툴팁: 이름이 겹치면 등록한 곳으로 가른다 · 실패면 이유
export const rowTip = (m: Model, dup: boolean) => `${m.label}${dup ? ` (${sourceOf(m)})` : ''}${failNote(m)}`;
