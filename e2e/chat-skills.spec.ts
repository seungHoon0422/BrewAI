import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { API } from './env';
import { expectHeading, openMenu, shot } from './helpers';

// 스킬 (제품 스킬 = runtime/skills · conductor 가 읽는다): 스킬 메뉴 목록 → 대화에서 스킬 + 도구 카드 → 사용 횟수.
// mock 표시: [fake:skill <이름>] → use_skill · [fake:convert <값> <단위> <단위>] → unit_convert (적은 순서대로)
const APP = path.join(__dirname, '..', 'apps', 'desktop');
const NAV = '메뉴';
const SKILLS = { id: 'skills', label: '스킬' };
const CHAT = { id: 'chat', label: '대화', h1: '무엇을 맡길까요?' };
const STARTERS = ['비교표 만들기', '메일 답장 초안', '회의 준비', '스킬 만들기', '요약'];

test.describe.configure({ mode: 'serial' });
let app: ElectronApplication;
let win: Page;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'brewai-e2e-'));
  app = await electron.launch({ args: [APP], env: { ...process.env, BREWAI_API_URL: API, BREWAI_USER_DATA: userData } });
  win = await app.firstWindow();
  await expectHeading(win, CHAT.h1);
});
test.afterAll(async () => app?.close());

const skillList = (p: Page) => p.getByRole('list', { name: '스킬 목록' });
const skillRow = (p: Page, name: string) => skillList(p).locator(`li[data-skill="${name}"]`);
const usedOf = async (name: string) =>
  ((await (await fetch(`${API}/api/skills`)).json()) as { name: string; used: number }[]).find((s) => s.name === name)?.used ?? -1;

test('스킬 메뉴: 스타터 스킬 5개 (이름 · 설명 · 내장 · 쓰는 도구 · 사용 횟수)', async () => {
  await openMenu(win, NAV, SKILLS);
  await expect(skillList(win).locator('li')).toHaveCount(5);
  await expect(skillList(win).locator('li b')).toHaveText(STARTERS);
  await expect(win.locator('.sec-head .count').first()).toHaveText('5');
  const creator = skillRow(win, 'skill-creator');
  await expect(creator.locator('.badge')).toHaveText('내장');
  await expect(creator.locator('.sk-name')).toHaveText('skill-creator');
  await expect(creator.locator('.row-sub')).toContainText('SKILL.md');
  const compare = skillRow(win, 'compare-table');
  await expect(compare.locator('.sk-tools .chip')).toHaveText(['단위 변환', '계산기']); // 툴 이름 = /api/tools label
  await expect(win.getByText('아직 Skill이 없어요')).toHaveCount(0); // 빈 상태 대신 목록
  await expect(win.locator('.page-title .chip')).toHaveCount(0); // '준비 중' 딱지 없음
  await win.screenshot({ path: shot('desktop-skills-menu'), animations: 'disabled' });
});

test('대화: 스킬 사용 카드 → 단위 변환 카드 → 답 · 단계 = 스킬 · 비교표 만들기 → 단위 변환 → 답 쓰기', async () => {
  const before = await usedOf('compare-table');
  await openMenu(win, NAV, CHAT);
  await win.getByRole('textbox', { name: '요청 입력' }).fill('마라톤 거리 비교해 줘 [fake:skill compare-table] [fake:convert 42.195 km mi]');
  await win.getByRole('button', { name: '보내기', exact: true }).click();
  const answer = win.locator('.msg.agent:not(.fail)').last();
  const skill = answer.getByRole('group', { name: '스킬 사용' });
  await expect(skill).toBeVisible({ timeout: 15_000 });
  await expect(skill).toHaveAttribute('data-tool', 'use_skill');
  await expect(skill.locator('.th b')).toHaveText('스킬 사용');
  await expect(skill.locator('dl')).toContainText('스킬비교표 만들기');
  await expect(skill.locator('dl')).toContainText(/결과지침 불러옴 · \d+줄/, { timeout: 15_000 });
  await expect(skill.locator('dl')).not.toContainText('하지 않는 것'); // 지침 본문은 모델만 본다
  const conv = answer.getByRole('group', { name: '단위 변환 도구' });
  await expect(conv.locator('dl')).toContainText('변환42.195 km → mi');
  await expect(conv.locator('dl')).toContainText('결과42.195 km = 26.21875746 mi', { timeout: 15_000 });
  await expect(answer).toContainText("스킬 '비교표 만들기' 지침을 따랐어요. 변환 결과는 42.195 km = 26.21875746 mi예요.", { timeout: 15_000 });
  const status = win.locator('.msg.agent .act').last();
  await expect(status).toHaveAttribute('data-step', 'done');
  await expect(status).toContainText('도구 2번');
  await status.click(); // 진행 과정 펼치기
  await expect(win.getByRole('list', { name: '진행 과정' }).locator('li .nm')).toHaveText(['스킬 · 비교표 만들기', '단위 변환', '답 쓰기']);
  await win.screenshot({ path: shot('desktop-chat-skill-tool'), animations: 'disabled' });
  expect(await usedOf('compare-table')).toBe(before + 1);

  // 다시 열어도 (서버 기록) 같은 카드 — 지침 본문 없이
  const runs = (await (await fetch(`${API}/api/runs`)).json()) as { thread_id: string; steps: { name: string; label: string }[] }[];
  expect(runs[0].steps.map((s) => s.label)).toEqual(['스킬 · 비교표 만들기', '단위 변환', '답 쓰기']);
  const thread = (await (await fetch(`${API}/api/threads/${runs[0].thread_id}`)).json()) as { messages: { parts?: { name?: string; result?: Record<string, unknown> }[] }[] };
  const card = thread.messages[1].parts?.[0];
  expect(card?.name).toBe('use_skill');
  expect(card?.result).not.toHaveProperty('instructions');
});

test('스킬 메뉴의 사용 횟수가 올라간다', async () => {
  await openMenu(win, NAV, SKILLS);
  await expect(skillRow(win, 'compare-table').locator('.used')).toHaveText(/^\d+번 사용$/);
  await expect(skillRow(win, 'email-reply').locator('.used')).toHaveText(/^(아직 안 씀|\d+번 사용)$/);
});
