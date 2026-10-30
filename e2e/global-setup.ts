import { createPool, userApi } from './auth';
import { API, OIDC } from './env';

// webServer 가 다 뜬 뒤에 돈다 (1.64.1). 세 가지를 한 번 확인 → 잘못 붙은 서버로 E2E 를 돌리는 사고를 막는다 (reuseExistingServer:false 와 이중)
//   1) 첫 관리자가 만들어졌다 (needs_bootstrap=false) · Google = 가짜 OIDC 로 켜짐
//   2) 로그인한 conductor 가 mock 게이트웨이를 보고 있다
//   3) 가짜 OIDC 의 계정이 기본값 (앞 실행이 바꾼 값이 남지 않게)
// 그리고 테스트 사용자(auth.ts POOL)를 초대 코드로 가입시켜 둔다
export default async function globalSetup() {
  const state = (await (await fetch(`${API}/api/auth/state`)).json()) as { needs_bootstrap: boolean; providers: { google: boolean } };
  if (state.needs_bootstrap || !state.providers.google) {
    throw new Error(`conductor 가 E2E 설정으로 안 떴어요 (첫 관리자 · Google): ${JSON.stringify(state)}`);
  }
  const api = await userApi();
  const ids = (await api.get<{ id: string }[]>('/api/models')).map((m) => m.id);
  if (!ids.includes('fake-chat-small')) {
    throw new Error(`conductor 가 mock 게이트웨이를 안 보고 있어요: ${JSON.stringify(ids)}`);
  }
  await fetch(`${OIDC}/__fake/account`, { method: 'POST', body: JSON.stringify({ reset: true }) });
  await createPool();
}
