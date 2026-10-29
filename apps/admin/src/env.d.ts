// env.d.ts — tsconfig 가 이미 types: ["vite/client"] (ImportMeta.env 선언) → ImportMetaEnv 만 넓힌다
interface ImportMetaEnv {
  /** conductor 주소 (빌드할 때 넣는다). 기본 http://127.0.0.1:8787 */
  readonly VITE_BREWAI_API_URL?: string;
}
