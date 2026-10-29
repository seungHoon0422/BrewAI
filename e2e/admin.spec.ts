import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { expectHeading, expectMenu, expectScreen, goHash, openMenu, overflowX, shot, type MenuItem } from './helpers';

// 관리자 콘솔 = 사용자 앱과 따로 도는 SPA. 빌드본을 vite preview(4174)로 띄운다 (config webServer)
const NAV = '관리 메뉴';
const MENU: MenuItem[] = [
  { id: 'overview', label: '개요' },
  { id: 'models', label: '모델' },
  { id: 'catalog', label: '카탈로그' },
  { id: 'approvals', label: '승인 기록' },
  { id: 'traces', label: '트레이스' },
  { id: 'users', label: '사용자·예산' },
  { id: 'docs', label: '문서' },
  { id: 'settings', label: '설정' },
];
const item = (id: string) => MENU.find((m) => m.id === id)!;
const OVERVIEW = item('overview');
const MODELS = item('models');
const DOCS = item('docs');
const SETTINGS = item('settings');

// 모델 원본은 게이트웨이(LiteLLM). 관리자는 노출·표시 이름·순서만 정한다 (ADR-0006)
const GATEWAY_ONLY = /price|가격|단가|context|컨텍스트|provider|제공자|제공사|endpoint|엔드포인트/i;
const REGISTER = /모델 (추가|등록)|add model/i;

test('첫 화면은 개요, 탭 제목은 BrewAI 관리자', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('BrewAI 관리자');
  await expectScreen(page, NAV, OVERVIEW);
});

test('관리 메뉴가 계약 순서대로 있다', async ({ page }) => {
  await page.goto('/');
  await expectMenu(page, NAV, MENU);
});

test('메뉴를 누르면 그 화면이 뜬다', async ({ page }) => {
  await page.goto('/');
  for (const item of MENU) {
    await openMenu(page, NAV, item);
    await page.screenshot({ path: shot(`admin-${item.id}`), fullPage: true });
  }
});

test('빈 주소·모르는 주소·사용자 앱 주소는 개요로 간다', async ({ page }) => {
  await page.goto('/');
  for (const hash of ['', '#/', '#/nope', '#/chat']) {
    await goHash(page, '#/settings');
    await expectScreen(page, NAV, SETTINGS);
    await goHash(page, hash);
    await expectScreen(page, NAV, OVERVIEW);
  }
});

test('모델 화면에 가격·컨텍스트·provider 입력칸이 없다', async ({ page }) => {
  await page.goto('/#/models');
  await expectScreen(page, NAV, MODELS);
  for (const role of ['textbox', 'searchbox', 'spinbutton', 'combobox', 'slider'] as const) {
    await expect(page.getByRole(role, { name: GATEWAY_ONLY })).toHaveCount(0);
  }
  await expect(page.getByPlaceholder(GATEWAY_ONLY)).toHaveCount(0);
  // 모델을 직접 등록하는 버튼·링크도 없다
  await expect(page.getByRole('button', { name: REGISTER }).or(page.getByRole('link', { name: REGISTER }))).toHaveCount(0);
});

test.describe('폰 폭 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('어느 화면도 가로로 넘치지 않는다', async ({ page }) => {
    for (const item of MENU) {
      await page.goto(`/#/${item.id}`);
      await expectHeading(page, item.label);
      await expect.poll(() => overflowX(page), { message: item.label }).toBeLessThanOrEqual(0);
    }
    await page.goto('/');
    await expectHeading(page, OVERVIEW.label);
    await page.screenshot({ path: shot('admin-phone'), fullPage: true });
  });
});

// ---------- 문서 = 레포 파일을 읽은 화면. 기대값도 스펙이 같은 파일을 직접 읽어 만든다 (하드코딩이면 실패) ----------
const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const plain = (md: string) => md.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();
const DOC_TABS = [
  { id: 'progress', label: '진행 현황' },
  { id: 'architecture', label: '아키텍처' },
  { id: 'stack', label: '구성' },
  { id: 'adr', label: '결정 기록' },
  { id: 'report', label: '보고서' },
] as const;

// HANDOFF.md 표의 한 칸 ('| 활성 브랜치 | … |')
function handoffCell(key: string) {
  const row = read('HANDOFF.md').split('\n').find((l) => l.startsWith(`| ${key} |`));
  if (!row) throw new Error(`HANDOFF.md 에 '${key}' 칸이 없다`);
  return plain(row.split('|').slice(2, -1).join('|'));
}

const tab = (page: Page, label: string) => page.getByRole('tablist', { name: '문서 종류' }).getByRole('tab', { name: label, exact: true });
const panel = (page: Page) => page.getByRole('tabpanel');

async function openDocs(page: Page, hash: string, label: string) {
  await page.goto(`/${hash}`);
  await expectScreen(page, NAV, DOCS); // 문서 h1 하나 · 문서 링크에 aria-current
  await expect(tab(page, label)).toHaveAttribute('aria-selected', 'true');
}

