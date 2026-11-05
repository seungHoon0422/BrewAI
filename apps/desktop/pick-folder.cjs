// 로컬 폴더 고르기 (slice 09 · ADR-0016) — 사람이 폴더 대화상자에서 고른 경로 하나를 renderer 에 돌려준다.
// renderer 가 그 경로를 우리 API (PUT /api/projects/{id}/folder) 로 보내고, 규칙(집 폴더 안 · 숨김 X …)은 conductor 가 판정한다.
// 받는 것 = {title?} 뿐 · 돌려주는 것 = {ok, path} | {ok:false, code: cancelled} · 파일 내용은 여기서 읽지 않는다.
// E2E (BREWAI_E2E_PICK_DIR · 배포본 아님) = 대화상자 없이 그 경로.
const { BrowserWindow, app, dialog, ipcMain } = require('electron');

function createPicker({ fromApp, packaged = true }) {
  const e2eDir = !packaged && process.env.BREWAI_E2E_PICK_DIR ? process.env.BREWAI_E2E_PICK_DIR : null;

  async function pick(event, input) {
    if (e2eDir) return { ok: true, path: e2eDir };
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const title = typeof input?.title === 'string' ? input.title.slice(0, 80) : undefined;
    const picked = await dialog.showOpenDialog(win, { title, defaultPath: app.getPath('home'), properties: ['openDirectory'] });
    if (picked.canceled || !picked.filePaths?.[0]) return { ok: false, code: 'cancelled' };
    return { ok: true, path: picked.filePaths[0] };
  }

  function register() {
    ipcMain.handle('folder:pick', (event, arg) => {
      if (!fromApp(event)) throw new Error('blocked');
      return pick(event, arg);
    });
  }
  return { register };
}

module.exports = { createPicker };
