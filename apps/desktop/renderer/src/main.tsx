// 렌더러 시작점. Pretendard 는 로컬 번들 (앱 밖 요청은 막혀 있어서 CDN 을 못 쓴다).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import { App } from './App';

// 창 버튼 자리: 맥 = 왼쪽 신호등, 윈도우·리눅스 = 오른쪽 overlay, 브라우저 = 없음 (styles.css 의 data-frame)
const ua = navigator.userAgent;
document.documentElement.dataset.frame = !ua.includes('Electron/') ? 'web' : /Mac OS X|Macintosh/.test(ua) ? 'mac' : 'win';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
