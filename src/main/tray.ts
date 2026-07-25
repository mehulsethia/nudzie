import { Tray, Menu, nativeImage, app, type NativeImage } from 'electron'
import { join } from 'node:path'
import { isPaused, setPaused } from './scheduler'
import { loadCustomTray } from './store'

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
 *   3. the generated bell template (monochrome placeholder).
 * Only the bell is a macOS "template" image; the character faces are colour.
 */
function computeTrayImage(): NativeImage {
  const custom = loadCustomTray()
  if (custom) {
    const img = nativeImage.createFromDataURL(custom)
    if (!img.isEmpty()) return img
  }

  const face = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'tray.png'))
  if (!face.isEmpty()) return face // colour character icon (@2x auto-picked)

  let bell = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'iconTemplate.png'))
  if (bell.isEmpty()) bell = nativeImage.createEmpty()
  if (process.platform === 'darwin') bell.setTemplateImage(true)
  return bell
}

/**
 * Creates the menu-bar / system-tray icon and its menu. Base = QuakPit's tray
 * (settings + a test reminder); folded in = Hydrate Buddy's manual controls
 * (pause reminders, quit). The icon is the character's face.
 */
export function createTray(handlers: TrayHandlers): Tray {
  currentHandlers = handlers
  tray = new Tray(computeTrayImage())
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
