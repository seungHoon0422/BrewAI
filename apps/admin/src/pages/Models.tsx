import { useCallback, useEffect, useState } from 'react';
import { AdminApiError, API_URL, listAdminModels, type AdminModel, type LoadError } from '../api';
import { EmptyTable, Note } from '../ui';

// 모델을 등록하는 입력(가격 · 컨텍스트 · provider)은 만들지 않는다 (ADR-0006). 이 표는 읽기 전용.
// 칸 = 표시 이름 · 게이트웨이 ID · 상태 · 순서. 가격·컨텍스트는 게이트웨이 값이라 보여 줄 수는 있지만 slice 02 에선 안 둔다
// (LITELLM_LOCAL_MODEL_COST_MAP 스냅샷이라 틀릴 수 있음 · P2 gateway_model 캐시와 함께 '게이트웨이 값 · 읽기 전용' 으로).
const COLS = ['표시 이름', '게이트웨이 ID', '상태', '순서'] as const;

const ERROR_TEXT: Record<LoadError, string> = {
  conductor: `conductor 에 연결할 수 없어요 (${API_URL}) — npm run api`,
  gateway: '게이트웨이에 연결할 수 없어요 — npm run gateway',
  gateway_error: '게이트웨이가 오류를 냈어요 — 게이트웨이 로그 확인',
  gateway_auth: '게이트웨이 인증에 실패했어요 — .env 의 LITELLM_MASTER_KEY 확인',
  server: '모델 목록을 읽지 못했어요',
};

type State = { kind: 'loading' } | { kind: 'ok'; rows: AdminModel[] } | { kind: 'error'; error: LoadError };

export default function Models() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: 'loading' });
    listAdminModels(ctrl.signal).then(
      (rows) => setState({ kind: 'ok', rows }),
      (e) => {
        if ((e as Error).name !== 'AbortError') setState({ kind: 'error', error: e instanceof AdminApiError ? e.kind : 'server' });
      },
    );
    return () => ctrl.abort();
  }, [tick]);

  const rows = state.kind === 'ok' ? state.rows : [];
  const shown = rows.filter((r) => r.exposed);
  const count = (n: number) => (state.kind === 'ok' ? n : '—'); // 불러오는 중 · 오류면 숫자를 안 보인다
  return (
    <>
      <Note icon="lock">모델은 게이트웨이(LiteLLM)에서만 등록됩니다. 여기서는 노출 · 표시 이름 · 순서만 정합니다.</Note>
      <div className="legend">
        <span>상태</span>
        <span className="chip"><i className="dot on" />노출 {count(shown.length)}</span>
        <span className="chip"><i className="dot" />숨김 {count(rows.length - shown.length)}</span>
        <span className="chip"><i className="dot new" />후보 {count(0)}</span>
        <span>P1: 채팅 모델은 모두 노출 · 후보/숨김은 P2</span>
      </div>
      {state.kind === 'loading' && <EmptyTable label="모델 목록" cols={COLS} icon="plug">불러오는 중…</EmptyTable>}
      {state.kind === 'error' && (
        <EmptyTable label="모델 목록" cols={COLS} icon="plug">
          <span role="alert">{ERROR_TEXT[state.error]}</span>
          <button className="btn" type="button" onClick={reload}>다시 시도</button>
        </EmptyTable>
      )}
      {state.kind === 'ok' && rows.length === 0 && (
        <EmptyTable label="모델 목록" cols={COLS} icon="plug">
          게이트웨이에 모델이 없어요 — <code>infra/litellm/config.yaml</code> 의 <code>model_list</code>
        </EmptyTable>
      )}
      {state.kind === 'ok' && rows.length > 0 && (
        <div className="table">
          <table aria-label="모델 목록">
            <thead>
              <tr>{COLS.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{m.label}</td>
                  <td><code>{m.id}</code></td>
                  <td>
                    <span className="chip"><i className={m.exposed ? 'dot on' : 'dot'} />{m.exposed ? '노출' : '숨김'}</span>
                  </td>
                  <td>{m.exposed ? shown.indexOf(m) + 1 : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
