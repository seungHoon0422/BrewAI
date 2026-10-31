// 계정 문구 (한국어) — 사이드바 계정 칩 · 설정 › 계정
export const ACCOUNT = {
  chip: '계정',
  settings: '설정 › 계정',
  logout: '로그아웃',
  section: '계정',
  nickname: '닉네임',
  nicknameSub: '대화, 멤버 목록 등 사람이 보이는 곳에 이 이름이 나와요',
  nicknameHint: '1~40자, 다른 사람과 같아도 돼요',
  email: '이메일',
  emailSub: '로그인 ID 예요. 바꿀 수 없어요',
  password: '비밀번호',
  passwordSub: (has: boolean) => (has ? '바꾸면 다른 기기의 로그인이 끊겨요' : '아직 없어요. 만들면 이메일로도 로그인할 수 있어요'),
  passwordSet: '설정됨',
  passwordNone: '없음',
  current: '지금 비밀번호',
  next: '새 비밀번호',
  nextHint: (min: number) => `${min}자 이상, 조합 규칙 없음`,
  google: 'Google',
  googleSub: (email: string | null) => (email ? `${email} 로 로그인할 수 있어요` : 'Google 계정으로도 로그인할 수 있어요'),
  googleOff: '연결 안 됨',
  googleWait: '브라우저에서 연결을 마쳐 주세요',
  googleLinked: 'Google 을 연결했어요',
  googleUnlinked: 'Google 연결을 해제했어요',
  lastMethod: '마지막 로그인 방법이라 해제할 수 없어요',
  change: '변경',
  create: '만들기',
  connect: '연결',
  disconnect: '해제',
  save: '저장',
  cancel: '취소',
  saved: '저장했어요',
  passwordChanged: '비밀번호를 바꿨어요. 다른 기기는 다시 로그인해야 해요',
  nicknameTitle: '닉네임 바꾸기',
  passwordTitle: (has: boolean) => (has ? '비밀번호 바꾸기' : '비밀번호 만들기'),
  unlinkTitle: 'Google 연결을 해제할까요?',
  unlinkBody: '해제하면 이 Google 계정으로는 로그인할 수 없어요',
} as const;

const ERRORS: Record<string, string> = {
  bad_display_name: '닉네임은 1~40자로 적어 주세요',
  wrong_password: '지금 비밀번호가 맞지 않아요',
  password_too_long: '비밀번호가 너무 길어요 (128자까지)',
  not_linked: '연결된 Google 계정이 없어요',
  last_login_method: '마지막 로그인 방법이라 해제할 수 없어요',
  google_disabled: '이 서버는 Google 로그인을 쓰지 않아요',
  offline: '서버에 연결할 수 없어요',
};
export function accountError(code: string | undefined, min = 15): string {
  if (code === 'password_too_short') return `비밀번호는 ${min}자 이상이어야 해요`;
  return code && Object.prototype.hasOwnProperty.call(ERRORS, code) ? ERRORS[code] : '잠시 후 다시 시도해 주세요';
}
