import type { ComponentType } from 'react';
import { Callout, Tabs, type TabItem } from '@brewai/ui';
import { useHash } from '../../../app/hash';
import { hrefOf, subOf } from '../../../app/routes';
import { COPY, MODEL_TABS, type ModelTab } from '../copy';
import { useModels, useModelView } from '../hooks';
import '../models.css';
import { ModelAddTab } from './ModelAddTab';
import { ModelListTab, type ModelPanelProps } from './ModelListTab';
import { ModelSheet } from './ModelSheet';
import { SyncBar } from './SyncBar';

// 모델 등록은 LiteLLM 에서만 (Admin UI · config.yaml). 여기서 정하는 것 = 노출 · 표시 이름 · 순서 · 기본 모델 (ADR-0006).
// 가격 · 컨텍스트 · 제공사(provider)는 게이트웨이 값이라 입력칸 없이 보여 주기만 한다 (e2e admin.spec 이 입력칸이 없는지 본다).
// 화면 = 탭 (해시 두 번째 칸: '#/models' = 모델 목록 · '#/models/add' = 모델 추가). 탭을 더하려면 copy.ts MODEL_TABS + 아래 PANELS 한 줄씩.
// 서버 데이터 · 거르개 · 서랍은 탭 밖(여기)에 둔다 → 탭을 옮겨도 그대로 · 어느 탭에서든 같은 서랍
const PANELS: Record<ModelTab, ComponentType<ModelPanelProps>> = { list: ModelListTab, add: ModelAddTab };
const FIRST = MODEL_TABS[0].id;

export default function ModelsScreen() {
  const api = useModels();
  const view = useModelView(api.rows);
  const sub = subOf(useHash());
  const tab = MODEL_TABS.find((t) => t.id !== FIRST && t.id === sub)?.id ?? FIRST;
  const Panel = PANELS[tab];
  const ready = api.state.kind === 'ok';
  const open = view.open;

  // 탭 옆 숫자 = 할 일 (모델 추가 = 확인할 후보)
  const count: Partial<Record<ModelTab, number>> = { add: ready && view.counts.candidate > 0 ? view.counts.candidate : undefined };
  const items: TabItem<ModelTab>[] = MODEL_TABS.map((t) => ({ ...t, count: count[t.id] }));
  const actions = tab === 'list' ? (
    <SyncBar gateway={api.gateway} now={api.now} syncing={api.syncing} loading={api.state.kind === 'loading'}
      canProbeAll={ready && view.counts.exposed > 0} probing={api.bulkBusy}
      onSync={() => void api.sync()} onProbeAll={() => void api.probeMany(api.rows.filter((r) => r.status === 'present' && r.exposed))} />
  ) : undefined;

  return (
    <>
      <Tabs label={COPY.tabs} items={items} value={tab} actions={actions} className="mtabs"
        onChange={(t) => window.location.assign(hrefOf('models', t === FIRST ? undefined : t))}>
        {api.flash && (
          <Callout live tone={api.flash.kind === 'error' ? 'danger' : 'ok'} className="flash" onDismiss={api.dismissFlash} dismissLabel={COPY.dismiss}>
            {api.flash.text}
          </Callout>
        )}
        <Panel api={api} view={view} />
      </Tabs>

      <ModelSheet m={open} rows={api.rows} dup={open ? view.dupOf(open) : null} busy={open ? api.isBusy(open.id) : false}
        gateway={api.gateway} now={api.now} onChange={api.change} onProbe={api.probe} onClose={() => view.setOpenId(null)} />
    </>
  );
}
