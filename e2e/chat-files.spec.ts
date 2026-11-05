import zlib from 'node:zlib';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDesktop, userApi, type Client } from './auth';
import { separatorsOnScreen } from './copy-rule';
import { expectHeading, goHash, shot } from './helpers';
import { ask, chat, idle } from './mcp';

// 파일 (slice 07 · ADR-0015): 입력창 + 버튼 · 끌어다 놓기 → 칩 (전달 배지 = 이 모델에 어떻게 가는지 · 예상 토큰) → 모델을 바꾸면 배지가 바뀐다
// → 보내면 내 말풍선에 칩 · mock 게이트웨이가 받은 모양을 답으로 ('받은 첨부: 원본 이미지 n개, 원본 문서 n개, 파일 …')
// → 스페이스 '파일' 메뉴 (카드 · 어디에 붙었나 · 지우기) → 프로젝트 파일.
// 모델: fake-chat-small = 이미지 O · PDF 원본 X (글로) · fake-chat-large = 이미지 O · PDF 원본 O (e2e/mock/gateway.mjs)
const HOME_H1 = '무엇을 맡길까요?';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
// 아주 넓은 PNG (3000×8 · 한 색) = 올릴 때 긴 쪽 2,048px 로 줄어드는지
function widePng(w: number, h: number): Buffer {
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 200)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const MD = Buffer.from('# 회의 메모\n\n- 금요일 배포\n- 담당: 민수\n');

