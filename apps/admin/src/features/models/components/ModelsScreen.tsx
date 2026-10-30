import { useEffect, useRef, type ComponentType } from 'react';
import { Callout, Tabs, type TabItem } from '@brewai/ui';
import { useHash } from '../../../app/hash';
import { restOf } from '../../../app/routes';
import { COPY, MODEL_TABS, type ModelTab } from '../copy';
import { useModels, useModelView } from '../hooks';
import '../models.css';
import { modelRoute, tabHref } from '../route';
import { ModelAddTab } from './ModelAddTab';
import { ModelListTab, type ModelPanelProps } from './ModelListTab';
import { ModelPage } from './ModelPage';
import { SyncBar } from './SyncBar';

// 모델 등록은 LiteLLM 에서만 (Admin UI · config.yaml). 여기서 정하는 것 = 노출 · 표시 이름 · 순서 · 기본 모델 (ADR-0006).
// 가격 · 컨텍스트 · 제공사(provider)는 게이트웨이 값이라 입력칸 없이 보여 주기만 한다 (e2e admin.spec 이 입력칸이 없는지 본다).
// 길 = route.ts 하나: '#/models' = 모델 목록 탭 · '#/models/add' = 모델 추가 탭 · '#/models/<id>' = 그 모델 자세히 페이지.
// 탭을 더하려면 copy.ts MODEL_TABS + 아래 PANELS 한 줄씩. 서버 데이터 · 거르개는 탭 밖(여기)에 둔다 → 탭 · 자세히를 오가도 그대로
const PANELS: Record<ModelTab, ComponentType<ModelPanelProps>> = { list: ModelListTab, add: ModelAddTab };

export default function ModelsScreen() {
  const api = useModels();
  const view = useModelView(api.rows);
  const route = modelRoute(restOf(useHash()));
  const ready = api.state.kind === 'ok';

  // 자세히 → 목록으로 돌아오면 그 줄의 이름 링크에 포커스 (틀이 h1 에 포커스를 준 다음 프레임)
  const back = useRef<string | null>(null);
  const key = route.kind === 'detail' ? `detail:${route.id}` : route.tab;
  useEffect(() => {
    if (route.kind === 'detail') {
      back.current = route.id;
      return;
    }
    const id = back.current;
    back.current = null;
    if (!id) return; // 목록 · 추가 탭 둘 다 (그 줄이 없으면 아무것도 안 한다)
    const f = requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-model="${CSS.escape(id)}"] .nbtn`)?.focus());
    return () => cancelAnimationFrame(f);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (route.kind === 'detail') return <ModelPage id={route.id} api={api} view={view} />;

  const tab = route.tab;
  const Panel = PANELS[tab];
  // 탭 옆 숫자 = 할 일 (모델 추가 = 확인할 후보)
  const count: Partial<Record<ModelTab, number>> = { add: ready && view.counts.candidate > 0 ? view.counts.candidate : undefined };
  const items: TabItem<ModelTab>[] = MODEL_TABS.map((t) => ({ ...t, count: count[t.id] }));
  const actions = tab === 'list' ? (
    <SyncBar gateway={api.gateway} now={api.now} syncing={api.syncing} loading={api.state.kind === 'loading'}
      canProbeAll={ready && view.counts.exposed > 0} probing={api.probingAll}
      onSync={() => void api.sync()} onProbeAll={() => void api.probeMany(api.rows.filter((r) => r.status === 'present' && r.exposed))} />
  ) : undefined;

  return (
    <Tabs label={COPY.tabs} items={items} value={tab} actions={actions} className="mtabs" onChange={(t) => window.location.assign(tabHref(t))}>
      {api.flash && (
        <Callout live tone={api.flash.kind === 'error' ? 'danger' : 'ok'} className="flash" onDismiss={api.dismissFlash} dismissLabel={COPY.dismiss}>
          {api.flash.text}
        </Callout>
      )}
      <Panel api={api} view={view} />
    </Tabs>
  );
}
