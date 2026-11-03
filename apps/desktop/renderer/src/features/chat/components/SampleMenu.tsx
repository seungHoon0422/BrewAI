// 입력창의 '샘플' 단추 + 메뉴 (개발 빌드에서만 · lib/bridge.ts devBuild) — 기능 묶음마다 진짜 모델로 확인하는 질문. 고르면 홈 제안처럼 바로 보낸다.
// 앱 도구 묶음 = 지금 쓸 수 있는 내 앱(숨김 아님 · 연결됨 또는 인증 없음) 앞에서 몇 개. 메뉴 = @brewai/ui Menu (화살표 · Home · End · Esc).
import { Button, Menu, type MenuEntry } from '@brewai/ui';
import type { App } from '../../connections/api';
import { isReady, useConnections } from '../../connections/hooks';
import { APP_SAMPLE, SAMPLE, sampleGroups, type AppSampleKind, type Sample } from '../copy';

const MAX_APPS = 4;
// 이름 · 부르는 이름 · 도메인에 이 낱말이 있으면 맞춤 질문 (Context7 · OpenAI 문서 · Tavily)
const KNOWN: readonly [RegExp, AppSampleKind][] = [[/context7/, 'context7'], [/openai/, 'openai'], [/tavily/, 'tavily']];

function appSample(a: App): Sample {
  const key = `${a.handle} ${a.domain} ${a.name}`.toLowerCase();
  const kind = KNOWN.find(([re]) => re.test(key))?.[1] ?? (a.category === 'docs' || a.category === 'search' ? a.category : 'other');
  return APP_SAMPLE[kind](a.name);
}

export function SampleMenu({ onPick, disabled }: { onPick: (prompt: string) => void; disabled: boolean }) {
  const mine = useConnections((s) => s.apps.data?.mine); // 목록 그대로 (store 가 새 배열을 줄 때만 다시 그린다)
  const apps = (mine ?? []).filter((a) => !a.hidden && isReady(a)).slice(0, MAX_APPS);
  const groups = sampleGroups(apps.map(appSample), apps[0]?.name ?? null);
  // 메뉴 칸 id = 묶음 번호-줄 번호 → 질문
  const prompts = new Map<string, string>();
  const items: MenuEntry[] = groups.flatMap((g, gi): MenuEntry[] => [
    { kind: 'heading', label: g.title },
    ...(g.items.length === 0 && g.empty ? [{ id: `${gi}-none`, label: g.empty, disabled: true }] : []),
    ...g.items.map((s, i): MenuEntry => {
      const id = `${gi}-${i}`;
      prompts.set(id, s.prompt);
      return { id, label: s.label, hint: s.hint };
    }),
  ]);
  return (
    <Menu label={SAMPLE.menu} placement="top-start" width={340} items={items} className="samples"
      onSelect={(id) => {
        const prompt = prompts.get(id);
        if (prompt) onPick(prompt);
      }}
      trigger={(t) => (
        <Button {...t} variant="ghost" size="sm" icon="flask" title={SAMPLE.tip} disabled={disabled} className="sample-btn">
          {SAMPLE.button}
        </Button>
      )} />
  );
}
