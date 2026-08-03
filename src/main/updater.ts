import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { isWindowsStore } from './platform'

const CHECK_INTERVAL = 6 * 60 * 60 * 1000

// Set true to make updates mandatory (no "Later" - the app restarts to update).
const FORCE_UPDATE = false

/**
 * Checks GitHub Releases for updates, downloads them in the background, and
 * prompts the user to restart. No-ops in development, and on macOS only works
 * for a SIGNED + notarized build (Squirrel.Mac requirement).
 * The release feed comes from the `publish:` block in electron-builder.yml.
 */
export function initAutoUpdate(): void {
  if (!app.isPackaged) return

  // The Microsoft Store owns updates for the MSIX build. Left enabled, this
  // would follow the GitHub feed and try to install Nudzie-Setup.exe over the
  // top of the Store package - a second, unmanaged copy of the app, and grounds
  // for failing Store certification. MSIX installs are read-only anyway.
  if (isWindowsStore) {
    log.info('[autoUpdater] Microsoft Store build; the Store handles updates')
    return
  }

  try {
    // Update problems used to be invisible: the error handler discarded
    // everything, so "up to date" and "broken for weeks" looked identical from
    // the outside. Route electron-updater's own logging to a file on the user's
    // machine so a bug report can include it:
    //   macOS   ~/Library/Logs/Nudzie/main.log
    //   Windows %USERPROFILE%\AppData\Roaming\Nudzie\logs\main.log
    // Console stays quiet in packaged builds - nobody launches from a terminal.
    log.transports.file.level = 'info'
    autoUpdater.logger = log

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.autoRunAppAfterInstall = true

    autoUpdater.on('update-downloaded', (info) => {
      const buttons = FORCE_UPDATE ? ['Restart now'] : ['Restart now', 'Later']
      void dialog
        .showMessageBox({
          type: 'info',
          buttons,
          defaultId: 0,
          cancelId: FORCE_UPDATE ? 0 : 1,
          title: 'Update available',
          message: `Nudzie ${info.version} is ready`,
          detail: FORCE_UPDATE
            ? 'A required update has been downloaded. Nudzie will restart to update.'
            : 'A new version has been downloaded. Restart Nudzie to update - or it will update next time you quit.'
        })
        .then((r) => {
          if (FORCE_UPDATE || r.response === 0) {
            log.info('[autoUpdater] user accepted restart; calling quitAndInstall')
            ;(app as unknown as { isQuiting?: boolean }).isQuiting = true
            autoUpdater.quitAndInstall(false, true)
          }
        })
    })

    // Recorded, never surfaced: a failed update check is not something the user
    // can act on, so a dialog would only be noise. Swallowing it entirely was
    // the bug - the app must still never crash over an update.
    autoUpdater.on('error', (err) => log.error('[autoUpdater] update failed:', err))

    void autoUpdater
      .checkForUpdates()
      .catch((err) => log.error('[autoUpdater] check failed:', err))
    setInterval(() => {
      void autoUpdater
        .checkForUpdates()
        .catch((err) => log.error('[autoUpdater] scheduled check failed:', err))
    }, CHECK_INTERVAL)
  } catch (err) {
    // Updates are best-effort; never block the app over them.
    log.error('[autoUpdater] could not initialise:', err)
  }
}
