import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

let win: BrowserWindow | null = null

/** Opens (or focuses) the settings window. */
export function openSettings(): void {
  // Creating a BrowserWindow before the app is ready throws ("Cannot create
  // BrowserWindow before app is ready"). macOS can emit `activate` during launch
  // before whenReady resolves — notably on a duplicate instance that's quitting
  // via the single-instance lock. Ignore those early calls; the normal whenReady
  // path opens the window once it's safe.
  if (!app.isReady()) return

  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return
  }

  win = new BrowserWindow({
    width: 780,
    height: 580,
    minWidth: 660,
    minHeight: 480,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    title: 'Nudzie',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    win?.show()
    win?.focus()
    // Bring the app forward so the window is usable even from another Space/app.
    if (process.platform === 'darwin') app.focus({ steal: true })
  })
  win.on('closed', () => {
    win = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings/index.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/settings/index.html'))
  }
}
