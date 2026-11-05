// 설정 › API 키 문구 (한국어 · 가운뎃점 구분자 없음)
import type { Scope } from './api';

export const KEYS = {
  sub: '다른 프로그램(스크립트, OpenAI SDK, Cursor 같은 도구)에서 BrewAI 모델을 부를 때 쓰는 키예요. 키는 만들 때 한 번만 보여요.',
  create: '새 키 만들기', // e2e 계약
  off: '조직 정책으로 API 키가 꺼져 있어요. 새 키를 만들 수 없고, 있던 키도 지금은 쓸 수 없어요',
  limitsTitle: '한도',
  limitsHint: '조직 정책으로 정해져 있어요. 키마다 따로 정해 둔 한도가 있으면 그 값이 먼저예요',
  rpm: (n: string) => `분당 ${n}회`,
  perDay: (n: string) => `하루 ${n} 토큰`,
  perMonth: (n: string) => `월 ${n}`,
  unlimited: '무제한',
  list: '내 키', // e2e 계약 (표 이름)
  empty: '아직 만든 키가 없어요',
  col: { name: '이름', key: '키', scopes: '범위', month: '이번 달', used: '마지막 사용', expires: '만료', status: '상태' },
  month: (runs: string, cost: string) => `${runs}회, ${cost}`,
  never: '아직 안 씀',
  status: { active: '사용 중', expired: '만료', revoked: '폐기' } as const,
  revoke: '폐기', // e2e 계약
  revokeTitle: (name: string) => `'${name}' 키를 폐기할까요?`,
  revokeBody: '이 키로 부르는 프로그램은 바로 401 오류를 받아요. 되돌릴 수 없어요',
  cancel: '취소',
  // 만들기
  formTitle: '새 API 키',
  name: '이름',
  namePlaceholder: '예: 주간 보고 스크립트',
  scopes: '할 수 있는 일',
  expires: '만료',
  days: (d: number) => `${d}일`,
  make: '만들기',
  // 한 번만 보기
  madeTitle: '키를 복사해 두세요',
  madeBody: '이 창을 닫으면 키를 다시 볼 수 없어요. 잃어버리면 폐기하고 새로 만들어요',
  copy: '복사', // e2e 계약
  copied: '복사했어요',
  example: '예시',
  done: '다 했어요',
} as const;

export const SCOPE_LABEL: Record<Scope, { label: string; hint: string }> = {
  'models:read': { label: '모델 목록 보기', hint: 'GET /v1/models' },
  chat: { label: '대화 호출', hint: 'POST /v1/chat/completions' },
  'usage:read': { label: '사용량 보기', hint: '다음 단계' },
};

const ERRORS: Record<string, string> = {
  api_keys_off: '조직 정책으로 API 키가 꺼져 있어요',
  too_many_keys: '쓰는 키가 너무 많아요 (20개까지). 안 쓰는 키를 폐기해 주세요',
  bad_name: '이름을 1~60자로 적어 주세요',
  bad_scopes: '할 수 있는 일을 하나 이상 골라 주세요',
  bad_days: '만료 기간이 조직 정책의 최대보다 길어요',
  key_not_found: '그 키를 찾지 못했어요',
  offline: '서버에 연결할 수 없어요',
};
export const keyError = (code: string | undefined) =>
  code && Object.prototype.hasOwnProperty.call(ERRORS, code) ? ERRORS[code] : '잠시 후 다시 시도해 주세요';
