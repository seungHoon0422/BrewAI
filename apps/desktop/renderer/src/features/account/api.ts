// 내 계정 API (Bearer) — 닉네임 · 비밀번호 · Google 해제. Google 연결은 main 이 한다 (auth/hooks continueWithGoogle({link}))
import { ApiError, json, send } from '../../lib/api';
import { toMe, type Me } from '../auth/api';

const must = (me: Me | null) => {
  if (!me) throw new ApiError('server', 'bad_shape');
  return me;
};

export const getMe = async () => must(toMe(await json('/api/me')));
export const patchMe = async (patch: { display_name: string }) => must(toMe(await send('/api/me', 'PATCH', patch)));
// 403 wrong_password = 지금 비밀번호가 틀림 (세션 만료가 아니다) · 성공하면 다른 기기의 로그인이 끊긴다
export const changePassword = async (current: string | null, next: string) => {
  await send('/api/me/password', 'POST', current === null ? { new_password: next } : { current_password: current, new_password: next });
};
export const unlinkGoogle = async () => {
  await send('/api/me/google', 'DELETE');
};
