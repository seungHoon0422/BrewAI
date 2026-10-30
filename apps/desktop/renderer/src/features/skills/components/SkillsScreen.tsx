// 스킬 — 에이전트가 대화 중에 불러 쓰는 일 처리 지침 (conductor runtime/skills). 지금은 내장 스타터만.
// 새 Skill 은 격리 테스트 → 내 승인 뒤에만 쓴다 (conductor 코어 ③ · P5).
import { Badge, Button, Icon } from '@brewai/ui';
import { Count, Empty, Notes, Page, Section } from '../../shell/components/Page';
import { LIFECYCLE_NOTES, SKILL_NOTES, SKILL_STEPS, SKILLS } from '../copy';
import { loadSkills, useSkillState } from '../hooks';

export function SkillsScreen() {
  const skills = useSkillState((s) => s.skills);
  const tools = useSkillState((s) => s.tools);
  const list = skills.list;
  return (
    <Page id="skills" sub={SKILLS.sub}>
      <Section title={SKILLS.mine} extra={<Count n={list.length} />}>
        {list.length > 0 ? (
          <ul className="rows skills" aria-label={SKILLS.list}>
            {list.map((k) => (
              <li key={k.name} className="row skill" data-skill={k.name}>
                <span className="ui-tile"><Icon name="layers" /></span>
                <span className="row-main">
                  <span className="sk-head">
                    <b>{k.label}</b>
                    {k.builtin && <Badge size="sm" className="badge">{SKILLS.builtin}</Badge>}
                    <code className="sk-name">{k.name}</code>
                  </span>
                  <span className="row-sub">{k.description}</span>
                  {k.tools.length > 0 && (
                    <span className="sk-tools" aria-label={SKILLS.usesTools}>
                      {k.tools.map((t) => <Badge key={t} variant="outline" className="chip">{tools[t] ?? t}</Badge>)}
                    </span>
                  )}
                </span>
                <span className="state used" title={SKILLS.usedTitle}>{SKILLS.used(k.used)}</span>
              </li>
            ))}
          </ul>
        ) : skills.status === 'loading' ? (
          <p className="needs">{SKILLS.loading}</p>
        ) : skills.status === 'error' ? (
          <Empty icon="layers" title={SKILLS.loadFailed} text={SKILLS.loadFailedText}
            action={<Button onClick={() => void loadSkills()}>{SKILLS.retry}</Button>} />
        ) : (
          <Empty icon="layers" title={SKILLS.empty} text={SKILLS.emptyText} needs={SKILLS.emptyNeeds} />
        )}
        <Notes items={SKILL_NOTES} />
      </Section>
      <Section title={SKILLS.lifecycle}>
        <ol className="steps">
          {SKILL_STEPS.map((s, i) => (
            <li key={s.title} className={s.gate ? 'gate' : undefined}>
              <span className="num ui-num">{i + 1}</span>
              <b>{s.title}</b>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
        <Notes items={LIFECYCLE_NOTES} />
      </Section>
    </Page>
  );
}
