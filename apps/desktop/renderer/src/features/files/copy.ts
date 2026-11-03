// 파일 문구 (slice 07). UI 문구에 가운뎃점 '·' 쓰지 않는다 (e2e/copy-rule.ts)
import type { IconName } from '@brewai/ui';
import { count } from '../../lib/format';
import type { FileKind, Mode, Where } from './api';

export const KIND_LABEL: Record<FileKind, string> = { image: '이미지', pdf: 'PDF', text: '글', docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint' };
export const KIND_ICON: Record<FileKind, IconName> = { image: 'image', pdf: 'file', text: 'text', docx: 'file', xlsx: 'grid', pptx: 'layers' };

// 전달 배지 = 이 모델에 어떻게 가는지 (서버 files.plan 그대로) · 칩의 차별점
export const MODE_LABEL: Record<Mode, string> = { original: '원본으로', text: '글로', outline: '필요할 때 읽음', blocked: '이 모델은 못 받아요' };
export const MODE_HINT: Record<Mode, string> = {
  original: '파일을 그대로 모델에 보내요',
  text: '파일에서 뽑은 글을 보내요',
  outline: '앞부분과 목차만 보내고, 나머지는 모델이 필요할 때 쪽을 골라 읽어요',
  blocked: '이 모델은 이 형식을 받을 수 없어 이름만 전해요. 다른 모델을 골라 보세요',
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
  tokens: (n: number) => `약 ${count(n)}토큰`,
  total: (n: number, t: number) => `첨부 ${n}개, 약 ${count(t)}토큰`,
  chips: '첨부한 파일',
  blockedWarn: '이 모델이 받을 수 없는 파일이 있어요. 이름만 전해져요',
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
