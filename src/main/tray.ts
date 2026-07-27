import { Tray, Menu, nativeImage, app, type NativeImage } from 'electron'
import { isPaused, setPaused } from './scheduler'
import { loadCustomTray } from './store'
import { buildAssetImage, fallbackTrayImage } from './assets'

let tray: Tray | null = null
let currentHandlers: TrayHandlers | null = null

export type TrayHandlers = {
  onSettings: () => void
  onTestReminder: () => void
}

/**
 * Picks the tray image, in priority order:
 *   1. the user's custom-character face (colour, from their uploaded art),
 *   2. the bundled character face build/tray.png (colour, from prepare-assets),
 *   3. the bundled bell template build/iconTemplate.png,
 *   4. the inlined bell (assets.ts) - always non-empty.
 * Only the bells are macOS "template" images; the character faces are colour.
 *
 * Never returns an empty image: an empty NativeImage makes the menu-bar item
 * invisible, and with "Show in Dock" off that leaves the app unreachable.
 */
function computeTrayImage(): NativeImage {
  const custom = loadCustomTray()
  if (custom) {
    const img = nativeImage.createFromDataURL(custom)
    if (!img.isEmpty()) return img
  }

  const face = buildAssetImage('tray.png')
  if (face) return face // colour character icon (@2x auto-picked)

  const bell = buildAssetImage('iconTemplate.png')
  if (bell) {
    if (process.platform === 'darwin') bell.setTemplateImage(true)
    return bell
  }

  return fallbackTrayImage()
}

/**
 * Creates the menu-bar / system-tray icon and its menu. Base = QuakPit's tray
 * (settings + a test reminder); folded in = Hydrate Buddy's manual controls
 * (pause reminders, quit). The icon is the character's face.
 */
export function createTray(handlers: TrayHandlers): Tray | null {
  currentHandlers = handlers
  try {
    tray = new Tray(computeTrayImage())
  } catch (err) {
    // If the menu-bar item can't be created the app must not also hide its Dock
    // icon, or it becomes unreachable - see applyDockMode() in platform.ts.
    console.error('[tray] could not create the menu-bar icon:', err)
    tray = null
    return null
  }
  rebuild()
  return tray
}

/** Re-reads the tray image (after the custom character changes). */
export function refreshTrayIcon(): void {
  if (tray) tray.setImage(computeTrayImage())
}

function rebuild(): void {
  if (!tray || !currentHandlers) return
  const h = currentHandlers
  const paused = isPaused()
  tray.setToolTip(paused ? 'Nudzie - paused' : 'Nudzie')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Nudzie', click: h.onSettings },
      { label: 'Trigger a test reminder', click: h.onTestReminder },
      { type: 'separator' },
      {
        label: 'Pause reminders',
        type: 'checkbox',
        checked: paused,
        click: (item) => {
          setPaused(item.checked)
          rebuild()
        }
      },
      { type: 'separator' },
      { label: 'Quit Nudzie', click: () => app.quit() }
    ])
  )
}
