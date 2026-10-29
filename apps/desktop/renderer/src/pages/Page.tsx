// 메뉴 화면 공통 틀 (h1 = 메뉴 이름, 화면마다 하나) · 빈 상태 · 섹션
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { labelOf, type MenuId } from '../menu';

export function Page({ id, sub, soon, children }: { id: MenuId; sub: string; soon?: boolean; children: ReactNode }) {
  return (
    <section className="view page">
      <div className="page-in">
        <header className="page-head">
          <div className="page-title">
            <h1>{labelOf(id)}</h1>
            {soon && <span className="chip">준비 중</span>}
          </div>
          <p>{sub}</p>
        </header>
        {children}
      </div>
    </section>
  );
}

// 무엇이 보일지(text) 와 무엇이 있어야 하는지(needs) 를 같이 적는다
export function Empty({ icon, title, text, needs, action }: {
  icon: IconName;
  title: string;
  text: string;
  needs?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="tile"><Icon name={icon} /></span>
      <p className="empty-t">{title}</p>
      <p>{text}</p>
      {needs && <p className="needs">필요 · {needs}</p>}
      {action}
    </div>
  );
}

export function Section({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="sec">
      <div className="sec-head">
        <h2>{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function Ex() {
  return <span className="ex">예시</span>;
}
