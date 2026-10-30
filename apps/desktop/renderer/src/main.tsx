// 렌더러 시작점. Pretendard 는 로컬 번들 (앱 밖 요청은 막혀 있어서 CDN 을 못 쓴다).
// CSS 순서 = 글꼴 → @brewai/ui (토큰 · 기본 · 부품) → 앱 (styles.css 가 기능 CSS 를 잇는다).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@brewai/ui/styles.css';
import './styles.css';
import { App } from './app/App';

// 창 버튼 자리: 맥 = 왼쪽 신호등, 윈도우·리눅스 = 오른쪽 overlay, 브라우저 = 없음 (shell.css 의 data-frame)
const ua = navigator.userAgent;
document.documentElement.dataset.frame = !ua.includes('Electron/') ? 'web' : /Mac OS X|Macintosh/.test(ua) ? 'mac' : 'win';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
