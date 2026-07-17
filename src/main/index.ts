import { app, globalShortcut } from 'electron'
import { createOverlayWindow } from './windows/overlay'
import { openSettings } from './windows/settings'
import { createTray } from './tray'
import { registerIpc } from './ipc'
import { getPrefs, seedDefaultReminders } from './store'
import { startScheduler, triggerTestReminder, remindNow } from './scheduler'
import { applyDockMode, applyAppIcon } from './platform'
import { initAutoUpdate } from './updater'
import * as calendar from './calendar'
import * as license from './license'
import { shouldOpenSettingsOnActivate } from './activation'

// Set the app name early (before it's read for the menu / About / name). In a
// packaged build this comes from electron-builder's productName; in dev we're
// running the generic Electron binary, so set it explicitly.
app.setName('Nudzie')

// Only allow a single running instance of Nudzie.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// Safety nets: never let a stray error tear the whole app down.
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err))
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err))
app.on('render-process-gone', (_e, _wc, d) => console.error('[render-process-gone]', d))
app.on('child-process-gone', (_e, d) => console.error('[child-process-gone]', d))

// Re-opening the app brings the control window forward.
app.on('second-instance', () => openSettings())

app.whenReady().then(async () => {
  // Nudzie keeps a menu-bar / tray icon and stays running in the background.
  // Whether it also shows a Dock icon (regular app) or hides in the menu bar
  // only (accessory) follows the "Show in Dock" preference - see platform.ts.
  applyDockMode()

  registerIpc()

  // Honour the saved "launch at login" preference (only works once packaged).
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({ openAtLogin: getPrefs().launchAtLogin })
    } catch {
      /* not permitted in some environments */
    }
  }

  createOverlayWindow()
  createTray({
    onSettings: openSettings,
    onTestReminder: triggerTestReminder,
    onRemindNow: remindNow
  })
  globalShortcut.register('CommandOrControl+Shift+D', triggerTestReminder)

  // Show the control window when the app opens.
  openSettings()

  // Make the Dock / taskbar icon the character (default, or the user's custom
  // one). Done after the settings window exists so Windows/Linux can pick it up.
  applyAppIcon()

  // First-run: seed the starter reminder templates (all disabled).
  seedDefaultReminders()

  // Restore any saved calendar sessions (Google opt-in, iCloud creds), then watch.
  await calendar.init().catch(() => undefined)
  startScheduler()

  // Re-validate the license; offline grace keeps Pro working temporarily.
  void license.validate()

  // Check GitHub Releases for updates (packaged builds only).
  initAutoUpdate()
})

// Re-open the control window when the app is activated (macOS) - but ONLY when
// there are no visible windows. Clicking the corner overlay's Accept/Snooze
// buttons activates the app too; without this guard that would pop the settings
// window open on every reminder. When the overlay is on screen it counts as a
// visible window, so a button click no longer opens the app.
app.on('activate', (_event, hasVisibleWindows) => {
  if (shouldOpenSettingsOnActivate(hasVisibleWindows)) openSettings()
})

// Stay alive in the background even when no window is visible.
app.on('window-all-closed', () => {
  // Intentionally do nothing - the app lives in the tray / menu bar.
})

// Let the overlay's close handler know a real quit is underway (so it stops
// intercepting close → hide and actually lets the app exit).
app.on('before-quit', () => {
  ;(app as unknown as { isQuiting?: boolean }).isQuiting = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
