import { Callout, KeyValue, Sheet } from '@brewai/ui';
import { Section } from '../../../shared/components/parts';
import { COMMON_COPY } from '../../../shared/copy';
import { dateText } from '../../../shared/format';
import { ScopePathText } from '../../scope/components/ScopePathText';
import { usePublishScopePath } from '../../scope/hooks';
import type { AdminSpace } from '../api';
import { SPACES_COPY as C, VISIBILITY_HINT, VISIBILITY_TEXT } from '../copy';

// 스페이스 서랍 (읽기 전용) = 위치 · 공개 범위 · 숫자. 바꾸기는 그 스페이스 관리자가 데스크톱 앱에서
export function SpaceSheet({ space: s, onClose }: { space: AdminSpace | null; onClose: () => void }) {
  usePublishScopePath(s?.path);
  return (
    <Sheet open={s !== null} onClose={onClose} title={s?.name ?? ''} description={s ? <ScopePathText path={s.path} /> : undefined}>
      {s && (
        <>
          {s.description && <Section title={C.description}><p className="part-hint">{s.description}</p></Section>}
          <Section title={C.partInfo}>
            <KeyValue variant="plain" items={[
              { key: 'where', label: C.kv.where, value: <ScopePathText path={s.path.slice(0, -1)} /> },
              { key: 'visibility', label: C.kv.visibility, value: VISIBILITY_TEXT[s.visibility], aside: VISIBILITY_HINT[s.visibility] },
              { key: 'members', label: C.kv.members, value: s.member_count },
              { key: 'projects', label: C.kv.projects, value: s.project_count },
              { key: 'created', label: C.kv.created, value: dateText(s.created_at) ?? COMMON_COPY.none },
              ...(s.archived_at ? [{ key: 'archived', label: C.kv.archived, value: dateText(s.archived_at) ?? COMMON_COPY.none }] : []),
            ]} />
          </Section>
          <Callout icon="info">{C.manage}</Callout>
          <Callout icon="lock">{C.privacy}</Callout>
        </>
      )}
    </Sheet>
  );
}
