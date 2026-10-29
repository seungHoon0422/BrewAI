import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { API } from './env';
import { expectHeading, shot } from './helpers';

// 대화 관통 (slice 02 데모): 데스크톱 → conductor → mock 게이트웨이 → 글이 흘러 들어온다. 서버는 config.webServer 가 띄운다.
const APP = path.join(__dirname, '..', 'apps', 'desktop');
const HOME_H1 = '무엇을 맡길까요?';

async function launch(apiUrl: string) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'brewai-e2e-'));
  const app = await electron.launch({ args: [APP], env: { ...process.env, BREWAI_API_URL: apiUrl, BREWAI_USER_DATA: userData } });
  const win = await app.firstWindow();
  await expectHeading(win, HOME_H1);
  return { app, win };
}

const ui = (win: Page) => ({
  box: win.getByRole('textbox', { name: '요청 입력' }),
  send: win.getByRole('button', { name: '보내기', exact: true }), // exact: 사이드바 최근(대화 제목)과 안 겹치게
  log: win.getByRole('log', { name: '대화 내용' }),
  model: win.locator('.composer .model'),
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
    ({ app, win } = await launch(API));
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
    await expect(alert).toContainText('답을 받지 못했어요', { timeout: 15_000 });
    await expect(alert.getByRole('button', { name: '다시 시도' })).toBeVisible();
    await expect(ui(win).log.locator('.msg.user').last()).toHaveText('[fake:500] 실패해 줘'); // 질문은 남는다
  });

  test('모델 키 문제는 "관리자에게 알려 주세요" (잠시 뒤 다시가 아니라)', async () => {
    await ask(win, '[fake:401] 키 없음');
    const alert = ui(win).log.getByRole('alert');
    await expect(alert).toContainText('이 모델을 지금 쓸 수 없어요. 관리자에게 알려 주세요', { timeout: 15_000 });
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
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    // 아무도 안 듣는 포트 (잠깐 열었다 닫는다). CSP·onBeforeRequest 는 이 주소를 허용 → 진짜 '연결 거부' 를 본다
    const port = await new Promise<number>((resolve) => {
      const s = net.createServer().listen(0, '127.0.0.1', () => {
        const p = (s.address() as net.AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    ({ app, win } = await launch(`http://127.0.0.1:${port}`));
  });
  test.afterAll(async () => app?.close());

  test('보내면 "서버에 연결할 수 없어요" + 다시 시도 (말풍선은 그대로)', async () => {
    await expect(ui(win).model).toHaveText('기본 모델');
    await ask(win, '아무도 없나요');
    const alert = ui(win).log.getByRole('alert');
    await expect(alert).toContainText('서버에 연결할 수 없어요');
    await alert.getByRole('button', { name: '다시 시도' }).click();
    await expect(alert).toContainText('서버에 연결할 수 없어요');
    await expect(ui(win).log.locator('.msg.user')).toHaveText(['아무도 없나요']); // 다시 시도가 말풍선을 늘리지 않는다
    await win.screenshot({ path: shot('desktop-chat-offline') });
  });
});
