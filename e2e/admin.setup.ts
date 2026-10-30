import { test as setup } from '@playwright/test';
import { ADMIN_STATE, adminSignIn } from './auth';

// 관리자 콘솔 스펙의 시작 상태 = 로그인 화면으로 진짜 로그인한 쿠키 (HttpOnly brewai_admin). CSRF 값은 화면이 /api/admin/auth/me 로 다시 받는다
setup('관리자 로그인 → 쿠키 저장', async ({ page }) => {
  await adminSignIn(page);
  await page.context().storageState({ path: ADMIN_STATE });
});
