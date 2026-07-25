import { app, ipcMain, shell } from 'electron'
import {
  getPrefs,
  setPrefs,
  type Prefs,
  saveCustomCharacter,
  loadCustomCharacter,
  clearCustomCharacter,
  saveCustomSound,
  loadCustomSound,
  clearCustomSound,
  getScheduled,
  setScheduled,
  type CustomCharacter,
  type ScheduledReminder
} from './store'
import * as google from './calendar/google'
import * as calendar from './calendar'
import * as license from './license'
import { overlayDone } from './windows/overlay'
import { applyDockMode, applyAppIcon } from './platform'
import { refreshTrayIcon } from './tray'
import { suppressSettingsActivation } from './activation'
import {
  startScheduler,
  triggerTestReminder,
  remindNow,
  handleAccept,
  handleSnooze,
  sortReminders
} from './scheduler'

const FREE_CAL_MSG =
  'The free plan supports one calendar. Upgrade to Nudzie Pro to add more calendars.'

/** How many calendars are connected across ALL providers (iCal + iCloud + Google). */
function calendarCount(): number {
  const s = calendar.statuses()
  const icloud = s.find((x) => x.id === 'icloud')?.connected ? 1 : 0
  const google = s.find((x) => x.id === 'google')?.connected ? 1 : 0
  return calendar.icalFeeds().length + icloud + google
}

