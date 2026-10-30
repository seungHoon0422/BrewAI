// 입력창 위 줄의 프로젝트 칩 — 새 대화면 '어느 프로젝트에 넣을지', 연 대화면 '이 대화를 옮길 곳'(같은 스페이스 · 내 대화만).
// 값 · 바꾸기는 부르는 쪽(대화 화면)이 쥔다. 목록 = 지금 스페이스의 프로젝트
import { Icon, Menu, type MenuEntry } from '@brewai/ui';
import { GROUP, kindIcon } from '../../scope/model';
import { PROJECTS } from '../copy';
import { useProjects } from '../hooks';

const NONE = '__none__';

export function ProjectPicker({ value, onChange, mode, locked }: {
  value: string | null;
  onChange: (id: string | null) => void;
  mode: 'new' | 'move';
  locked?: boolean; // 남의 대화 (옮길 수 없음)
}) {
  const projects = useProjects();
  const icon = kindIcon(GROUP) ?? 'folder';
  const current = projects.list.find((p) => p.id === value);
  const label = current?.name ?? PROJECTS.none;
  const title = locked ? PROJECTS.pickerLocked : mode === 'move' ? PROJECTS.pickerMove : PROJECTS.picker;
  if (locked) {
    return <button type="button" disabled title={title}><Icon name={icon} size="sm" />{label}</button>;
  }
  const items: MenuEntry[] = [
    { kind: 'heading', label: title },
    { id: NONE, label: PROJECTS.none, checked: value === null },
    ...projects.list.map((p): MenuEntry => ({ id: p.id, label: p.name, icon, checked: p.id === value })),
  ];
  return (
    <Menu label={title} placement="top-start" width={240} items={items} onSelect={(id) => onChange(id === NONE ? null : id)}
      trigger={(t) => (
        <button {...t} type="button" title={title}>
          <Icon name={icon} size="sm" />{label}<Icon name="chevron-down" size="sm" />
        </button>
      )} />
  );
}
