import { useEffect, useState } from 'react';
import { Callout } from '@brewai/ui';
import { Missing } from './parts';

// REPORT.html 을 콘솔 안에서 본다. 본문(64 KB)은 이 탭을 열 때만 따로 받는다 (import() → 별도 청크)
// sandbox: 스크립트 · 같은 출처 · 위 창 이동 없음 → 콘솔을 건드리지 못한다. 바깥 링크는 새 탭
export default function Report({ info }: { info: { title: string | null; bytes: number } | null }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!info) return;
    let live = true;
    import('virtual:brewai-docs/report')
      .then((m) => live && setHtml(m.default))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [info]);

  if (!info) return <Missing file="REPORT.html" />;
  return (
    <>
      <Callout icon="receipt">
        <b>{info.title ?? 'REPORT.html'}</b> · {Math.round(info.bytes / 1024)} KB · <code>/report</code> 가 이 파일을 갱신합니다. 링크는 새 탭에서 열립니다.
      </Callout>
      {failed ? (
        <p className="missing">보고서를 불러오지 못했습니다.</p>
      ) : html === null ? (
        <p className="missing" role="status">
          불러오는 중…
        </p>
      ) : (
        <iframe
          className="report-frame"
          title={info.title ?? 'REPORT.html'}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={html}
        />
      )}
    </>
  );
}
