// 입력창의 모델 버튼 + 유리 팝오버. 검색 → 최근 사용 → 회사별 묶음 → 생각 깊이 (동작 = picker.ts · 그리기만 여기).
// 같은 표시 이름이 둘이면 둘째 줄을 진하게 + 등록한 곳을 같이 (키 없는 쪽을 피할 수 있게) · 버튼도 이름 뒤에 id.
// 최근 연결에 실패한 모델 = 경고 점 + 이유 (고를 수는 있다).
import { useId, type ReactNode } from 'react';
import { Button, Icon, Input, ProviderIcon, Skeleton, Spinner, StatusDot, Toast, providerLabel } from '@brewai/ui';
import { buttonTip, PICKER, reasoningLabel } from '../copy';
import { effectiveReasoning, loadModels, useDupCheck, useModelState } from '../hooks';
import { useModelPicker } from '../picker';
import { ModelDetail } from './ModelDetail';
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

  return (
    <span className="mpick" ref={p.refs.wrap} onBlur={p.onBlur}>
      {p.notice && <span className="mnotice" role="status"><Toast tone="info" title={p.notice} /></span>}
      <button ref={p.refs.button} className="mpick-btn" type="button" aria-haspopup="dialog" aria-expanded={p.open}
        aria-controls={p.open ? p.ids.pop : undefined} title={tip} onClick={p.toggle} onKeyDown={p.onButtonKey}>
        <ProviderIcon provider={current?.provider ?? 'other'} size="sm" dim={!current} />
        <span className="nm">{label}</span>
        {current && dup(current) && <span className="mid" title={current.id}>{current.id}</span>}
        {failing && <><StatusDot state="warn" size="sm" className="wdot" /><span className="ui-sr">{PICKER.failingSr}</span></>}
        {reasoning !== 'off' && <span className="eff">· {reasoningLabel(reasoning)}</span>}
        <Icon name="chevron-down" size="sm" />
      </button>
      {p.open && (
        <div className="mpick-menu ui-glass" id={p.ids.pop} role="dialog" aria-label={PICKER.dialog} data-wide={p.wide}>
          <div className="mcol">
            <Input ref={p.refs.input} className="msearch" icon="search" type="search" role="combobox" aria-label={PICKER.search}
              placeholder={PICKER.searchPlaceholder} aria-expanded="true" aria-controls={p.ids.list} aria-autocomplete="list"
              aria-activedescendant={p.activeOpt ? p.ids.opt(p.activeOpt.key) : undefined}
              value={query} onChange={(e) => p.setQuery(e.target.value)} onKeyDown={p.onSearchKey} spellCheck={false} autoComplete="off"
              end={p.refreshing && models.list.length > 0 && <span className="mrefresh" title={PICKER.refreshing}><Spinner size="xs" /></span>} />
            <div className="mlist ui-scroll" role="listbox" id={p.ids.list} aria-label={PICKER.list} tabIndex={-1}>
              {models.status === 'loading' && models.list.length === 0 && (
                <div className="mstate" role="presentation">
                  {[0, 1, 2].map((i) => <Skeleton key={i} lines={2} />)}
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
              {p.recentOpts.length > 0 && (
                <Section label={PICKER.recent} heading="div">
                  {p.recentOpts.map((o) => (
                    <ModelRow key={o.key} id={p.ids.opt(o.key)} sec={o.sec} m={o.model} q={p.q} dup={dup(o.model)} selected={o.model.id === current?.id}
                      active={o.key === p.activeOpt?.key} onPick={p.pick} onHover={() => p.onRowHover(o.key)} onLeave={p.onRowLeave} />
                  ))}
                </Section>
              )}
              {p.groupOpts.map((g) => (
                <Section key={g.provider} label={g.label} provider={g.provider}>
                  {g.opts.map((o) => (
                    <ModelRow key={o.key} id={p.ids.opt(o.key)} sec={o.sec} m={o.model} q={p.q} dup={dup(o.model)} selected={o.model.id === current?.id}
                      active={o.key === p.activeOpt?.key} onPick={p.pick} onHover={() => p.onRowHover(o.key)} onLeave={p.onRowLeave} />
                  ))}
                </Section>
              ))}
            </div>
            {models.list.length > 0 && <ReasoningDepth canThink={current?.supports_reasoning ?? false} pref={pref} hasModel={!!current} />}
            <div className="mpick-foot">{PICKER.allowed}</div>
          </div>
          {p.wide && p.detail && <ModelDetail m={p.detail} dup={dup(p.detail)} />}
          {p.card && <ModelDetail m={p.card} dup={dup(p.card)} card />}
        </div>
      )}
    </span>
  );
}

// 묶음 머리 = h6 (회사 아이콘 + 이름) · '최근 사용' 은 div (e2e: h6 = 회사 묶음 + 생각 깊이)
function Section({ label, provider, heading = 'h6', children }: { label: string; provider?: string; heading?: 'h6' | 'div'; children: ReactNode }) {
  const id = useId();
  const H = heading;
  return (
    <div role="group" aria-labelledby={id} className="mgroup">
      <H id={id} className="mh">
        {provider && <ProviderIcon provider={provider} size="sm" />}
        {label}
      </H>
      {children}
    </div>
  );
}
