import type { ReactNode } from 'react';
import type { Html } from './types';

// Node(markdown-it, html:false)에서 만든 HTML 을 그대로 꽂는다
export function Rich({ html, as: Tag = 'span', className }: { html: Html; as?: 'span' | 'div' | 'p' | 'li'; className?: string }) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

// 상태 칩: on = 초록(있음 · 완료 · 확정) · now = 파랑(진행 중 · 제안) · off = 회색(예정)
export type Tone = 'on' | 'now' | 'off' | 'warn' | 'ext';
export function St({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`st ${tone}`} title={title}>
      {children}
    </span>
  );
}

// 파일이 없을 때
export function Missing({ file }: { file: string }) {
  return (
    <p className="missing">
      <code>{file}</code> 를 읽지 못했습니다.
    </p>
  );
}

// 탭 맨 아래: 이 화면이 읽은 파일
export function Sources({ files }: { files: string[] }) {
  return (
    <p className="docs-src">
      출처 ·{' '}
      {files.map((f, i) => (
        <span key={f}>
          {i > 0 && ' · '}
          <code>{f}</code>
        </span>
      ))}
    </p>
  );
}
