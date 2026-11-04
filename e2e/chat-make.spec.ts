import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDesktop, userApi, type Client } from './auth';
import { separatorsOnScreen } from './copy-rule';
import { expectHeading, shot } from './helpers';
import { ask, chat, chatRecords, idle, openTrace } from './mcp';

// 문서 만들기 (slice 08): 문서 스킬(use_skill {need}) → 그때만 make_file 이 도구에 → 답 아래 '만든 파일' 칩 → 저장 (E2E = 대화상자 없이 임시 폴더)
// mock 표시: [fake:skill <이름>] → use_skill · [fake:make docx|xlsx|pptx] → make_file {견본} (e2e/mock/gateway.mjs SAMPLE_FILES)
const HOME_H1 = '무엇을 맡길까요?';
const SAVE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'brewai-save-'));
const viewer = (win: Page) => win.getByRole('complementary', { name: '파일 보기' });
const made = (win: Page) => chat(win).last.getByRole('list', { name: '만든 파일' }).getByRole('listitem');

// 문서 스크롤 (0 이어야 앱 틀이 제자리) · 가로로 넘쳤는지
const shifted = (win: Page) => win.evaluate(() => ({
  x: document.scrollingElement!.scrollLeft, y: document.scrollingElement!.scrollTop, wide: document.documentElement.scrollWidth > window.innerWidth,
}));

test.describe.configure({ mode: 'serial' });
let api: Client;
let app: ElectronApplication;
let win: Page;
const ids: string[] = [];
test.beforeAll(async () => {
  test.setTimeout(120_000);
  process.env.BREWAI_E2E_SAVE_DIR = SAVE_DIR; // launchDesktop 이 process.env 를 넘긴다 (main = 배포본 아닐 때만 받음)
  api = await userApi();
  ({ app, win } = await launchDesktop());
  delete process.env.BREWAI_E2E_SAVE_DIR;
  await expectHeading(win, HOME_H1);
});
test.afterAll(async () => {
  await app?.close();
  for (const id of ids) await api.del(`/api/files/${id}`).catch(() => {});
  fs.rmSync(SAVE_DIR, { recursive: true, force: true });
});

test('Word: 스킬 부르기 전엔 make_file 없음 → 스킬 뒤에 생김 → 답 아래 칩 → 저장', async () => {
  const before = chatRecords().length;
  await win.getByRole('button', { name: '새 대화' }).click();
  await ask(win, '회의록 워드로 만들어 줘 [fake:skill word-doc] [fake:make docx]');
  await idle(win);
  const last = chat(win).last;
  await expect(last).toContainText('파일을 만들었어요: 회의록.docx');
  // 게이트웨이 요청: 첫 요청 = make_file 정의 없음 · 스킬 결과 뒤 = 있음
  const sent = chatRecords().slice(before).map((r) => (r.body?.tools ?? []).map((t: { function?: { name?: string } }) => t.function?.name));
  expect(sent[0]).not.toContain('make_file');
  expect(sent.at(-1)).toContain('make_file');
  // 답 아래 칩 = 이름 · 종류 크기 · 저장
  const chip = made(win).filter({ hasText: '회의록.docx' });
  await expect(made(win)).toHaveCount(1);
  await expect(chip.locator('.fc-meta')).toHaveText(/^Word \d+(KB|B)$/);
  // 상태 줄 패널의 도구 카드 = '파일 만들기' · 파일 이름 · '만들었어요'
  const panel = await openTrace(win);
  const card = panel.locator('[data-tool="make_file"]');
  await expect(card.locator('b')).toHaveText('파일 만들기');
  await expect(card.locator('[data-row="파일"] dd')).toHaveText('회의록.docx');
  await expect(card.locator('[data-row="결과"] dd')).toContainText('만들었어요');
  await win.screenshot({ path: shot('desktop-make-docx'), animations: 'disabled' });
  // 저장 → 임시 폴더에 같은 바이트 (서버 파일 = 이 대화 파일)
  await chip.getByRole('button', { name: '회의록.docx 저장' }).click();
  await expect(chip.getByRole('status')).toContainText('저장했어요');
  const saved = path.join(SAVE_DIR, '회의록.docx');
  await expect.poll(() => fs.existsSync(saved)).toBe(true);
  const mine = await api.get<{ id: string; name: string; size: number; where: { kind: string } }[]>('/api/files');
  const f = mine.find((x) => x.name === '회의록.docx')!;
  ids.push(f.id);
  expect(f.where.kind).toBe('thread');
  expect(fs.statSync(saved).size).toBe(f.size);
  expect(fs.readFileSync(saved).subarray(0, 2).toString()).toBe('PK'); // zip (docx)
  // 내 말풍선엔 첨부 칩이 없다 (만든 파일은 답 쪽)
  await expect(win.locator('.msg.user .fc-list')).toHaveCount(0);
  expect(await separatorsOnScreen(win)).toEqual([]);
});

