// docs-plugin.ts 가 만드는 가상 모듈
declare module 'virtual:brewai-docs' {
  const data: import('./types').DocsData;
  export default data;
}
// REPORT.html (iframe srcdoc 용으로 손본 것). 보고서 탭에서만 import() → 따로 청크
declare module 'virtual:brewai-docs/report' {
  const html: string;
  export default html;
}
