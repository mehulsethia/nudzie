import { contextBridge, ipcRenderer } from 'electron'

export type Reminder = {
  id: string
  kind: 'calendar' | 'interval' | 'scheduled' | 'summary'
  message: string
  items?: string[] // for 'summary': the list of missed reminders
  acceptLabel: string
  snoozeLabel: string
  snoozeMinutes: number
  character?: string
  sound?: boolean
  bubbleTheme?: string
  bubbleFont?: string
  soundChoice?: string
  soundUrl?: string
}

// Single, minimal API exposed to both the overlay and settings renderers.
contextBridge.exposeInMainWorld('nudzie', {
  // --- Overlay (corner-walk character) ---
  onReminder: (cb: (reminder: Reminder) => void): (() => void) => {
    const listener = (_event: unknown, reminder: Reminder): void => cb(reminder)
    ipcRenderer.on('reminder:show', listener)
    return () => ipcRenderer.removeListener('reminder:show', listener)
  },
  accept: (id: string, kind: string) => ipcRenderer.send('reminder:accept', id, kind),
  snooze: (id: string, kind: string, minutes: number) =>
    ipcRenderer.send('reminder:snooze', id, kind, minutes),
  hideOverlay: () => ipcRenderer.send('reminder:hide'),

  // --- Settings ---
  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  setPrefs: (patch: unknown) => ipcRenderer.invoke('prefs:set', patch),
  calStatus: () => ipcRenderer.invoke('cal:status'),
  calConnect: (provider: string, params?: { username?: string; password?: string }) =>
    ipcRenderer.invoke('cal:connect', provider, params),
  calDisconnect: (provider: string) => ipcRenderer.invoke('cal:disconnect', provider),
  calConfigure: (provider: string, params: { clientId?: string; clientSecret?: string }) =>
    ipcRenderer.invoke('cal:configure', provider, params),
  icalList: () => ipcRenderer.invoke('ical:list'),
  icalAdd: (url: string, name?: string) => ipcRenderer.invoke('ical:add', url, name),
  icalRemove: (id: string) => ipcRenderer.invoke('ical:remove', id),
  upcoming: () => ipcRenderer.invoke('events:upcoming'),
  openExternal: (url: string) => ipcRenderer.invoke('open:external', url),
  testReminder: () => ipcRenderer.invoke('reminder:test'),
  remindNow: () => ipcRenderer.invoke('reminder:now'),

  // --- Scheduled reminders ---
  scheduledList: () => ipcRenderer.invoke('scheduled:list'),
  scheduledAdd: (r: unknown) => ipcRenderer.invoke('scheduled:add', r),
  scheduledRemove: (id: string) => ipcRenderer.invoke('scheduled:remove', id),
  scheduledSetEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('scheduled:setEnabled', id, enabled),

  // --- Custom character ---
  canCustomCharacter: () => ipcRenderer.invoke('character:canCustom'),
  getCustomCharacter: () => ipcRenderer.invoke('character:getCustom'),
  setCustomCharacter: (c: { idle: string; action: string; tray?: string; appIcon?: string }) =>
    ipcRenderer.invoke('character:setCustom', c),
  clearCustomCharacter: () => ipcRenderer.invoke('character:clearCustom'),

  // --- Custom sound (Pro) ---
  setCustomSound: (dataUrl: string) => ipcRenderer.invoke('sound:setCustom', dataUrl),
  getCustomSound: () => ipcRenderer.invoke('sound:getCustom'),
  clearCustomSound: () => ipcRenderer.invoke('sound:clearCustom'),

  // --- License / premium ---
  licenseStatus: () => ipcRenderer.invoke('license:status'),
  licenseActivate: (key: string) => ipcRenderer.invoke('license:activate', key),
  licenseDeactivate: () => ipcRenderer.invoke('license:deactivate')
})
