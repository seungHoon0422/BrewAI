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
const made = (win: Page) => chat(win).last.getByRole('list', { name: '만든 파일' }).getByRole('listitem');

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

test('PDF: 문서 스킬 → make_file pdf → 칩을 누르면 앱 안 미리보기 (쪽 그림) → 저장', async () => {
  await ask(win, '이 내용 pdf로 만들어 줘 [fake:skill pdf-doc] [fake:make pdf]');
  await idle(win);
  const chip = made(win).filter({ hasText: '요약 보고서.pdf' });
  await expect(chip.locator('.fc-meta')).toHaveText(/^PDF \d+KB$/);
  await chip.getByRole('button', { name: '요약 보고서.pdf 미리보기' }).click();
  const sheet = win.getByRole('dialog', { name: '요약 보고서.pdf' });
  await expect(sheet).toContainText('PDF 2쪽');
  const pages = sheet.getByRole('list', { name: '미리보기' }).locator('img');
  await expect(pages).toHaveCount(2, { timeout: 15_000 });
  await expect(pages.first()).toHaveAttribute('src', /^data:image\/png;base64,/);
  expect(await pages.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(500);
  await win.screenshot({ path: shot('desktop-make-pdf-preview'), animations: 'disabled' });
  await sheet.getByRole('button', { name: '요약 보고서.pdf 저장' }).click();
  await expect(sheet.getByRole('status')).toContainText('저장했어요');
  const saved = path.join(SAVE_DIR, '요약 보고서.pdf');
  await expect.poll(() => fs.existsSync(saved)).toBe(true);
  expect(fs.readFileSync(saved).subarray(0, 5).toString()).toBe('%PDF-');
  await win.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  for (const f of await api.get<{ id: string; name: string }[]>('/api/files')) if (f.name === '요약 보고서.pdf') ids.push(f.id);
});

test('지워진 파일을 저장하면 "지워진 파일이에요"', async () => {
  const xlsx = (await api.get<{ id: string; name: string }[]>('/api/files')).find((f) => f.name === '예산표.xlsx')!;
  await api.del(`/api/files/${xlsx.id}`);
  const chip = win.locator('.msg.agent').getByRole('list', { name: '만든 파일' }).getByRole('listitem').filter({ hasText: '예산표.xlsx' });
  await chip.getByRole('button', { name: '예산표.xlsx 저장' }).click();
  await expect(chip.getByRole('status')).toHaveText('지워진 파일이에요');
});
