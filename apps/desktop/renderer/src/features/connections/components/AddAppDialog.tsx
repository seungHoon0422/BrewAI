// [앱 추가] — 주소(https) · 이름 · 에이전트가 읽는 한 줄 설명(80자) · 찾을 때 쓸 말 · 공유(안 함 / 스페이스 / 조직)
// → [미리 확인] '로그인 방식 OAuth (linear.app), 도구 18개, 예상 토큰 약 600' + 에이전트가 보는 줄 → [추가].
// 미리 확인은 저장하지 않는다 (POST …/preview). 주소를 바꾸면 미리 확인을 다시 한다. 공유 판정은 서버 (만들기 전에 본다).
// 추천 서버 (위) = 누르면 주소 · 이름 · 설명을 채운다 (부르는 이름은 추가할 때 같이 보냄). 고른 상태 = 지금 주소와 같은 추천
import { useState, type FormEvent } from 'react';
import { Button, Callout, Dialog, Field, Input, Segmented, Select } from '@brewai/ui';
import { codeOf } from '../../../lib/api';
import { MEMBERSHIP, TENANT } from '../../scope/model';
import { addApp, previewApp, type App, type Preset, type Preview } from '../api';
import { ADD, PRESET, connError, previewParts } from '../copy';
import { bump, usePresets, useShareTargets } from '../hooks';
import { PresetPicker } from './PresetPicker';

const DESCRIPTION_MAX = 80;
type ShareMode = 'none' | 'space' | 'org';
type Draft = { url: string; name: string; description: string; aliases: string; share: ShareMode; target: string };
const EMPTY: Draft = { url: '', name: '', description: '', aliases: '', share: 'none', target: '' };
const KIND: Record<Exclude<ShareMode, 'none'>, string> = { space: MEMBERSHIP, org: TENANT };

export const splitAliases = (v: string) => [...new Set(v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, 20);

export function AddAppDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (a: App) => void }) {
  const [d, setD] = useState<Draft>(EMPTY);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'check' | 'add' | null>(null);
  const targets = useShareTargets();
  const presets = usePresets(open);
  const picked = presets.status === 'ready' ? presets.data.find((p) => p.url === d.url.trim() && p.available && !p.added) ?? null : null;
  const kind = d.share === 'none' ? null : KIND[d.share];
  const options = targets.filter((t) => t.kind === kind).map((t) => ({ value: t.id, label: t.name }));

  const put = (patch: Partial<Draft>) => {
    setD((x) => ({ ...x, ...patch }));
    if ('url' in patch) setPreview(null); // 주소가 바뀌면 다시 확인
    setError(null);
  };
  const pick = (p: Preset) => put({ url: p.url, name: p.name, description: [...p.description].slice(0, DESCRIPTION_MAX).join('') });
  const close = () => {
    setD(EMPTY);
    setPreview(null);
    setError(null);
    onClose();
  };
  const body = () => ({
    url: d.url.trim(),
    ...(d.name.trim() ? { name: d.name.trim() } : {}),
    ...(d.description.trim() ? { description: d.description.trim() } : {}),
    ...(picked ? { handle: picked.handle } : {}),
  });
  const check = async () => {
    if (!d.url.trim() || busy) return;
    setBusy('check');
    setError(null);
    try {
      setPreview(await previewApp(body()));
    } catch (e) {
      setError(connError(codeOf(e)));
    } finally {
      setBusy(null);
    }
  };
  const shareOk = d.share === 'none' || !!d.target;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!preview) return void check();
    if (busy || !shareOk) return;
    setBusy('add');
    setError(null);
    try {
      const a = await addApp({
        ...body(),
        aliases: splitAliases(d.aliases),
        ...(kind && d.target ? { share: { scope_kind: kind, scope_id: d.target } } : {}),
      });
      await bump();
      close();
      onAdded(a);
    } catch (err) {
      setError(connError(codeOf(err)));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onClose={close} title={ADD.title} description={ADD.sub} dismissible={!busy} className="app-add"
      footer={<>
        <Button variant="ghost" onClick={close} disabled={!!busy}>{ADD.cancel}</Button>
        {preview ? (
          <Button variant="primary" type="submit" form="app-add" loading={busy === 'add'} disabled={!shareOk}>{ADD.add}</Button>
        ) : (
          <Button variant="primary" type="submit" form="app-add" loading={busy === 'check'} disabled={!d.url.trim()}>{ADD.check}</Button>
        )}
      </>}>
      <form id="app-add" className="form" onSubmit={submit} noValidate>
        {error && <Callout tone="danger" live>{error}</Callout>}
        <PresetPicker load={presets} pickedId={picked?.id ?? null} onPick={pick} />
        {picked && (
          <p className="app-preset-picked" role="status">
            <span>{PRESET.picked(picked.name)}</span>
            {picked.note && <span className="app-preset-note">{picked.note}</span>}
          </p>
        )}
        <Field label={ADD.url} required hint={ADD.urlHint}>
          <Input type="url" inputMode="url" value={d.url} maxLength={2048} placeholder={ADD.urlPlaceholder} autoFocus spellCheck={false}
            onChange={(e) => put({ url: e.target.value })} />
        </Field>
        <Field label={ADD.name}>
          <Input value={d.name} maxLength={60} placeholder={ADD.namePlaceholder} onChange={(e) => put({ name: e.target.value })} />
        </Field>
        <Field label={ADD.description} hint={ADD.descriptionHint}
          aside={<span className="count ui-num">{ADD.count([...d.description].length, DESCRIPTION_MAX)}</span>}>
          <Input value={d.description} maxLength={DESCRIPTION_MAX} placeholder={ADD.descriptionPlaceholder} onChange={(e) => put({ description: e.target.value })} />
        </Field>
        <Field label={ADD.aliases} hint={ADD.aliasesHint}>
          <Input value={d.aliases} maxLength={400} placeholder={ADD.aliasesPlaceholder} onChange={(e) => setD((x) => ({ ...x, aliases: e.target.value }))} />
        </Field>
        <Field label={ADD.share} hint={d.share === 'none' ? undefined : options.length ? ADD.shareHint : ADD.noTargets}>
          <div className="app-share">
            <Segmented<ShareMode> label={ADD.share} size="sm" value={d.share}
              options={[{ value: 'none', label: ADD.shareNone }, { value: 'space', label: ADD.shareSpace }, { value: 'org', label: ADD.shareOrg }]}
              onChange={(share) => setD((x) => ({ ...x, share, target: '' }))} />
            {d.share !== 'none' && (
              <Select aria-label={ADD.shareTarget} size="sm" options={options} value={d.target} placeholder={ADD.shareTargetPlaceholder}
                disabled={!options.length} onChange={(target) => setD((x) => ({ ...x, target }))} className="app-share-target" />
            )}
          </div>
        </Field>
        {preview && (
          <section className="app-preview" aria-label={ADD.previewTitle} role="status">
            <b>{preview.name}</b>
            <p className="app-preview-meta">{previewParts(preview).join(', ')}</p>
            {preview.prompt_line && (
              <p className="app-line"><span>{ADD.agentLine}</span><code>{preview.prompt_line}</code></p>
            )}
          </section>
        )}
      </form>
    </Dialog>
  );
}