test('Excel · PowerPoint 도 같은 길 · 다시 열어도 칩이 남는다', async () => {
  await ask(win, '예산표 엑셀로 [fake:skill excel-sheet] [fake:make xlsx]');
  await idle(win);
  await expect(made(win).filter({ hasText: '예산표.xlsx' }).locator('.fc-meta')).toHaveText(/^Excel /);
  await ask(win, '발표 자료 피피티로 [fake:skill ppt-deck] [fake:make pptx]');
  await idle(win);
  await expect(made(win).filter({ hasText: '발표.pptx' }).locator('.fc-meta')).toHaveText(/^PowerPoint /);
  await win.screenshot({ path: shot('desktop-make-pptx'), animations: 'disabled' });
  for (const f of await api.get<{ id: string; name: string }[]>('/api/files')) if (['예산표.xlsx', '발표.pptx'].includes(f.name)) ids.push(f.id);
  // 다른 대화로 갔다가 최근 목록에서 다시 열기 = 기록에서 다시 그린 답에도 칩
  await win.getByRole('button', { name: '새 대화' }).click();
  await expectHeading(win, HOME_H1);
  await win.getByRole('list', { name: '최근' }).getByRole('button', { name: /^회의록 워드로/ }).first().click();
  await expect(win.locator('.msg.agent').getByRole('list', { name: '만든 파일' }).getByRole('listitem')).toHaveCount(3, { timeout: 15_000 });
});

test('PDF: 칩을 누르면 가운데 뷰어 (대화 | 뷰어) · 쪽 그림 · 크게 / 작게 / 폭 맞춤 · 저장 · 닫기 · 대화는 그대로', async () => {
  await ask(win, '이 내용 pdf로 만들어 줘 [fake:skill pdf-doc] [fake:make pdf]');
  await idle(win);
  const chip = made(win).filter({ hasText: '요약 보고서.pdf' });
  await expect(chip.locator('.fc-meta')).toHaveText(/^PDF \d+KB$/);
  await chip.getByRole('button', { name: '요약 보고서.pdf 열기' }).click();
  const v = viewer(win);
  await expect(v).toBeVisible();
  await expect(v.locator('.fv-name b')).toHaveText('요약 보고서.pdf');
  await expect(win.getByRole('dialog')).toHaveCount(0); // 덮는 서랍이 아니다
  const pages = v.getByRole('list', { name: '2쪽' }).locator('img');
  await expect(pages).toHaveCount(2, { timeout: 15_000 });
  await expect(pages.first()).toHaveAttribute('src', /^data:image\/png;base64,/);
  // 대화 | 뷰어 = 나란히 (뷰어가 대화 오른쪽) · 입력창은 그대로 쓸 수 있다
  const conv = await win.locator('.conv').boundingBox();
  const vb = await v.boundingBox();
  expect(vb!.x).toBeGreaterThanOrEqual(conv!.x + conv!.width - 1);
  await expect(chat(win).box).toBeEditable();
  await expect.poll(() => shifted(win)).toEqual({ x: 0, y: 0, wide: false }); // 문서 전체가 밀리지 않는다 (세 칸 최소 폭 합 > 화면 · 2026-11-04)
  // 확대: 크게 = 110% · 쪽 폭이 넓어진다 · 폭 맞춤 = 100%
  const w0 = (await pages.first().boundingBox())!.width;
  await v.getByRole('button', { name: '크게' }).click();
  await expect(v.locator('.fv-pct')).toHaveText('110%');
  await expect.poll(async () => (await pages.first().boundingBox())!.width).toBeGreaterThan(w0 + 5);
  await v.getByRole('button', { name: '작게' }).click();
  await v.getByRole('button', { name: '작게' }).click();
  await expect(v.locator('.fv-pct')).toHaveText('90%');
  await v.getByRole('button', { name: '폭 맞춤' }).click();
  await expect(v.locator('.fv-pct')).toHaveText('100%');
  await win.screenshot({ path: shot('desktop-make-pdf-preview'), animations: 'disabled' });
  // 저장 = 뷰어 머리에서
  await v.getByRole('button', { name: '요약 보고서.pdf 저장' }).click();
  await expect(v.getByRole('status').filter({ hasText: '저장했어요' })).toBeVisible();
  const saved = path.join(SAVE_DIR, '요약 보고서.pdf');
  await expect.poll(() => fs.existsSync(saved)).toBe(true);
  expect(fs.readFileSync(saved).subarray(0, 5).toString()).toBe('%PDF-');
  await v.getByRole('button', { name: '파일 보기 닫기' }).click();
  await expect(v).toHaveCount(0);
  for (const f of await api.get<{ id: string; name: string }[]>('/api/files')) if (f.name === '요약 보고서.pdf') ids.push(f.id);
});

