import { useEffect, useId, useState } from 'react';
import { Button, Dialog, Field, Input } from '@brewai/ui';
import { COMMON_COPY } from '../../../shared/copy';
import { ORGS_COPY as C } from '../copy';

// 조직 만들기 = 이름 (+ 짧은 주소). 만든 관리자가 소유자
export function CreateOrgDialog({ open, busy, title, onCreate, onClose }: {
  open: boolean;
  busy: boolean;
  title: string;
  onCreate: (name: string, slug: string | undefined) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  useEffect(() => {
    if (open) {
      setName('');
      setSlug('');
    }
  }, [open]);
  const ok = name.trim().length > 0;
  const formId = useId();
  return (
    <Dialog open={open} onClose={onClose} title={title} description={C.createDesc} size="sm" dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{COMMON_COPY.cancel}</Button>
          <Button type="submit" form={formId} variant="primary" loading={busy} disabled={!ok}>{C.createBtn}</Button>
        </>
      }>
      <form id={formId} className="part-stack" onSubmit={(e) => {
        e.preventDefault();
        if (ok) onCreate(name.trim(), slug.trim() || undefined);
      }}>
        <Field label={C.nameField} hint={C.nameHint} required>
          <Input value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={C.slugField} hint={C.slugHint}>
          <Input value={slug} maxLength={40} pattern="[a-z0-9-]*" onChange={(e) => setSlug(e.target.value.toLowerCase())} />
        </Field>
      </form>
    </Dialog>
  );
}
