// 여러 기능이 같이 쓰는 문구 (시각 · 1회 코드 · 공통 오류). 기능 문구는 features/<이름>/copy.ts.
import type { LoadError } from './http';

export const COMMON_COPY = {
  retry: '다시 시도',
  cancel: '취소',
  save: '저장',
  close: '닫기',
  none: '—',
  ago: {
    now: '방금',
    min: (n: number) => `${n}분 전`,
    hour: (n: number) => `${n}시간 전`,
    day: (n: number) => `${n}일 전`,
  },
  until: {
    left: (text: string) => `${text} 남음`,
    passed: '지남',
    min: (n: number) => `${n}분`,
    hour: (n: number) => `${n}시간`,
    day: (n: number) => `${n}일`,
  },
  // 1회 표시 코드 (초대 코드 · 비밀번호 재설정 코드)
  code: {
    copy: '복사',
    copied: '복사했어요',
    copyFailed: '복사하지 못했어요. 코드를 길게 눌러 직접 복사해 주세요',
    once: '이 창을 닫으면 다시 볼 수 없어요. 지금 복사해 두세요.',
  },
  // 바꾸기 요청 실패 (기능 copy 의 code 표에 없을 때)
  failed: '처리하지 못했어요. 잠시 뒤 다시 시도해 주세요',
  toasts: '알림',
} as const;

// 목록을 못 읽음 (사용자·조직 탭 공통). 모델 화면은 게이트웨이 안내가 더 있어 models/copy.ts LOAD_ERROR 를 쓴다
export const LOAD_FAILED: Record<LoadError, string> = {
  conductor: 'conductor 에 연결할 수 없어요 — npm run api',
  gateway: '게이트웨이에 연결할 수 없어요',
  gateway_error: '게이트웨이가 오류를 냈어요',
  gateway_auth: '게이트웨이 인증에 실패했어요',
  server: '목록을 읽지 못했어요',
};
