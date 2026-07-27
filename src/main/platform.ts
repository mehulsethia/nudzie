import { app, BrowserWindow, nativeImage } from 'electron'
import { getPrefs, loadCustomAppIcon } from './store'
import { buildAssetImage } from './assets'

// Whether a menu-bar / tray icon exists - the app's other way back in. Set by
// index.ts once the tray has been created. Kept as a flag rather than importing
// tray.ts because tray → scheduler → windows/overlay → platform would be an
// import cycle (overlay re-applies the Dock icon, see keepDockVisible there).
let trayAvailable = false

export function setTrayAvailable(available: boolean): void {
  trayAvailable = available
}

/**
 * Applies the "show in Dock" preference on macOS.
 *  - dockIcon = true  → a regular app: Dock icon + Cmd-Tab entry.
 *  - dockIcon = false → menu-bar-only ("accessory"): no Dock icon, no Cmd-Tab
 *    entry; the app lives entirely in the menu-bar / tray (like Hydrate Buddy).
 * No-op on Windows/Linux, which have no Dock concept.
 *
 * Hiding the Dock icon is only safe while a menu-bar icon exists. If the tray
 * failed to create, honouring dockIcon = false would strand the app: still
 * running, but with no Dock icon and no menu-bar icon to click. In that case we
 * keep the Dock icon regardless of the preference.
 */
export function applyDockMode(): void {
  if (process.platform !== 'darwin') return
  const show = getPrefs().dockIcon || !trayAvailable
  try {
    app.setActivationPolicy(show ? 'regular' : 'accessory')
    if (show) void app.dock?.show()
    else app.dock?.hide()
  } catch {
    /* not permitted in some environments */
  }
  // dock.show() resets the Dock icon to the app bundle's own icon - which in dev
  // is the stock Electron logo. Re-assert the character icon after every show.
  if (show) applyAppIcon()
}

/**
 * Applies the app icon (Dock on macOS, window/taskbar icon on Windows/Linux):
 *  - the user's custom-character app icon if they've set one, otherwise
 *  - the bundled default character icon (build/icon.png).
 * Called on launch and whenever the custom character changes, so the icon
 * tracks the character dynamically - even in dev, where it overrides the plain
 * Electron icon.
 */
export function applyAppIcon(): void {
  const custom = loadCustomAppIcon()
  const img = custom ? nativeImage.createFromDataURL(custom) : buildAssetImage('icon.png')
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
