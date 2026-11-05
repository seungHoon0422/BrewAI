import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDesktop, poolUser, userApi, type Client, type Me, type NewUser } from './auth';
import { API } from './env';
import { expectHeading, goHash, shot } from './helpers';

// API 키 (slice 12 · ADR-0017): 설정 › API 키 → 만들기 → 키는 한 번만 보임 → 바깥 프로그램(여기선 node fetch)이 /v1 OpenAI 호환으로 부름
// → 사용량 'API 키' 탭에 한 줄 → 폐기 → 401. 게이트웨이 = mock (키 없음)
const NAME = `주간 스크립트 ${Date.now().toString(36)}`;
const v1 = (key: string, path: string, body?: unknown) =>
  fetch(`${API}/v1${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

test.describe.configure({ mode: 'serial' });
let user: NewUser;
let api: Client & { me: Me };
let app: ElectronApplication;
let win: Page;
let key = '';

test.beforeAll(async () => {
  test.setTimeout(120_000);
  user = await poolUser('alice');
  api = await userApi(user);
  ({ app, win } = await launchDesktop({ as: user }));
});
test.afterAll(async () => app?.close());

test('설정 › API 키: 한도 (조직 정책) · [새 키 만들기] → 키는 한 번만 · 복사 · 예시', async () => {
  await goHash(win, '#/settings/keys');
  await expectHeading(win, 'API 키');
  await expect(win.locator('.keys-limits')).toContainText('분당 60회');
  await win.getByRole('button', { name: '새 키 만들기' }).click();
  const form = win.getByRole('dialog', { name: '새 API 키' });
  await form.getByRole('textbox', { name: '이름' }).fill(NAME);
  await expect(form.getByRole('checkbox', { name: /대화 호출/ })).toBeChecked();
  await form.getByRole('button', { name: '만들기' }).click();
  const once = win.getByRole('dialog', { name: '키를 복사해 두세요' });
  key = (await once.getByTestId('new-key').textContent()) ?? '';
  expect(key).toMatch(/^bwk_[A-Za-z0-9_-]{43}$/);
  await expect(once.locator('.key-example')).toContainText(`${API}/v1/chat/completions`);
  await win.screenshot({ path: shot('desktop-keys-made') });
  await once.getByRole('button', { name: '다 했어요' }).click();
  // 목록 = hint 만 (전체 키는 어디에도 없다)
  const table = win.getByRole('table', { name: '내 키' });
  await expect(table).toContainText(NAME);
  await expect(table).toContainText(`bwk_${key.slice(4, 8)}…${key.slice(-4)}`);
  await expect(win.locator('body')).not.toContainText(key);
});

test('바깥 프로그램이 키로 /v1 을 부른다 (OpenAI 호환) → 사용량 API 키 탭', async () => {
  const models = (await (await v1(key, '/models')).json()) as { data: { id: string }[] };
  expect(models.data.map((m) => m.id)).toContain('fake-chat-small');
  const res = await v1(key, '/chat/completions', { model: 'fake-chat-small', messages: [{ role: 'user', content: '키로 묻기' }] });
  expect(res.status).toBe(200);
  const out = (await res.json()) as { choices: { message: { content: string } }[]; usage: { total_tokens: number } };
  expect(out.choices[0].message.content).toContain('키로 묻기');
  expect(out.usage.total_tokens).toBeGreaterThan(0);
  // 데스크톱 토큰 · 없는 키는 /v1 에서 거절
  expect((await v1('bwk_' + 'x'.repeat(43), '/models')).status).toBe(401);
  // 사용량 › 세부 보기 › API 키 = 이 키 한 줄
  await goHash(win, '#/settings/usage');
  await expectHeading(win, '사용량');
  await win.getByRole('tablist', { name: '세부 보기' }).getByRole('tab', { name: 'API 키' }).click();
  await expect(win.getByRole('table', { name: 'API 키별 사용량' })).toContainText(NAME);
  await win.screenshot({ path: shot('desktop-usage-keys'), fullPage: true });
});

test('폐기 → 바로 401 · 목록에 폐기', async () => {
  await goHash(win, '#/settings/keys');
  const table = win.getByRole('table', { name: '내 키' });
  await expect(table).toContainText('1회'); // 이번 달
  await table.getByRole('button', { name: `폐기 ${NAME}` }).click();
  await win.getByRole('dialog', { name: /폐기할까요/ }).getByRole('button', { name: '폐기' }).click();
  await expect(table.getByRole('row').filter({ hasText: NAME })).toContainText('폐기');
  const res = await v1(key, '/models');
  expect(res.status).toBe(401);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe('key_revoked');
  const mine = await api.get<{ keys: { name: string; status: string }[] }>('/api/me/keys');
  expect(mine.keys.find((k) => k.name === NAME)?.status).toBe('revoked');
});
