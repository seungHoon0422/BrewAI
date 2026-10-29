import { API } from './env';

// webServer 가 다 뜬 뒤에 돈다 (1.64.1). conductor 가 mock 게이트웨이를 보고 있는지 한 번 확인 →
// 진짜 게이트웨이에 붙은 conductor 로 E2E 를 돌리는 사고를 막는다 (reuseExistingServer:false 와 이중).
export default async function globalSetup() {
  const res = await fetch(`${API}/api/models`);
  const ids = ((await res.json()) as { id: string }[]).map((m) => m.id);
  if (!ids.includes('fake-chat-small')) {
    throw new Error(`conductor 가 mock 게이트웨이를 안 보고 있어요: ${JSON.stringify(ids)}`);
  }
}
