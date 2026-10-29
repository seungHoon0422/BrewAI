// 연결된 앱 — 에이전트가 쓰는 내 앱 연결. 지금은 흔한 연결 예시를 '미연결' 로만 보여 준다.
import { Icon } from '../icons';
import { SAMPLE_APPS } from '../sample';
import { Ex, Page, Section } from './Page';

export function Connections() {
  return (
    <Page id="connections" sub="에이전트가 일할 때 쓰는 내 앱 연결이에요." soon>
      <Section title="연결할 수 있는 앱" extra={<Ex />}>
        <ul className="rows">
          {SAMPLE_APPS.map((a) => (
            <li key={a.id} className="row">
              <span className="tile"><Icon name={a.icon} /></span>
              <span className="row-main">
                <b>{a.name}</b>
                <span className="row-sub">{a.can}</span>
              </span>
              <span className="state">미연결</span>
              <button className="btn" type="button" disabled aria-label={`${a.name} 연결`} title="준비 중">연결</button>
            </li>
          ))}
        </ul>
        <p className="needs">필요 · 앱 로그인(OAuth) 연결</p>
        <ul className="notes">
          <li><Icon name="check" small />연결이 필요하면 대화 중에 먼저 물어봐요.</li>
          <li><Icon name="check" small />로그인은 각 서비스 공식 화면에서 해요. 비밀번호는 저희가 보지 않아요.</li>
          <li><Icon name="check" small />검수된 연결만 보이고, 언제든 여기서 끊을 수 있어요.</li>
        </ul>
      </Section>
    </Page>
  );
}
