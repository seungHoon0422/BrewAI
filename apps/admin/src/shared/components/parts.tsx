// 화면 안 작은 틀 (서랍 칸 · 이름 칸 · 개수 · 확인 대화상자 · 목록 빈 칸). 모양은 parts.css (토큰만) — 기능 화면은 이것만 조합한다
import type { ReactNode } from 'react';
import { Avatar, Button, Dialog, EmptyState, renderIcon, type IconLike } from '@brewai/ui';
import { COMMON_COPY, LOAD_FAILED } from '../copy';
import type { Load } from '../load';
import './parts.css';

// 서랍 · 대화상자 안의 한 묶음 (제목 · 설명 한 줄 · 내용). 입력 하나뿐인 묶음은 제목 없이 (입력 이름이 제목)
export function Section({ title, hint, children }: { title?: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <section className="part">
      {title && <h3 className="part-title">{title}</h3>}
      {hint && <p className="part-hint">{hint}</p>}
      {children}
    </section>
  );
}

// 가로 한 줄 (버튼 · 입력 · 꼬리표를 나란히, 좁으면 줄바꿈). 입력 + 저장 버튼 서식은 className="part-inline" (아래 줄 맞춤)
export const Row = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={className ? `part-row ${className}` : 'part-row'}>{children}</div>
);

// 표의 이름 칸 = (사람이면 아바타 · 아니면 아이콘) + 이름 + 아래 한 줄 + 꼬리표
export function NameCell({ name, sub, person, icon, tags }: { name: string; sub?: ReactNode; person?: boolean; icon?: IconLike; tags?: ReactNode }) {
  return (
    <span className="name-cell">
      {person ? <DecorAvatar name={name} /> : icon ? <span className="name-icon">{renderIcon(icon, 'sm')}</span> : null}
      <span className="name-text">
        <span className="name-line">
          <b className="ui-ell">{name}</b>
          {tags}
        </span>
        {sub && <span className="name-sub ui-ell">{sub}</span>}
      </span>
    </span>
  );
}

// 이름 글이 바로 옆에 있을 때의 아바타 = 장식 (화면 읽기 프로그램이 이름을 두 번 읽지 않게)
export const DecorAvatar = ({ name, size = 'sm' }: { name: string; size?: 'xs' | 'sm' }) => (
  <span className="part-avatar" aria-hidden="true"><Avatar name={name} size={size} /></span>
);

// 서랍 · 대화상자 제목 앞에 아바타 · 아이콘을 붙일 때
export const TitleWith = ({ lead, children }: { lead: ReactNode; children: ReactNode }) => <span className="part-titled">{lead}{children}</span>;

export const Count = ({ children }: { children: ReactNode }) => <span className="part-count ui-num">{children}</span>;
export const Muted = ({ children }: { children: ReactNode }) => <span className="part-muted">{children}</span>;

// 되돌리기 어려운 동작 확인 (비활성화 · 빼기 · 코드 취소)
export function ConfirmDialog({ open, title, children, confirm, busy, onConfirm, onClose }: {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  confirm: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} size="sm" dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{COMMON_COPY.cancel}</Button>
          <Button variant="danger" loading={busy} onClick={onConfirm}>{confirm}</Button>
        </>
      }>
      {children && <p className="part-hint">{children}</p>}
    </Dialog>
  );
}

// 표가 비었을 때 칸 (읽기 실패 → 다시 시도 · 진짜 없음 · 거르개에 안 맞음)
export function ListEmpty({ state, filtered, icon, empty, emptyHow, noMatch, onRetry }: {
  state: Load<unknown>;
  filtered: boolean;
  icon: IconLike;
  empty: ReactNode;
  emptyHow?: ReactNode;
  noMatch: ReactNode;
  onRetry: () => void;
}) {
  if (state.kind === 'error') {
    return (
      <EmptyState variant="plain" icon="plug" title={<span role="alert">{LOAD_FAILED[state.error]}</span>}
        action={<Button onClick={onRetry}>{COMMON_COPY.retry}</Button>} />
    );
  }
  if (filtered) return <EmptyState variant="plain" icon="search" title={noMatch} />;
  return <EmptyState variant="plain" icon={icon} title={empty}>{emptyHow}</EmptyState>;
}
