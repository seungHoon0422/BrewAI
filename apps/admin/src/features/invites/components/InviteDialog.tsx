import { useId } from 'react';
import { Button, Callout, Checkbox, Dialog, Field, Input, Segmented, Select, Skeleton } from '@brewai/ui';
import { OneTimeCode } from '../../../shared/components/OneTimeCode';
import { COMMON_COPY } from '../../../shared/copy';
import { left } from '../../../shared/format';
import { ORG_ROLE_HINT, ORG_ROLE_TEXT } from '../../orgs/copy';
import { roleLabel } from '../../scope/model';
import type { InviteRole } from '../api';
import { DAY_OPTIONS, INVITES_COPY as C, USES_INVALID } from '../copy';
import { useInviteForm } from '../hooks';
import '../invites.css';

const ROLES: { value: InviteRole; label: string }[] = (['member', 'admin'] as const).map((value) => ({ value, label: ORG_ROLE_TEXT[value] }));
const DAYS = DAY_OPTIONS.map((d) => ({ value: String(d), label: C.days(d) }));

// 초대 코드 만들기 = 조직 · 조직 역할 · (이메일) · 바로 들어갈 공유 스페이스 · 사용 횟수 · 유효 기간 → 코드 한 번 보이기
// 열 때 붙이고 닫으면 뗀다 (InvitesTab) — 열 때마다 빈 서식 · 새 목록
export function InviteDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const f = useInviteForm(onCreated);
  const formId = useId();
  const { result } = f;

  if (result) {
    return (
      <Dialog open onClose={onClose} title={C.resultTitle} footer={<Button variant="primary" onClick={onClose}>{COMMON_COPY.close}</Button>}>
        <OneTimeCode code={result.code} label={C.resultLabel}>
          <p className="part-hint">
            {C.resultSummary(result.invite.org_name, ORG_ROLE_TEXT[result.invite.org_role], result.invite.max_uses, left(result.invite.expires_at) ?? '')}
          </p>
        </OneTimeCode>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title={C.create} description={C.createDesc} dismissible={!f.busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={f.busy}>{COMMON_COPY.cancel}</Button>
          <Button type="submit" form={formId} variant="primary" loading={f.busy} disabled={!f.org || !f.usesOk}>{C.createBtn}</Button>
        </>
      }>
      {!f.ready ? <Skeleton lines={4} /> : f.loadError ? <Callout live tone="danger">{f.loadError}</Callout> : (
        <form id={formId} className="part-stack" onSubmit={(e) => {
          e.preventDefault();
          void f.submit();
        }}>
          {f.error && <Callout live tone="danger">{f.error}</Callout>}
          {f.orgs.length > 1 && (
            <Field label={roleLabel('tenant')}>
              <Select options={f.orgs.map((o) => ({ value: o.id, label: o.name }))} value={f.org?.id ?? ''} onChange={(e) => f.pickOrg(e.target.value)} />
            </Field>
          )}
          <Field label={C.roleField} hint={ORG_ROLE_HINT[f.role]}>
            <Segmented label={C.roleField} options={ROLES} value={f.role} onChange={f.setRole} block />
          </Field>
          <Field label={C.emailField} hint={C.emailHint}>
            <Input type="email" value={f.email} placeholder={C.emailPlaceholder} autoComplete="off" onChange={(e) => f.setEmail(e.target.value)} />
          </Field>
          <fieldset className="invite-spaces">
            <legend>{C.spacesField}</legend>
            {!f.spacesReady ? <Skeleton lines={2} />
              : f.spaces.length === 0 ? <p className="part-hint">{C.spacesNone}</p>
              : f.spaces.map((s) => (
                <Checkbox key={s.id} label={s.name} description={s.description || undefined} checked={f.spaceIds.has(s.id)} onChange={() => f.toggleSpace(s.id)} />
              ))}
          </fieldset>
          <div className="part-row invite-limits">
            <Field label={C.usesField} hint={C.usesHint} error={f.usesOk ? undefined : USES_INVALID}>
              <Input type="number" inputMode="numeric" min={1} max={100} value={f.uses} onChange={(e) => f.setUses(e.target.value)} />
            </Field>
            <Field label={C.daysField}>
              <Select options={DAYS} value={f.days} onChange={(e) => f.setDays(e.target.value)} />
            </Field>
          </div>
        </form>
      )}
    </Dialog>
  );
}