/** Wires the settings + overlay renderers to the main process. */
export function registerIpc(): void {
  ipcMain.handle('prefs:get', () => getPrefs())

  ipcMain.handle('prefs:set', (_e, patch: Partial<Prefs>) => {
    const prefs = setPrefs(patch)
    if (patch.launchAtLogin !== undefined && app.isPackaged) {
      try {
        app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin })
      } catch {
        /* ignore: not permitted in dev / sandboxed runs */
      }
    }
    if (patch.staySignedIn === true) google.persistIfPossible()
    if (patch.staySignedIn === false) google.forgetPersisted()
    if (patch.dockIcon !== undefined) applyDockMode()
    // Interval-timing changes take effect on the next schedule; re-arm now.
    if (
      patch.intervalEnabled !== undefined ||
      patch.intervalMinutes !== undefined ||
      patch.activeStartHour !== undefined ||
      patch.activeEndHour !== undefined
    ) {
      startScheduler()
    }
    return prefs
  })

  // --- Calendars (multi-provider: Google, iCloud, iCal links) ---
  ipcMain.handle('cal:status', () => calendar.statuses())

  ipcMain.handle(
    'cal:connect',
    async (_e, provider: string, params: { username?: string; password?: string }) => {
      // Free plan = one calendar across ALL providers. Allow reconnecting a
      // provider that's already connected (it doesn't add a new calendar).
      const already = calendar.statuses().find((s) => s.id === provider)?.connected
      if (!license.isPremium() && !already && calendarCount() >= 1) throw new Error(FREE_CAL_MSG)
      const s = await calendar.connect(provider, params ?? {})
      startScheduler()
      return s
    }
  )

  ipcMain.handle('cal:disconnect', (_e, provider: string) => calendar.disconnect(provider))

  ipcMain.handle(
    'cal:configure',
    (_e, provider: string, params: { clientId?: string; clientSecret?: string }) =>
      calendar.configure(provider, params ?? {})
  )

  // iCal subscription links
  ipcMain.handle('ical:list', () => calendar.icalFeeds())
  ipcMain.handle('ical:add', async (_e, url: string, name?: string) => {
    if (!license.isPremium() && calendarCount() >= 1) throw new Error(FREE_CAL_MSG)
    const feeds = await calendar.icalAdd(url, name)
    startScheduler()
    return feeds
  })
  ipcMain.handle('ical:remove', (_e, id: string) => calendar.icalRemove(id))

  ipcMain.handle('events:upcoming', async () => {
    try {
      // Show everything from now until the end of the local day.
      const now = new Date()
      const endOfDay = new Date(now)
      endOfDay.setHours(23, 59, 59, 999)
      const minutes = Math.max(1, Math.ceil((endOfDay.getTime() - now.getTime()) / 60_000))
      return await calendar.listUpcoming(minutes)
    } catch {
      return []
    }
  })

  // Open a link (checkout, help) in the user's real browser, not an app window.
  ipcMain.handle('open:external', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  // --- Reminders / overlay ---
  ipcMain.handle('reminder:test', () => {
    triggerTestReminder()
    return true
  })
  ipcMain.handle('reminder:now', () => {
    remindNow()
    return true
  })
  ipcMain.on(
    'reminder:accept',
    (_e, id: string, kind: 'calendar' | 'interval' | 'scheduled' | 'summary') => {
      suppressSettingsActivation()
      handleAccept(id, kind)
    }
  )
  ipcMain.on(
    'reminder:snooze',
    (_e, id: string, kind: 'calendar' | 'interval' | 'scheduled' | 'summary', minutes: number) => {
      suppressSettingsActivation()
      handleSnooze(id, kind, minutes)
    }
  )
  ipcMain.on('reminder:hide', () => {
    suppressSettingsActivation()
    overlayDone()
  })

  // --- Scheduled reminders (once/daily/weekly/monthly/yearly) ---
  ipcMain.handle('scheduled:list', () => sortReminders(getScheduled()))
  ipcMain.handle('scheduled:add', (_e, r: Omit<ScheduledReminder, 'id' | 'enabled' | 'lastFired'>) => {
    const list = getScheduled()
    const entry: ScheduledReminder = {
      id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: (r.title ?? '').trim() || 'Reminder',
      message: (r.message ?? '').trim(),
      schedule: r.schedule,
      character: r.character,
      enabled: true
    }
    setScheduled([...list, entry])
    return sortReminders(getScheduled())
  })
  ipcMain.handle('scheduled:remove', (_e, id: string) => {
    setScheduled(getScheduled().filter((r) => r.id !== id))
    return sortReminders(getScheduled())
  })
  ipcMain.handle('scheduled:setEnabled', (_e, id: string, enabled: boolean) => {
    setScheduled(
      getScheduled().map((r) => (r.id === id ? { ...r, enabled, lastFired: undefined } : r))
    )
    return sortReminders(getScheduled())
  })

  // --- Custom character ("make your own") ---
  ipcMain.handle('character:canCustom', () => license.canUseCustomCharacter())
  ipcMain.handle('character:getCustom', () => loadCustomCharacter())
  ipcMain.handle('character:setCustom', (_e, c: CustomCharacter) => {
    if (!license.canUseCustomCharacter()) {
      throw new Error('Custom characters are a Pro feature.')
    }
    if (!c?.idle || !c?.action) throw new Error('Both an idle and an action image are required.')
    saveCustomCharacter(c)
    const prefs = setPrefs({ character: 'custom' })
    refreshTrayIcon()
    applyAppIcon()
    return prefs
  })
  ipcMain.handle('character:clearCustom', () => {
    clearCustomCharacter()
    const wasCustom = getPrefs().character === 'custom'
    const prefs = setPrefs(wasCustom ? { character: 'androgynous' } : {})
    refreshTrayIcon()
    applyAppIcon()
    return prefs
  })

  // --- Custom sound: a user-supplied clip, stored on device only ---
  ipcMain.handle('sound:setCustom', (_e, dataUrl: string) => {
    if (!license.canUseAppearanceCustomizations()) {
      throw new Error('Custom sounds are a Pro feature.')
    }
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:audio')) {
      throw new Error('Please choose an audio file.')
    }
    saveCustomSound(dataUrl)
    return true
  })
  ipcMain.handle('sound:getCustom', () => loadCustomSound())
  ipcMain.handle('sound:clearCustom', () => {
    clearCustomSound()
    return true
  })

  // --- License / premium ---
  ipcMain.handle('license:status', () => license.status())
  ipcMain.handle('license:activate', (_e, key: string) => license.activate(key))
  ipcMain.handle('license:deactivate', () => license.deactivate())
}
