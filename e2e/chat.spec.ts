import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDesktop, userApi } from './auth';
import { API } from './env';
import { expectHeading, relay, shot, type Relay } from './helpers';

// 대화 관통 (slice 02 데모): 데스크톱 → conductor → mock 게이트웨이 → 글이 흘러 들어온다. 서버는 config.webServer 가 띄운다.
const HOME_H1 = '무엇을 맡길까요?';

async function launch(apiUrl = API) {
  const { app, win } = await launchDesktop({ apiUrl });
  await expectHeading(win, HOME_H1);
  return { app, win };
}

const ui = (win: Page) => ({
  box: win.getByRole('textbox', { name: '요청 입력' }),
  send: win.getByRole('button', { name: '보내기', exact: true }), // exact: 사이드바 최근(대화 제목)과 안 겹치게
  log: win.getByRole('log', { name: '대화 내용' }),
  model: win.locator('.composer .mpick-btn'),
});

async function ask(win: Page, text: string) {
  await ui(win).box.fill(text);
  await ui(win).send.click();
}

test.describe('conductor 켜짐', () => {
  test.describe.configure({ mode: 'serial' }); // 창 하나를 이어 쓴다 (앞 테스트의 대화가 뒤 테스트의 전제)
  let app: ElectronApplication;
  let win: Page;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    ({ app, win } = await launch());
  });
  test.afterAll(async () => app?.close());

  test('모델 버튼 = /api/models 첫 항목', async () => {
    await expect(ui(win).model).toHaveText('fake-chat-small');
  });

  test('보내면 대화 화면 → 내 말풍선 → 답이 조각으로 흘러 들어온다', async () => {
    // 답 칸의 글 길이가 몇 번 바뀌었는지 센다 (한 번에 붙으면 1 → 스트리밍 아님)
    await win.evaluate(() => {
      const seen = new Set<number>();
      (window as any).__lengths = seen;
      new MutationObserver(() => {
        const a = [...document.querySelectorAll('.msg.agent')].pop();
        if (a?.textContent) seen.add(a.textContent.length);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await ask(win, 'E2E 안녕');
    await expectHeading(win, 'E2E 안녕'); // 대화 제목 = 첫 질문
    const { log, box } = ui(win);
    await expect(log.locator('.msg.user')).toHaveText(['E2E 안녕']);
    const answer = log.locator('.msg.agent').last();
    await expect(answer).toContainText('받은 질문: E2E 안녕', { timeout: 15_000 }); // mock 의 결정적 답 = 질문이 끝까지 갔다 옴
    await expect(answer).toHaveAttribute('aria-busy', 'false');
    expect(await win.evaluate(() => (window as any).__lengths.size)).toBeGreaterThan(2);
    await expect(box).toHaveAttribute('placeholder', '이어서 요청하거나 질문하세요');
    await expect(box).toBeFocused();
    await win.screenshot({ path: shot('desktop-chat-thread') });
  });

  test('이어서 물으면 대화가 쌓인다', async () => {
    await ask(win, '두 번째');
    const { log } = ui(win);
    await expect(log.locator('.msg.user')).toHaveText(['E2E 안녕', '두 번째']);
    // 멀티턴: conductor 가 저장한 앞 대화를 모델에 준다 → mock 답 끝에 앞 질문
    await expect(log.locator('.msg.agent').last()).toContainText('받은 질문: 두 번째 · 이전 질문: E2E 안녕', { timeout: 15_000 });
  });

  test('게이트웨이 오류는 안내 + 다시 시도', async () => {
    await ask(win, '[fake:500] 실패해 줘');
    const alert = ui(win).log.getByRole('alert');
    // 500 = provider 서버 오류 (detail provider_unavailable) → '잠시 뒤 다시'
    await expect(alert).toContainText('모델 쪽 서버가 지금 응답하지 않아요', { timeout: 15_000 });
    await expect(alert).toContainText('잠시 뒤 다시 시도해 주세요');
    await expect(alert.getByRole('button', { name: '다시 시도' })).toBeVisible();
    await expect(ui(win).log.locator('.msg.user').last()).toHaveText('[fake:500] 실패해 줘'); // 질문은 남는다
  });

  test('모델 키 없음 = 무엇이 문제인지 + 고치는 곳 (LiteLLM 1.106.2: 401 authentication_error "Missing Anthropic API Key")', async () => {
    await ask(win, '[fake:401] 키 없음');
    const alert = ui(win).log.getByRole('alert');
    await expect(alert).toHaveAttribute('data-detail', 'provider_key_missing', { timeout: 15_000 });
    await expect(alert.locator('.ftxt')).toHaveText('이 모델의 API 키가 설정돼 있지 않아요');
    await expect(alert.locator('.fhint')).toContainText('LiteLLM 관리 화면 › Models › 이 모델의 Credential 키 확인');
    await expect(alert.locator('.fmodel')).toHaveText('fake-chat-small · fake-chat-small'); // 어느 모델인지
    await expect(alert).not.toContainText('Missing'); // provider 문구는 화면에 안 온다 (conductor 로그에만)
    await expect(alert.getByRole('button', { name: '생각 끄고 다시' })).toHaveCount(0); // 키 문제 = 생각과 무관
    await win.screenshot({ path: shot('desktop-error-hint'), animations: 'disabled' });
  });

  test('실패 종류마다 다른 안내 (키 틀림 · 게이트웨이 키 · 모델 이름 · 생각 설정)', async () => {
    const cases = [
      ['[fake:key-invalid]', 'provider_key_invalid', '이 모델의 API 키가 틀렸거나 권한이 없어요', 'Credential 키 확인'],
      ['[fake:gateway-key]', 'gateway_key_invalid', '게이트웨이 키가 맞지 않아요', 'LLM_GATEWAY_KEY'],
      ['[fake:model-404]', 'provider_model_not_found', '모델 이름이 provider 에 없어요', 'LiteLLM 모델 이름 확인'],
      ['[fake:reasoning-400]', 'reasoning_unsupported', '이 모델이 생각 깊이 설정을 받지 않아요', '생각 깊이를 끄기로 바꾸고 다시'],
    ] as const;
    for (const [mark, detail, text, hint] of cases) {
      await ask(win, `${mark} 실패 종류`);
      const alert = ui(win).log.getByRole('alert');
      await expect(alert).toHaveAttribute('data-detail', detail, { timeout: 15_000 });
      await expect(alert.locator('.ftxt')).toHaveText(text);
      await expect(alert.locator('.fhint')).toContainText(hint);
      await expect(ui(win).log.locator('p.msg.note').last()).not.toHaveText(''); // 앞 실패는 한 줄로 남는다
    }
    // 진행 상황 목록엔 짧은 이유
    const runs = await (await userApi()).get<{ error_code: string | null }[]>('/api/runs');
    expect(runs.slice(0, 4).map((r) => r.error_code)).toEqual(['provider_rejected', 'provider_rejected', 'gateway_auth_failed', 'provider_auth_failed']);
  });

  test('답이 중간에 끊기면 받은 글은 남고 안내가 뜬다', async () => {
    await ask(win, '[fake:cut] 끊어 줘');
    const alert = ui(win).log.getByRole('alert');
    // 게이트웨이 → conductor 사이가 끊김 = conductor 가 RUN_ERROR gateway_unreachable 로 마무리 ('답이 중간에 끊겼어요' 는 conductor 쪽 끊김)
    await expect(alert).toContainText('모델에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요', { timeout: 15_000 });
    const partial = ui(win).log.locator('.msg.agent:not(.fail)').last();
    await expect(partial).toHaveText(/^안녕하세요!/); // mock 은 두 조각 뒤 끊는다 (끝 조각은 소켓과 함께 버려질 수 있다)
    await expect(partial).not.toContainText('받은 질문');
    await expect(alert.getByRole('button', { name: '다시 시도' })).toBeVisible();
  });

  test('새 대화 = 홈으로 비운다', async () => {
    await win.getByRole('button', { name: '새 대화' }).click();
    await expectHeading(win, HOME_H1);
    await expect(ui(win).log).toHaveCount(0);
    await expect(ui(win).box).toHaveValue('');
    await expect(ui(win).box).toBeFocused();
  });
});

test.describe('conductor 꺼짐', () => {
  test.describe.configure({ mode: 'serial' });
  let app: ElectronApplication;
  let win: Page;
  let link: Relay;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    // 로그인은 해 둔 채로 conductor 만 사라지게: 데스크톱은 중계 주소로 붙고, 중계를 닫으면 '연결 거부' (진짜 꺼짐과 같다)
    link = await relay(API);
    ({ app, win } = await launch(link.url));
    await expect(ui(win).model).toContainText('fake-chat-small'); // 모델 목록까지 받은 뒤에 끊는다 (앞 테스트의 실패 점이 붙어 있을 수 있다)
    await link.close();
  });
  test.afterAll(async () => {
    await app?.close();
    await link?.close();
  });

  test('보내면 "서버에 연결할 수 없어요" + 다시 시도 (말풍선은 그대로)', async () => {
    await expect(ui(win).model).toContainText('fake-chat-small'); // 꺼지기 전에 받은 목록은 그대로
    await ask(win, '아무도 없나요');
    const alert = ui(win).log.getByRole('alert');
    await expect(alert).toContainText('서버에 연결할 수 없어요');
    await alert.getByRole('button', { name: '다시 시도' }).click();
    await expect(alert).toContainText('서버에 연결할 수 없어요');
    await expect(ui(win).log.locator('.msg.user')).toHaveText(['아무도 없나요']); // 다시 시도가 말풍선을 늘리지 않는다
    await win.screenshot({ path: shot('desktop-chat-offline') });
  });
});
