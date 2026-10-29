// 스킬 — 에이전트가 대화 중에 불러 쓰는 일 처리 지침 (conductor runtime/skills). 지금은 내장 스타터만.
// 새 Skill 은 격리 테스트 → 내 승인 뒤에만 쓴다 (conductor 코어 ③ · P5). 화면 글에 '관리자' 를 쓰지 않는다 (사용자 앱).
import { Icon } from '../icons';
import { loadSkills, useSession } from '../chat/session';
import { Empty, Page, Section } from './Page';

const STEPS = [
  { title: '찾기·만들기', text: '카탈로그에서 찾거나 에이전트가 새로 작성' },
  { title: '격리 테스트', text: '격리된 곳에서만 실행해 확인' },
  { title: '내 승인', text: '내가 허용해야 쓰기 시작', gate: true },
  { title: '사용', text: '필요할 때 대화에서 불러 씀' },
];

export function Skills() {
  const skills = useSession((s) => s.skills);
  const tools = useSession((s) => s.tools);
  const list = skills.list;
  return (
    <Page id="skills" sub="대화 중에 에이전트가 필요하면 스스로 불러 쓰는 일 처리 지침이에요.">
      <Section title="내 Skill" extra={<span className="count">{list.length}</span>}>
        {list.length > 0 ? (
          <ul className="rows skills" aria-label="스킬 목록">
            {list.map((k) => (
              <li key={k.name} className="row skill" data-skill={k.name}>
                <span className="tile"><Icon name="layers" /></span>
                <span className="row-main">
                  <span className="sk-head">
                    <b>{k.label}</b>
                    {k.builtin && <span className="chip badge">내장</span>}
                    <code className="sk-name">{k.name}</code>
                  </span>
                  <span className="row-sub">{k.description}</span>
                  {k.tools.length > 0 && (
                    <span className="sk-tools" aria-label="쓰는 도구">
                      {k.tools.map((t) => <span key={t} className="chip">{tools[t] ?? t}</span>)}
                    </span>
                  )}
                </span>
                <span className="state used" title="이 스킬을 쓴 답 수">{k.used > 0 ? `${k.used}번 사용` : '아직 안 씀'}</span>
              </li>
            ))}
          </ul>
        ) : skills.status === 'loading' ? (
          <p className="needs">불러오는 중…</p>
        ) : skills.status === 'error' ? (
          <Empty icon="layers" title="스킬 목록을 불러오지 못했어요" text="서버가 켜져 있는지 확인해 주세요."
            action={<button className="btn" type="button" onClick={() => void loadSkills()}>다시</button>} />
        ) : (
          <Empty icon="layers" title="아직 Skill이 없어요"
            text="대화 중에 필요한 능력이 없으면 에이전트가 카탈로그에서 찾거나 새로 만들어요." needs="Skill 저장소" />
        )}
        <ul className="notes">
          <li><Icon name="check" small />대화에서 "요약해 줘", "비교해 줘" 처럼 말하면 맞는 스킬을 골라 써요. 답 안에 <b>스킬 사용</b> 카드로 보여요.</li>
          <li><Icon name="check" small />새 스킬은 '스킬 만들기' 로 초안을 쓸 수 있어요. 저장·등록은 다음 단계에서 열려요.</li>
        </ul>
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
