// 메뉴 화면 공통 틀 (h1 = 메뉴 이름, 화면마다 하나) · 섹션 · 빈 상태 · 예시 꼬리표. 그리기는 @brewai/ui 부품.
import type { ReactNode } from 'react';
import { Badge, EmptyState, Icon, PageHeader, type IconLike } from '@brewai/ui';
import { labelOf, type RouteId } from '../../../app/menu';
import { PAGE } from '../copy';

export function Page({ id, sub, soon, children }: { id: RouteId; sub: string; soon?: boolean; children: ReactNode }) {
  return (
    <section className="view page ui-scroll">
      <div className="page-in">
        <PageHeader title={labelOf(id)} description={sub} meta={soon && <Badge>{PAGE.soon}</Badge>} />
        {children}
      </div>
    </section>
  );
}

export function Section({ title, extra, id, children }: { title: string; extra?: ReactNode; id?: string; children: ReactNode }) {
  return (
    <section className="sec" id={id}>
      <div className="sec-head">
        <h2>{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

// 설정 줄 — 이름 · 설명 (왼쪽) + 값 · 버튼 (오른쪽). <ul className="rows"> 안에
export function Row({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <li className="row">
      <span className="row-main">
        <b>{title}</b>
        {sub && <span className="row-sub">{sub}</span>}
      </span>
      {children}
    </li>
  );
}

// 섹션 머리 옆 숫자
export const Count = ({ n }: { n: number }) => <span className="count ui-num">{n}</span>;

// 무엇이 보일지(text) 와 무엇이 있어야 하는지(needs) 를 같이 적는다
export function Empty({ icon, title, text, needs, action }: {
  icon: IconLike;
  title: string;
  text: string;
  needs?: string;
  action?: ReactNode;
}) {
  return (
    <EmptyState icon={icon} title={title} action={action}>
      <p>{text}</p>
      {needs && <p className="needs">{PAGE.needs(needs)}</p>}
    </EmptyState>
  );
}

export const Ex = () => <Badge size="sm">{PAGE.sample}</Badge>;

// 안내 줄 (체크 아이콘 + 글). 한 줄 = [앞 글, 굵게, 뒤 글] — 문구는 각 기능 copy.ts
export type Note = readonly [string, string?, string?];
export function Notes({ items }: { items: readonly Note[] }) {
  return (
    <ul className="notes">
      {items.map(([before, strong, after]) => (
        <li key={before}><Icon name="check" size="sm" /><span>{before}{strong && <b>{strong}</b>}{after}</span></li>
      ))}
    </ul>
  );
}