function pdf(pages: string[]): Buffer {
  const objs: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 2 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`];
  const font = 3 + 2 * pages.length;
  pages.forEach((t, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${t}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + 2 * i} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, n) => {
    offsets.push(out.length);
    out += `${n + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const NAMES = new Set(['화면.png', '보고서.pdf', '회의.md', '메모2.txt', '넓은.png']);
const PROJECT = `파일 프로젝트 ${Date.now().toString(36)}`;
const chips = (win: Page) => win.locator('.composer .fc-list').getByRole('listitem');
const chip = (win: Page, name: string) => chips(win).filter({ hasText: name });

async function pickModel(win: Page, id: string) {
  await win.locator('.composer .mpick-btn').click();
  await win.getByRole('dialog', { name: '모델과 생각 깊이' }).locator(`[role="option"][data-model="${id}"]`).click();
  await win.keyboard.press('Escape');
}

test.describe.configure({ mode: 'serial' });
let api: Client;
let app: ElectronApplication;
let win: Page;
const made: string[] = [];
test.beforeAll(async () => {
  test.setTimeout(120_000);
  api = await userApi();
  ({ app, win } = await launchDesktop());
  await expectHeading(win, HOME_H1);
});
test.afterAll(async () => {
  await app?.close();
  const mine = await api.get<{ id: string; name: string }[]>('/api/files').catch(() => []); // 내 스페이스 (이 스펙이 올린 것만)
  for (const f of mine) if (NAMES.has(f.name)) made.push(f.id);
  for (const id of made) await api.del(`/api/files/${id}`).catch(() => {});
});

test('+ 버튼으로 이미지 · PDF · 글 → 칩 3개 (이름 · 종류 크기 · 썸네일만 · 보내는 방식 배지 · 토큰 수 없음)', async () => {
  await win.getByRole('button', { name: '새 대화' }).click();
  await pickModel(win, 'fake-chat-small');
  await expect(win.getByRole('button', { name: '파일 첨부' })).toBeEnabled();
  await win.locator('[data-testid="attach-input"]').setInputFiles([
    { name: '화면.png', mimeType: 'image/png', buffer: PNG },
    { name: '보고서.pdf', mimeType: 'application/pdf', buffer: pdf(['Quarterly report page one', 'Page two numbers']) },
    { name: '회의.md', mimeType: 'text/markdown', buffer: MD },
  ]);
  await expect(chips(win)).toHaveCount(3);
  await expect(chips(win).filter({ hasText: '올리는 중' })).toHaveCount(0, { timeout: 15_000 });
  await expect(chip(win, '보고서.pdf')).toContainText('PDF');
  await expect(win.locator('.composer .fc-mode')).toHaveCount(0); // 배지 없음
  await expect(win.locator('.composer .fc-wrap')).not.toContainText('토큰');
  await expect(win.locator('.composer .fc-warn')).toHaveCount(0); // 이 모델은 셋 다 본다
  await expect(chip(win, '화면.png').locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/); // 썸네일 = data: 주소만 (CSP)
  expect(await separatorsOnScreen(win)).toEqual([]);
  await win.screenshot({ path: shot('desktop-files-chips'), animations: 'disabled' });
});

test('PDF 를 못 받는 vision 모델 = PDF 쪽을 그림으로 그려 함께 보낸다 (글만 뽑지 않는다)', async () => {
  await ask(win, '[fake:files] 보고서 봐 줘');
  await idle(win);
  // 화면.png 1 + 보고서.pdf 2쪽 그림 = 원본 이미지 3개 · PDF 원본 0 · 글 블록 = 세 파일
  await expect(chat(win).last).toContainText('받은 첨부: 원본 이미지 3개, 원본 문서 0개, 파일 화면.png(image), 보고서.pdf(pdf), 회의.md(text)');
  await win.getByRole('button', { name: '새 대화' }).click();
  await win.locator('[data-testid="attach-input"]').setInputFiles([
    { name: '화면.png', mimeType: 'image/png', buffer: PNG },
    { name: '보고서.pdf', mimeType: 'application/pdf', buffer: pdf(['Quarterly report page one', 'Page two numbers']) },
    { name: '회의.md', mimeType: 'text/markdown', buffer: MD },
  ]);
  await expect(chips(win).filter({ hasText: '올리는 중' })).toHaveCount(0, { timeout: 15_000 });
  await expect(chips(win)).toHaveCount(3);
});

test('PDF 를 받는 모델 = PDF 그대로 · 보내면 내 말풍선에 첨부 칩 · 입력창 칩은 빈다', async () => {
  await pickModel(win, 'fake-chat-large');
  await ask(win, '[fake:files] 첨부 확인해 줘');
  await idle(win);
  const mine = chat(win).log.locator('.msg.user').last();
  await expect(mine.locator('.fc')).toHaveCount(3);
  await expect(mine.locator('.bubble')).toHaveText('[fake:files] 첨부 확인해 줘');
  await expect(chat(win).last).toContainText('받은 첨부: 원본 이미지 1개, 원본 문서 1개, 파일');
  await expect(chat(win).last).toContainText('회의.md(text)');
  await expect(chips(win)).toHaveCount(0);
  await win.screenshot({ path: shot('desktop-files-sent'), animations: 'disabled' });
});

test('다음 턴엔 원본을 다시 보내지 않는다 (이름 한 줄) · 끌어다 놓기로도 첨부된다', async () => {
  await ask(win, '[fake:files] 고마워');
  await idle(win);
  await expect(chat(win).last).not.toContainText('받은 첨부'); // 이번 턴 첨부 없음 = 원본 · 글 블록 없음
  // 끌어다 놓기: DataTransfer 로 drop
  const dt = await win.evaluateHandle((text) => {
    const d = new DataTransfer();
    d.items.add(new File([text], '메모2.txt', { type: 'text/plain' }));
    return d;
  }, '드래그한 메모');
  const box = win.locator('.composer .box');
  await box.dispatchEvent('dragenter', { dataTransfer: dt });
  await expect(win.locator('.composer .drop-hint')).toBeVisible();
  await win.screenshot({ path: shot('desktop-files-drop'), animations: 'disabled' });
  await box.dispatchEvent('drop', { dataTransfer: dt });
  await expect(chip(win, '메모2.txt')).toHaveCount(1);
  await expect(chip(win, '메모2.txt')).not.toContainText('올리는 중', { timeout: 15_000 });
  await chip(win, '메모2.txt').getByRole('button', { name: '메모2.txt 빼기' }).click();
  await expect(chips(win)).toHaveCount(0);
  // 큰 이미지 = 올리기 전에 긴 쪽 2,048px 로 (제공사 한도 밖 거절 막기 · Claude 는 한 변 8,000px 까지)
  await win.locator('[data-testid="attach-input"]').setInputFiles([{ name: '넓은.png', mimeType: 'image/png', buffer: widePng(3000, 8) }]);
  await expect(chip(win, '넓은.png')).not.toContainText('올리는 중', { timeout: 15_000 });
  const up = (await api.get<{ id: string; name: string }[]>('/api/files')).find((f) => f.name === '넓은.png')!;
  const png = Buffer.from(await (await api.raw('GET', `/api/files/${up.id}/content`)).arrayBuffer());
  expect(png.readUInt32BE(16)).toBe(2048);
  await chip(win, '넓은.png').getByRole('button', { name: '넓은.png 빼기' }).click();
});

test("스페이스 '파일' 메뉴: 카드 6장 (두 대화에 3장씩) · 어디에 붙었나 · 대화 칩 · 지우기 (확인)", async () => {
  await goHash(win, '#/files');
  await expectHeading(win, '파일');
  const list = win.getByRole('list', { name: '파일 목록' });
  await expect(list.getByRole('listitem')).toHaveCount(6);
  await expect(list.locator('li', { hasText: '보고서.pdf' }).first()).toContainText('PDF');
  await expect(list.locator('li', { hasText: '보고서.pdf' }).first().locator('.file-where')).toContainText('대화');
  await expect(win.getByRole('group', { name: '보기' }).getByRole('button', { name: /^대화/ })).toContainText('6');
  expect(await separatorsOnScreen(win)).toEqual([]);
  await win.screenshot({ path: shot('desktop-files-screen'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'dark' });
  await win.screenshot({ path: shot('desktop-files-screen-dark'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'light' });
  await list.locator('li', { hasText: '회의.md' }).first().getByRole('button', { name: '회의.md 지우기' }).click();
  const dialog = win.getByRole('dialog', { name: '이 파일을 지울까요?' });
  await dialog.getByRole('button', { name: '지우기' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(5);
});

test('프로젝트 파일: 프로젝트 화면에서 올리기 → 칩 · 목록 API = 프로젝트에 붙음', async () => {
  const spaces = await api.get<{ spaces: { id: string }[] }>('/api/spaces');
  const proj = await api.post<{ id: string }>(`/api/spaces/${spaces.spaces[0].id}/projects`, { name: PROJECT });
  const fresh = await launchDesktop(); // 새 창 = 사이드바가 새 프로젝트를 읽는다
  try {
    await expectHeading(fresh.win, HOME_H1);
    await fresh.win.getByRole('complementary', { name: '사이드바' }).getByRole('list', { name: '프로젝트' }).getByRole('button', { name: PROJECT, exact: true }).click();
    await expectHeading(fresh.win, PROJECT);
    await fresh.win.locator('[data-testid="project-file-input"]').setInputFiles([{ name: '사양.md', mimeType: 'text/markdown', buffer: Buffer.from('# 사양\n\n무게 1.2kg') }]);
    const files = fresh.win.getByRole('region', { name: '프로젝트 파일' });
    await expect(files.getByRole('listitem')).toHaveCount(1, { timeout: 15_000 });
    await expect(files).toContainText('사양.md');
    await fresh.win.screenshot({ path: shot('desktop-files-project'), animations: 'disabled' });
    const listed = await api.get<{ id: string; where: { kind: string } }[]>(`/api/files?project=${proj.id}`);
    expect(listed.map((f) => f.where.kind)).toEqual(['project']);
    made.push(...listed.map((f) => f.id));
  } finally {
    await fresh.app.close();
  }
});
