// 사용자와 조직 › API 키 탭 문구 (한국어 · 가운뎃점 구분자 없음)
import type { KeyStatus } from './api';

export const KEYS_COPY = {
  tab: 'API 키', // e2e 계약 (탭 이름)
  policy: '정책', // e2e 계약 (카드 제목)
  policyHint: '사용자가 데스크톱 설정에서 직접 키를 만들어요. 여기 값이 모든 키의 기본이에요',
  enabled: '사용자 API 키 허용', // e2e 계약 (스위치 이름)
  enabledHint: '끄면 새 키를 만들 수 없고, 있던 키도 바로 막혀요',
  defaultDays: '기본 만료 (일)',
  maxDays: '최대 만료 (일)',
  rpm: '분당 요청',
  tokens: '하루 토큰',
  usd: '월 추정 비용 (USD)',
  unlimitedHint: '비우면 무제한',
  save: '저장',
  saved: 'API 키 정책을 저장했어요',
  table: '전체 API 키', // e2e 계약 (표 이름)
  count: (n: number) => `${n}개`,
  col: { user: '사용자', name: '키 이름', key: '키', month: '이번 달', limits: '한도', used: '마지막 사용', expires: '만료', state: '상태', action: '동작' },
  month: (runs: string, tokens: string, cost: string) => `${runs}회, ${tokens} 토큰, ${cost}`,
  limitsLine: (rpm: string, tokens: string, usd: string) => `${rpm}/분, ${tokens}/일, ${usd}/월`,
  unlimited: '무제한',
  custom: '따로 정함',
  never: '아직 안 씀',
  status: { active: '사용 중', expired: '만료', revoked: '폐기' } as Record<KeyStatus, string>,
  editLimits: '한도', // e2e 계약
  editLimitsLabel: (name: string) => `한도 바꾸기 ${name}`,
  limitsTitle: (name: string) => `'${name}' 키 한도`,
  limitsBody: '이 키에만 적용돼요. 비운 칸은 무제한이에요',
  toDefault: '정책 기본값으로',
  revoke: '폐기',
  revokeLabel: (name: string) => `폐기 ${name}`,
  revokeTitle: (name: string) => `'${name}' 키를 폐기할까요?`,
  revokeBody: '이 키로 부르는 프로그램은 바로 401 오류를 받아요. 되돌릴 수 없어요',
  revoked: (name: string) => `폐기했어요: ${name}`,
  limitsSaved: (name: string) => `한도를 바꿨어요: ${name}`,
  empty: '아직 만든 API 키가 없어요',
  emptyHow: '사용자가 데스크톱 설정 › API 키에서 만들어요.',
} as const;

export const KEYS_ERRORS: Readonly<Record<string, string>> = {
  bad_limits: '한도는 0보다 큰 숫자로 적어 주세요',
  bad_default_days: '기본 만료는 최대 만료보다 길 수 없어요',
  bad_max_days: '최대 만료는 1~3650일이에요',
  key_not_found: '그 키를 찾지 못했어요',
};
