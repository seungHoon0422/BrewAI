// 스킬 — 에이전트가 찾거나 만든 Skill. 새 Skill 은 격리 테스트 → 내 승인 뒤에만 쓴다 (conductor 코어 ③).
import { Icon } from '../icons';
import { Empty, Page, Section } from './Page';

const STEPS = [
  { title: '찾기·만들기', text: '카탈로그에서 찾거나 에이전트가 새로 작성' },
  { title: '격리 테스트', text: '격리된 곳에서만 실행해 확인' },
  { title: '내 승인', text: '내가 허용해야 쓰기 시작', gate: true },
  { title: '사용', text: '필요할 때 대화에서 불러 씀' },
];

export function Skills() {
  return (
    <Page id="skills" sub="에이전트가 찾아 설치하거나 직접 만든 Skill이 모여요." soon>
      <Section title="내 Skill" extra={<span className="count">0</span>}>
        <Empty
          icon="layers"
          title="아직 Skill이 없어요"
          text="대화 중에 필요한 능력이 없으면 에이전트가 카탈로그에서 찾거나 새로 만들어요."
          needs="대화 연결 · Skill 저장소"
        />
      </Section>
      <Section title="새 Skill이 쓰이기까지">
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className={s.gate ? 'gate' : undefined}>
              <span className="num">{i + 1}</span>
              <b>{s.title}</b>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
        <ul className="notes">
          <li><Icon name="check" small />승인 전에는 격리된 곳에서만 실행돼요. 내 파일이나 계정에는 닿지 않아요.</li>
        </ul>
      </Section>
    </Page>
  );
}
