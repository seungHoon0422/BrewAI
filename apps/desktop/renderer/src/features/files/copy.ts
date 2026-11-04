// 파일 문구 (slice 07). UI 문구에 가운뎃점 '·' 쓰지 않는다 (e2e/copy-rule.ts)
import type { IconName } from '@brewai/ui';
import { count } from '../../lib/format';
import type { FileKind, Mode, Where } from './api';

export const KIND_LABEL: Record<FileKind, string> = { image: '이미지', pdf: 'PDF', text: '글', docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint' };
export const KIND_ICON: Record<FileKind, IconName> = { image: 'image', pdf: 'file', text: 'text', docx: 'file', xlsx: 'grid', pptx: 'layers' };

// 전달 배지 = 이 모델에 어떻게 가는지 (서버 files.plan 그대로) · 칩의 차별점. 그대로 = 파일 자체를 보내 모델이 직접 본다 · 글 = 뽑은 글만
export function modeLabel(mode: Mode, kind: FileKind): string {
  if (mode === 'original') return kind === 'image' ? '이미지 그대로' : kind === 'pdf' ? 'PDF 그대로' : '파일 그대로';
  return { text: '글만 뽑아서', outline: '필요한 부분만 읽음', blocked: '이 모델은 못 봐요' }[mode];
}
export const MODE_HINT: Record<Mode, string> = {
  original: '파일을 그대로 보내서 모델이 직접 봐요 (그림 속 글자, 표, 도형까지)',
  text: '파일에서 글만 뽑아 보내요 (그림과 모양은 빠져요)',
  outline: '앞부분과 목차만 먼저 보내고, 나머지는 모델이 필요할 때 쪽을 골라 읽어요',
  blocked: '이 모델은 이 형식을 볼 수 없어 이름만 전해요. 다른 모델을 골라 보세요',
};
export const REASON: Record<string, string> = {
  vision_unsupported: '이미지를 보는 모델이 아니에요',
  pdf_unsupported: '이 모델은 PDF 원본을 못 받아 글로 보내요',
  pdf_too_big: 'PDF가 커서 글로 보내요',
  too_long: '글이 길어서 필요한 쪽만 읽어요',
};

export const FILE_ERROR: Record<string, string> = {
  unsupported_type: '받을 수 없는 형식이에요. 이미지, PDF, 글, Word, Excel, PowerPoint만 돼요',
  file_too_large: '25MB까지 올릴 수 있어요',
  image_too_large: '이미지는 5MB까지 돼요',
  file_too_complex: '파일 안 내용이 너무 커서 열 수 없어요',
  bad_file: '파일을 열 수 없어요. 깨졌거나 지원하지 않는 모양이에요',
  pdf_encrypted: '암호가 걸린 PDF는 열 수 없어요',
  empty_file: '빈 파일이에요',
  quota_exceeded: '올릴 수 있는 용량을 다 썼어요. 파일 화면에서 안 쓰는 파일을 지워 주세요',
  bad_files: '첨부를 보낼 수 없어요. 다시 올려 주세요',
};
export const fileError = (code?: string) => (code && FILE_ERROR[code]) || '파일을 올리지 못했어요';

export const WHERE_LABEL: Record<Where['kind'], string> = { thread: '대화', project: '프로젝트', draft: '보내기 전' };

export function sizeText(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)}MB`;
}

export const FILES = {
  attach: '파일 첨부',
  attachHint: '이미지, PDF, 글, Word, Excel, PowerPoint (끌어다 놓거나 붙여 넣어도 돼요)',
  drop: '여기에 놓으면 첨부돼요',
  uploading: '올리는 중',
  remove: (name: string) => `${name} 빼기`,
  total: (n: number) => `첨부 ${n}개`,
  resized: '긴 쪽을 2,048px로 줄여 올렸어요',
  chips: '첨부한 파일',
  cantSee: '이 모델은 볼 수 없어요',
  // 답 아래 만든 파일 (slice 08)
  made: '만든 파일',
  save: '저장',
  saveLabel: (name: string) => `${name} 저장`,
  saving: '저장하는 중',
  saved: '저장했어요',
  saveFailed: (code: string) => (code === 'gone' ? '지워진 파일이에요' : code === 'cancelled' ? '' : '저장하지 못했어요'),
  preview: '미리보기',
  previewLabel: (name: string) => `${name} 미리보기`,
  pagesCount: (n: number) => `${count(n)}쪽`,
  pageAlt: (n: number) => `${count(n)}쪽`,
  pageLoading: '쪽을 그리는 중',
  previewFailed: '미리보기를 열 수 없어요. 저장해서 열어 보세요',
  previewMore: (n: number) => `앞 ${count(n)}쪽만 보여요. 나머지는 저장해서 보세요`,
  // 뷰어 (대화와 오른쪽 패널 사이)
  viewer: '파일 보기',
  viewerClose: '파일 보기 닫기',
  viewerResize: '파일 보기 폭',
  zoomOut: '작게',
  zoomIn: '크게',
  zoomFit: '폭 맞춤',
  zoomLabel: '확대',
  morePages: (n: number) => `${count(n)}쪽 더 보기`,
  noPreview: (kind: string) => `${kind} 파일은 저장해서 열어 주세요`,
  textCut: '글이 길어 앞부분만 보여요. 전체는 저장해서 보세요',
  openLabel: (name: string) => `${name} 열기`,
  // 스페이스 '파일' 화면
  title: '파일',
  sub: '이 스페이스의 대화와 프로젝트에 올린 파일이에요.',
  filter: '보기',
  all: '전체',
  list: '파일 목록',
  empty: '아직 올린 파일이 없어요',
  emptyText: '대화 입력창의 + 버튼이나 프로젝트 화면에서 올릴 수 있어요.',
  loading: '불러오는 중',
  loadFailed: '파일 목록을 불러오지 못했어요',
  retry: '다시 시도',
  delete: '지우기',
  deleteLabel: (name: string) => `${name} 지우기`,
  deleteTitle: '이 파일을 지울까요?',
  deleteBody: '원본과 뽑은 글이 함께 지워져요. 이 파일을 쓴 대화에는 이름만 남아요.',
  deleted: (name: string) => `${name}을(를) 지웠어요`,
  cancel: '취소',
  by: (name: string) => `${name} 님`,
  untitled: '제목 없는 대화',
  pages: (n: number) => `${count(n)}쪽`,
  // 프로젝트 파일
  projectTitle: '프로젝트 파일',
  projectSub: '이 프로젝트의 모든 대화에서 모델이 필요할 때 읽어요.',
  projectEmpty: '아직 프로젝트 파일이 없어요',
  upload: '파일 올리기',
  uploaded: (name: string) => `${name}을(를) 올렸어요`,
} as const;
