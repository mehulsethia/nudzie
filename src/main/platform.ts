import { app, BrowserWindow, nativeImage } from 'electron'
import { join } from 'node:path'
import { getPrefs, loadCustomAppIcon } from './store'

/**
 * Applies the "show in Dock" preference on macOS.
 *  - dockIcon = true  → a regular app: Dock icon + Cmd-Tab entry.
 *  - dockIcon = false → menu-bar-only ("accessory"): no Dock icon, no Cmd-Tab
 *    entry; the app lives entirely in the menu-bar / tray (like Hydrate Buddy).
 * No-op on Windows/Linux, which have no Dock concept.
 */
export function applyDockMode(): void {
  if (process.platform !== 'darwin') return
  const show = getPrefs().dockIcon
  try {
    app.setActivationPolicy(show ? 'regular' : 'accessory')
    if (show) void app.dock?.show()
    else app.dock?.hide()
  } catch {
    /* not permitted in some environments */
  }
}

/**
 * Applies the app icon (Dock on macOS, window/taskbar icon on Windows/Linux):
 *  - the user's custom-character app icon if they've set one, otherwise
 *  - the bundled default character icon (build/icon.png).
 * Called on launch and whenever the custom character changes, so the icon
 * tracks the character dynamically — even in dev, where it overrides the plain
 * Electron icon.
 */
export function applyAppIcon(): void {
  const custom = loadCustomAppIcon()
  const img = custom
    ? nativeImage.createFromDataURL(custom)
    : nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png'))
  if (!img || img.isEmpty()) return
  try {
    if (process.platform === 'darwin') {
      app.dock?.setIcon(img)
    } else {
      // Windows/Linux: the taskbar icon comes from each window.
      for (const w of BrowserWindow.getAllWindows()) w.setIcon(img)
    }
  } catch {
    /* best-effort */
  }
}
