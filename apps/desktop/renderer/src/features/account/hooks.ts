// 계정 동작 — 바뀐 '나' 는 auth store 로 (닉네임이 사이드바 칩 · 멤버 목록에 바로). 실패 = conductor 코드를 던진다
import { errorText } from '../auth/copy';
import { continueWithGoogle, setMe } from '../auth/hooks';
import { changePassword, getMe, patchMe, unlinkGoogle } from './api';

export async function saveNickname(name: string) {
  setMe(await patchMe({ display_name: name.trim() }));
}

export async function savePassword(current: string | null, next: string) {
  await changePassword(current, next);
  setMe(await getMe()); // has_password
}

// 설정 › 계정 › Google [연결] — 브라우저에서 마치면 /api/me 를 다시 읽는다. 취소 = 둘 다 비어 있음
export async function linkGoogle(): Promise<{ linked: boolean; error: string | null }> {
  const r = await continueWithGoogle({ link: true });
  if (!r.ok) return { linked: false, error: r.code === 'cancelled' ? null : errorText(r.code) };
  setMe(await getMe());
  return { linked: true, error: null };
}

export async function disconnectGoogle() {
  await unlinkGoogle();
  setMe(await getMe());
}