test.describe('문서', () => {
  test('진행 현황: roadmap 의 모든 phase 와 HANDOFF 활성 브랜치', async ({ page }) => {
    await openDocs(page, '#/docs', '진행 현황');
    const roadmap = JSON.parse(read('docs/roadmap.json')) as { phases: { id: string; name: string }[] };
    const phases = panel(page).locator('.timeline > li');
    await expect(phases).toHaveCount(roadmap.phases.length);
    for (const [i, p] of roadmap.phases.entries()) {
      await expect(phases.nth(i)).toContainText(p.id);
      await expect(phases.nth(i)).toContainText(p.name);
    }
    await expect(page.getByRole('region', { name: '지금' })).toContainText(handoffCell('활성 브랜치'));
    await page.screenshot({ path: shot('admin-docs-progress'), fullPage: true });
  });

  test('결정 기록: docs/adr 개수만큼 · #/docs/adr/0007 은 ADR-0007', async ({ page }) => {
    const files = fs.readdirSync(path.join(ROOT, 'docs/adr')).filter((f) => f.endsWith('.md'));
    await openDocs(page, '#/docs/adr', '결정 기록');
    const list = page.getByRole('navigation', { name: '결정 기록 목록' }).getByRole('link');
    await expect(list).toHaveCount(files.length);

    const f7 = files.find((f) => f.startsWith('0007'))!;
    const title = read(`docs/adr/${f7}`).split('\n')[0].replace(/^#\s+ADR-0007\s*·\s*/, '').trim();
    await openDocs(page, '#/docs/adr/0007', '결정 기록');
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`^0007`) })).toHaveAttribute('aria-current', 'true');
    await page.screenshot({ path: shot('admin-docs-adr'), fullPage: true });
  });

  test('구성: .nvmrc 의 Node · apps/desktop 의 electron 버전', async ({ page }) => {
    await openDocs(page, '#/docs/stack', '구성');
    const node = read('.nvmrc').trim();
    const electron = (JSON.parse(read('apps/desktop/package.json')) as { devDependencies: Record<string, string> }).devDependencies.electron;
    await expect(page.getByRole('table', { name: '런타임' }).getByRole('row', { name: /^Node / }).first()).toContainText(node);
    const row = page.getByRole('table', { name: 'npm 패키지' }).getByRole('row').filter({ has: page.getByRole('cell', { name: 'electron', exact: true }) });
    await expect(row).toContainText(electron);
    await page.screenshot({ path: shot('admin-docs-stack'), fullPage: true });
  });

  test('아키텍처: 칸 상태 = 레포에 그 경로가 있는지', async ({ page }) => {
    await openDocs(page, '#/docs/architecture', '아키텍처');
    const chip = (p: string) => page.locator(`[data-path="${p}"] > h3 > .st`);
    await expect(chip('apps/desktop/package.json')).toHaveText('있음');
    const paths = await page.locator('[data-path]').evaluateAll((els) => els.map((e) => e.getAttribute('data-path')!));
    expect(paths).toContain('services/conductor');
    for (const p of paths) {
      if (fs.existsSync(path.join(ROOT, p))) await expect(chip(p), p).toHaveText('있음');
      else await expect(chip(p), p).toHaveText(/^예정 · P\d/);
    }
    await page.screenshot({ path: shot('admin-docs-architecture'), fullPage: true });
  });

  test('보고서: REPORT.html 이 sandbox iframe 안에 · 콘솔을 못 움직인다', async ({ page }) => {
    await openDocs(page, '#/docs/report', '보고서');
    const h1 = plain(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(read('REPORT.html'))![1].replace(/<[^>]+>/g, ''));
    const frame = page.frameLocator('iframe.report-frame');
    await expect(frame.locator('h1').first()).toHaveText(h1);
    const sandbox = (await page.locator('iframe.report-frame').getAttribute('sandbox')) ?? '';
    for (const no of ['allow-scripts', 'allow-same-origin', 'allow-top-navigation']) expect(sandbox).not.toContain(no);
    await expect(frame.locator('a[href^="http"]:not([target="_blank"])')).toHaveCount(0);
    // 보고서 안 목차(#…)는 iframe 안에서만 움직인다
    const toc = frame.locator('a[href^="#"]').first();
    if ((await toc.count()) > 0) {
      await toc.click();
      await expect(page).toHaveURL(/#\/docs\/report$/);
      await expectScreen(page, NAV, DOCS);
    }
    await page.screenshot({ path: shot('admin-docs-report'), fullPage: true });
  });

  test('탭: → 키 · 주소로 바로 열기 · 뒤로 가기', async ({ page }) => {
    await openDocs(page, '#/docs', '진행 현황');
    await tab(page, '진행 현황').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, '아키텍처')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, '아키텍처')).toBeFocused();
    await expect(page).toHaveURL(/#\/docs\/architecture$/);
    await expect(panel(page)).toHaveAttribute('aria-labelledby', 'docs-tab-architecture');

    await tab(page, '구성').click();
    await expect(page).toHaveURL(/#\/docs\/stack$/);
    await expect(tab(page, '구성')).toHaveAttribute('aria-selected', 'true');
    await page.goBack();
    await expect(page).toHaveURL(/#\/docs\/architecture$/);
    await expect(tab(page, '아키텍처')).toHaveAttribute('aria-selected', 'true');
    await page.goForward();
    await expect(tab(page, '구성')).toHaveAttribute('aria-selected', 'true');

    // 어느 문서 주소로 열어도 메뉴는 문서, h1 은 하나
    for (const t of DOC_TABS) await openDocs(page, `#/docs/${t.id}`, t.label);
    await openDocs(page, '#/docs/nope', '진행 현황');
  });

  test.describe('폰 폭 390px', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('문서 탭 어느 것도 가로로 넘치지 않는다', async ({ page }) => {
      for (const t of DOC_TABS) {
        await openDocs(page, `#/docs/${t.id}`, t.label);
        if (t.id === 'report') await expect(page.locator('iframe.report-frame')).toBeVisible();
        await expect.poll(() => overflowX(page), { message: t.label }).toBeLessThanOrEqual(0);
        await page.screenshot({ path: shot(`admin-docs-${t.id}-phone`), fullPage: true });
      }
    });
  });
});
