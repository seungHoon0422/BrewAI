// 입력창의 모델 버튼 + 유리 팝오버 (최소한): 회사 아이콘 + 모델 이름 한 줄씩 (관리자 순서) → 생각 깊이.
// 게이트웨이 id · 기능 · 컨텍스트 · 최근 사용 · 자세히 칸은 보이지 않는다. 모델이 많을 때만 검색칸. 동작 = picker.ts.
// 최근 연결에 실패한 모델 = 경고 점 (고를 수는 있다 · 이유는 툴팁 · 화면 읽기 이름).
import { Button, Icon, Input, ProviderIcon, Skeleton, Spinner, StatusDot, Toast, providerLabel } from '@brewai/ui';
import { buttonTip, PICKER, reasoningLabel } from '../copy';
import { effectiveReasoning, loadModels, useDupCheck, useModelState } from '../hooks';
import { useModelPicker } from '../picker';
import { ModelRow } from './ModelRow';
import { ReasoningDepth } from './ReasoningDepth';

export function ModelPicker() {
  const p = useModelPicker();
  const pref = useModelState((s) => s.reasoning);
  const reasoning = useModelState(effectiveReasoning);
  const dup = useDupCheck();
  const { models, current, query } = p;
  const label = current?.label ?? PICKER.fallback;
  const failing = current?.health === 'error';
  const tip = current
    ? buttonTip(current, providerLabel(current.provider, current.provider_label))
    : models.status === 'error' ? (models.error === 'offline' ? PICKER.offline : PICKER.loadFailed) : PICKER.allowed;
  const activeId = p.active ? p.ids.opt(p.active.id) : undefined;

  return (
    <span className="mpick" ref={p.refs.wrap} onBlur={p.onBlur}>
      {p.notice && <span className="mnotice" role="status"><Toast tone="info" title={p.notice} /></span>}
      <button ref={p.refs.button} className="mpick-btn" type="button" aria-haspopup="dialog" aria-expanded={p.open}
        aria-controls={p.open ? p.ids.pop : undefined} title={tip} onClick={p.toggle} onKeyDown={p.onButtonKey}>
        <ProviderIcon provider={current?.provider ?? 'other'} size="sm" dim={!current} />
        <span className="nm">{label}</span>
        {failing && <><StatusDot state="warn" size="sm" className="wdot" /><span className="ui-sr">{PICKER.failingSr}</span></>}
        {reasoning !== 'off' && <span className="eff">{reasoningLabel(reasoning)}</span>}
        <Icon name="chevron-down" size="sm" />
      </button>
      {p.open && (
        <div className="mpick-menu ui-glass" id={p.ids.pop} role="dialog" aria-label={PICKER.dialog}>
          {p.searchable && (
            <Input ref={p.refs.input} className="msearch" icon="search" type="search" role="combobox" aria-label={PICKER.search}
              placeholder={PICKER.searchPlaceholder} aria-expanded="true" aria-controls={p.ids.list} aria-autocomplete="list"
              aria-activedescendant={activeId}
              value={query} onChange={(e) => p.setQuery(e.target.value)} onKeyDown={p.onListKey} spellCheck={false} autoComplete="off"
              end={p.refreshing && models.list.length > 0 && <span className="mrefresh" title={PICKER.refreshing}><Spinner size="xs" /></span>} />
          )}
          <div ref={p.refs.list} className="mlist ui-scroll" role="listbox" id={p.ids.list} aria-label={PICKER.list}
            tabIndex={p.searchable ? -1 : 0} aria-activedescendant={p.searchable ? undefined : activeId}
            onKeyDown={p.searchable ? undefined : p.onListKey}>
            {models.status === 'loading' && models.list.length === 0 && (
              <div className="mstate" role="presentation">
                {[0, 1, 2].map((i) => <Skeleton key={i} />)}
                <span>{PICKER.loading}</span>
              </div>
            )}
            {models.status === 'error' && models.list.length === 0 && (
              <div className="mstate" role="presentation">
                <span>{models.error === 'offline' ? PICKER.offline : PICKER.loadFailed}</span>
                <Button size="sm" icon="refresh" onClick={() => void loadModels()}>{PICKER.retry}</Button>
              </div>
            )}
            {models.status === 'ready' && models.list.length === 0 && <p className="mstate" role="presentation">{PICKER.none}</p>}
            {models.list.length > 0 && p.shown.length === 0 && (
              <p className="mstate" role="presentation">
                {PICKER.noMatch(query.trim())}
                <Button variant="ghost" size="sm" onClick={p.clearSearch}>{PICKER.clearSearch}</Button>
              </p>
            )}
            {p.shown.map((m) => (
              <ModelRow key={m.id} id={p.ids.opt(m.id)} m={m} q={p.q} dup={dup(m)} selected={m.id === current?.id}
                active={m.id === p.active?.id} onPick={p.pick} onHover={() => p.hover(m.id)} />
            ))}
          </div>
          {models.list.length > 0 && <ReasoningDepth canThink={current?.supports_reasoning ?? false} pref={pref} hasModel={!!current} />}
        </div>
      )}
    </span>
  );
}
