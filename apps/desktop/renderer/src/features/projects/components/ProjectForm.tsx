// 프로젝트 칸 셋 (이름 · 설명 · 지침) — 만들기 대화상자와 설정 서랍이 같이 쓴다. 값은 부르는 쪽이 쥔다
import { Field, Input, Textarea } from '@brewai/ui';
import { DESCRIPTION_MAX, INSTRUCTIONS_MAX, NAME_MAX, type ProjectInput } from '../api';
import { PROJECTS } from '../copy';

export function ProjectFields({ value, onChange, autoFocus }: { value: ProjectInput; onChange: (v: ProjectInput) => void; autoFocus?: boolean }) {
  const put = (k: keyof ProjectInput) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <>
      <Field label={PROJECTS.name} required>
        <Input value={value.name} maxLength={NAME_MAX} placeholder={PROJECTS.namePlaceholder} autoFocus={autoFocus} onChange={put('name')} />
      </Field>
      <Field label={PROJECTS.description}>
        <Input value={value.description} maxLength={DESCRIPTION_MAX} placeholder={PROJECTS.descriptionPlaceholder} onChange={put('description')} />
      </Field>
      <Field label={PROJECTS.instructions} hint={PROJECTS.instructionsHint}
        aside={<span className="count ui-num">{PROJECTS.count([...value.instructions].length, INSTRUCTIONS_MAX)}</span>}>
        <Textarea value={value.instructions} maxLength={INSTRUCTIONS_MAX} rows={6} placeholder={PROJECTS.instructionsPlaceholder}
          className="instructions" onChange={put('instructions')} />
      </Field>
    </>
  );
}

export const tidy = (v: ProjectInput): ProjectInput => ({ name: v.name.trim(), description: v.description.trim(), instructions: v.instructions.trim() });
