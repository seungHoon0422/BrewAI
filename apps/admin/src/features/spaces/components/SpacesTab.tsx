import { Badge, Callout, Input, Select, Switch, Table, Toolbar, ToolbarSpacer, type Column } from '@brewai/ui';
import { Count, ListEmpty, NameCell } from '../../../shared/components/parts';
import { ScopePathText } from '../../scope/components/ScopePathText';
import { roleIcon, roleLabel } from '../../scope/model';
import type { AdminSpace } from '../api';
import { SPACES_COPY as C, VISIBILITY_HINT, VISIBILITY_TEXT } from '../copy';
import { useSpaces, useSpaceView } from '../hooks';
import { SpaceSheet } from './SpaceSheet';

// 스페이스 탭 = 공유 스페이스 (조직별) · 공개 범위 · 멤버 · 프로젝트 수 · 보관 여부. 읽기 전용 — 대화 제목 · 내용은 없다
export default function SpacesTab() {
  const api = useSpaces();
  const rows = api.data?.shared ?? [];
  const view = useSpaceView(rows);
  const icon = roleIcon('membership') ?? 'people';

  const columns: Column<AdminSpace>[] = [
    {
      key: 'name', header: C.colName, rowHeader: true,
      cell: (s) => <NameCell icon={icon} name={s.name} sub={s.description || undefined} />,
    },
    // 위치 = path 에서 자기 자신을 뺀 위쪽 (지금은 조직 한 칸 — 층이 늘어도 그대로 그린다)
    { key: 'where', header: C.colWhere, hideBelow: 'md', cell: (s) => <ScopePathText path={s.path.slice(0, -1)} /> },
    {
      key: 'visibility', header: C.colVisibility,
      cell: (s) => <Badge size="sm" variant="outline" title={VISIBILITY_HINT[s.visibility]}>{VISIBILITY_TEXT[s.visibility]}</Badge>,
    },
    { key: 'members', header: C.colMembers, align: 'end', cell: (s) => <span className="ui-num">{s.member_count}</span> },
    { key: 'projects', header: C.colProjects, align: 'end', hideBelow: 'md', cell: (s) => <span className="ui-num">{s.project_count}</span> },
    {
      key: 'state', header: C.colState, hideBelow: 'lg',
      cell: (s) => <Badge dot size="sm" tone={s.archived_at ? 'neutral' : 'ok'}>{s.archived_at ? C.archived : C.active}</Badge>,
    },
  ];

  const personal = api.data?.personal_count ?? 0;
  return (
    <div className="part-stack">
      <Callout icon="lock">
        {C.privacy}
        {api.data && <> {C.personal(personal)}</>}
      </Callout>
      <Toolbar>
        <Input type="search" size="sm" icon="search" placeholder={C.search} aria-label={C.search} value={view.query}
          onChange={(e) => view.setQuery(e.target.value)} className="part-search" />
        {view.orgs.length > 1 && (
          <Select size="sm" aria-label={C.orgFilter} options={[{ value: '', label: C.allOrgs(roleLabel('tenant')) }, ...view.orgs]}
            value={view.org} onChange={(e) => view.setOrg(e.target.value)} />
        )}
        <Switch size="sm" label={C.showArchived} checked={view.archived} onCheckedChange={view.setArchived} />
        <ToolbarSpacer />
        {api.state.kind === 'ok' && <Count>{C.count(view.shown.length)}</Count>}
      </Toolbar>
      <Table label={C.table} columns={columns} rows={view.shown} rowKey={(s) => s.id} loading={api.state.kind === 'loading'}
        onRowClick={(s) => view.setOpenId(s.id)} activeKey={view.open?.id} rowState={(s) => (s.archived_at ? 'archived' : undefined)}
        empty={<ListEmpty state={api.state} filtered={rows.length > 0} icon={icon} empty={C.empty} emptyHow={C.emptyHow} noMatch={C.noMatch} onRetry={api.reload} />} />
      <SpaceSheet space={view.open} onClose={() => view.setOpenId(null)} />
    </div>
  );
}
