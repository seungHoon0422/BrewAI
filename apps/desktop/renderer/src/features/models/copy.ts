// 모델 고르기 문구 한곳 (한국어) — 입력창 모델 버튼 · 모델 메뉴 · 자세히 · 답한 모델 꼬리표.
// 사용자 앱이라 '관리자' 같은 말은 쓰지 않는다 (e2e desktop.spec: 어느 화면에도 관리자 문구 없음).
import type { Reasoning } from '../../lib/api';
import type { Model } from './api';

export const REASONING: readonly { id: Reasoning; label: string; sub: string }[] = [
  { id: 'off', label: '끄기', sub: '바로 답해요' },
  { id: 'low', label: '보통', sub: '필요할 때 생각하고 답해요' }, // 게이트웨이에는 effort medium (agent.py REASONING_EFFORT)
  { id: 'high', label: '깊게', sub: '오래 생각해요 · 느려요' },
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

export const caps = (m: Model) => [m.supports_reasoning ? '생각' : '', m.supports_tools ? '도구' : '', m.supports_vision ? '이미지' : ''].filter(Boolean);

export const PICKER = {
  fallback: '기본 모델', // 목록이 없을 때 버튼 글
  allowed: '허용된 모델만 보여요',
  failingSr: '최근 연결 실패',
  dialog: '모델과 생각 깊이',
  search: '모델 검색',
  searchPlaceholder: '이름 또는 ID로 찾기',
  refreshing: '목록 새로 읽는 중',
  list: '모델',
  loading: '모델 목록을 불러오는 중…',
  offline: '서버에 연결할 수 없어요',
  loadFailed: '모델 목록을 불러오지 못했어요',
  retry: '다시 시도',
  none: '쓸 수 있는 모델이 없어요',
  noMatch: (q: string) => `'${q}'에 맞는 모델이 없어요`,
  clearSearch: '검색 지우기',
  recent: '최근 사용',
  defaultBadge: '기본',
  defaultTitle: '기본 모델',
  depth: '생각 깊이',
  depthLocked: '이 모델은 생각 깊이를 고를 수 없어요',
  // 고른 모델이 숨겨지거나 사라져 기본으로 돌아갔을 때 (잠깐 뜨는 알림)
  fellBack: (label: string) => `${label} 모델을 더 이상 쓸 수 없어서 기본 모델로 바꿨어요`,
} as const;

// 이름 · 실패 이유 (툴팁 · 화면 읽기 프로그램 이름)
export const failNote = (m: Model) => (m.health === 'error' ? ` · 최근 연결 실패 (${healthShort(m.health_code)})` : '');
export const buttonTip = (m: Model, provider: string) =>
  `${m.label}${m.label !== m.id ? ` (${m.id})` : ''} · ${provider}`
  + (m.health === 'error' ? ` · 최근 연결에 실패했어요 · ${healthShort(m.health_code)}` : '');

export const DETAIL = {
  region: (label: string) => `${label} 자세히`,
  copyId: 'ID 복사',
  copied: '복사했어요',
  family: (f: string) => `${f} 계열`,
  context: '컨텍스트',
  output: '출력',
  caps: '기능',
  source: '출처',
  status: '상태',
  unknownSource: '알 수 없음',
  empty: '—',
  ok: '정상',
  unchecked: '확인 전',
  warn: '⚠', // 상태 줄 앞 (글 첫 글자 = 경고 점 색)
  failingNote: '고를 수는 있지만 답이 실패할 수 있어요',
  dupNote: '같은 이름의 모델이 더 있어요 — ID 로 구분해요',
} as const;