test('Word 칩 = 뷰어에 뽑은 글 · 오른쪽 패널 파일 탭 = 만든 파일 목록 → 누르면 뷰어', async () => {
  // 회의록은 첫 답 (made = 마지막 답만 보므로 대화 전체에서)
  await win.locator('.msg.agent').getByRole('list', { name: '만든 파일' }).getByRole('listitem').filter({ hasText: '회의록.docx' }).first()
    .getByRole('button', { name: '회의록.docx 열기' }).click();
  const v = viewer(win);
  await expect(v.locator('.fv-text')).toContainText('금요일 배포');
  // 머리의 파일 토글 → 오른쪽 패널 '파일' 탭 (팀이 없어도)
  await win.getByRole('button', { name: '파일 열고 닫기' }).click();
  const side = win.getByRole('complementary', { name: '오른쪽 패널' });
  await expect(side).toBeVisible();
  await expect(side.getByRole('tab', { name: '파일' })).toHaveAttribute('aria-selected', 'true');
  const mine = side.getByRole('region', { name: '만든 파일' }).getByRole('listitem');
  await expect(mine.filter({ hasText: '요약 보고서.pdf' })).toHaveCount(1);
  await expect(mine.filter({ hasText: '발표.pptx' })).toHaveCount(1);
  // 세 칸: 대화 | 뷰어 | 오른쪽 패널 (패널이 먼저 줄어 세 칸이 된다) · 문서가 밀리지 않는다
  const [vb, sb] = [await v.boundingBox(), await side.boundingBox()];
  expect(sb!.x).toBeGreaterThanOrEqual(vb!.x + vb!.width - 1);
  await expect(v).not.toHaveAttribute('data-overlay', /.*/);
  await expect.poll(() => shifted(win)).toEqual({ x: 0, y: 0, wide: false });
  await mine.filter({ hasText: '발표.pptx' }).getByRole('button').first().click();
  await expect(v.locator('.fv-name b')).toHaveText('발표.pptx');
  await expect(v.locator('.fv-text')).toContainText('1부 성과');
  await win.screenshot({ path: shot('desktop-viewer-panel'), animations: 'disabled' });
  await v.getByRole('button', { name: '파일 보기 닫기' }).click();
});

test('오른쪽 패널 폭 = 왼쪽 끝을 끌면 바뀌고 · 키보드 ← → · 다시 열어도 그 폭', async () => {
  const side = win.getByRole('complementary', { name: '오른쪽 패널' });
  await expect(side).toBeVisible();
  const sep = side.getByRole('separator', { name: '오른쪽 패널 폭' });
  const before = Number(await sep.getAttribute('aria-valuenow'));
  const box = (await sep.boundingBox())!;
  await win.mouse.move(box.x + box.width / 2, box.y + 200);
  await win.mouse.down();
  await win.mouse.move(box.x - 80, box.y + 200, { steps: 6 });
  await win.mouse.up();
  // 폭 = 마우스 위치를 따른다 (손잡이 안 어디를 잡았는지만큼 몇 px 차이)
  const target = Math.min(560, before + 80);
  await expect.poll(async () => Math.abs(Number(await sep.getAttribute('aria-valuenow')) - target)).toBeLessThanOrEqual(8);
  const dragged = Number(await sep.getAttribute('aria-valuenow'));
  await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBe(dragged);
  await sep.focus();
  await win.keyboard.press('ArrowRight');
  const after = Number(await sep.getAttribute('aria-valuenow'));
  expect(after).toBe(dragged - 16);
  // 다시 그리기 (새로 고침 → 최근 대화) = 같은 폭 (이 기기에 기억)
  await win.reload();
  await expectHeading(win, HOME_H1);
  await win.getByRole('list', { name: '최근' }).getByRole('button', { name: /^회의록 워드로/ }).first().click();
  const again = win.getByRole('complementary', { name: '오른쪽 패널' });
  await expect(again).toBeVisible();
  await expect(again.getByRole('separator', { name: '오른쪽 패널 폭' })).toHaveAttribute('aria-valuenow', String(after));
});

test('지워진 파일을 저장하면 "지워진 파일이에요"', async () => {
  const xlsx = (await api.get<{ id: string; name: string }[]>('/api/files')).find((f) => f.name === '예산표.xlsx')!;
  await api.del(`/api/files/${xlsx.id}`);
  const chip = win.locator('.msg.agent').getByRole('list', { name: '만든 파일' }).getByRole('listitem').filter({ hasText: '예산표.xlsx' });
  await chip.getByRole('button', { name: '예산표.xlsx 저장' }).click();
  await expect(chip.getByRole('status')).toHaveText('지워진 파일이에요');
});
