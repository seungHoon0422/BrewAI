// 만든 파일 저장 (slice 08) — renderer 가 우리 API 에서 받은 바이트 + 이름 → 저장 대화상자 (어디에 쓸지는 사람이 고른다) → 씀.
// 받는 것 = {name: 글 · bytes: Uint8Array} 뿐 · 이름 = 경로 조각을 지운 맨 이름 (../ · 드라이브 · 제어 문자 없음) · 25MB (files.py MAX_BYTES).
// 돌려주는 것 = {ok, name} | {ok:false, code} — 고른 경로는 renderer 에 안 돌려준다.
// E2E (BREWAI_E2E_SAVE_DIR · 배포본 아님) = 대화상자 없이 그 폴더에 (같은 이름이면 덮어씀).
const { BrowserWindow, app, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_BYTES = 25 * 1024 * 1024;
const EXT = /\.(docx|xlsx|pptx|md|csv|pdf|txt|json|png|jpe?g|webp|gif)$/i;

function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const base = raw.split(/[\\/]/).pop().replace(/[\x00-\x1f<>:"|?*]+/g, ' ').replace(/^[.\s]+/, '').trim().slice(0, 120);
  return base && EXT.test(base) ? base : null;
}

function createSave({ fromApp, packaged = true }) {
  const e2eDir = !packaged && process.env.BREWAI_E2E_SAVE_DIR ? process.env.BREWAI_E2E_SAVE_DIR : null;

  async function save(event, input) {
    const name = cleanName(input?.name);
    const bytes = input?.bytes;
    if (!name || !(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return { ok: false, code: 'bad_input' };
    let target;
    if (e2eDir) {
      target = path.join(e2eDir, name);
    } else {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const picked = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), name) });
      if (picked.canceled || !picked.filePath) return { ok: false, code: 'cancelled' };
      target = picked.filePath;
    }
    try {
      await fs.writeFile(target, bytes);
    } catch {
      return { ok: false, code: 'write_failed' };
    }
    return { ok: true, name: path.basename(target) };
  }

  function register() {
    ipcMain.handle('files:save', (event, arg) => {
      if (!fromApp(event)) throw new Error('blocked');
      return save(event, arg);
    });
  }
  return { register };
}

module.exports = { createSave, cleanName };
