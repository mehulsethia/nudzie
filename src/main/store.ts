import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Non-personal preferences only — no calendar data ever lives here. */
export type Prefs = {
  // --- Calendar reminders (from QuakPit's scheduler) ---
  leadMinutes: number // fire this many minutes before a meeting
  messageTemplate: string // {title} / {minutes} tokens
  remindAtStart: boolean // a second nudge right at the meeting's start time

  // --- Interval / personal reminders (from Hydrate Buddy's timing logic) ---
  intervalEnabled: boolean
  activeStartHour: number // 0–23, local time — reminders may appear from here
  activeEndHour: number // 0–23, local time — reminders stop after here
  intervalMinutes: number // cadence
  snoozeMinutes: number // "remind me again in N" for the Snooze button
  intervalMessage: string // the copy shown for interval reminders

  // --- Shared ---
  soundEnabled: boolean
  staySignedIn: boolean
  launchAtLogin: boolean
  dockIcon: boolean // macOS: show a Dock icon (false = menu-bar-only)
  targetDisplay: 'cursor' | 'primary'

  // --- Pro-gated asset ---
  character: string // which character walks in; free is forced to the default
}

const DEFAULT_PREFS: Prefs = {
  leadMinutes: 5,
  messageTemplate: '{title} in {minutes} minutes',
  remindAtStart: false,

  intervalEnabled: true,
  activeStartHour: 10,
  activeEndHour: 23,
  intervalMinutes: 45,
  snoozeMinutes: 15,
  intervalMessage: 'Time for a water break 💧',

  soundEnabled: true,
  staySignedIn: true,
  launchAtLogin: false,
  dockIcon: true,
  targetDisplay: 'cursor',

  character: 'buddy'
}

function dataDir(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
const prefsPath = (): string => join(dataDir(), 'prefs.json')
const tokenPath = (): string => join(dataDir(), 'token.bin')
const licensePath = (): string => join(dataDir(), 'license.bin')
const icloudPath = (): string => join(dataDir(), 'icloud.bin')
const googleCredsPath = (): string => join(dataDir(), 'google-creds.bin')
const icalPath = (): string => join(dataDir(), 'ical-feeds.bin')
// The user's own character: idle/action/tray poses, kept as ready-to-render data
// URLs (decorative, chosen by the user — not sensitive, so not encrypted). They
// never leave the device; the overlay reads them through the main process only.
const scheduledPath = (): string => join(dataDir(), 'scheduled.json')
const customIdlePath = (): string => join(dataDir(), 'custom-idle.txt')
const customActionPath = (): string => join(dataDir(), 'custom-action.txt')
const customTrayPath = (): string => join(dataDir(), 'custom-tray.txt')
const customAppIconPath = (): string => join(dataDir(), 'custom-appicon.txt')

let cache: Prefs | null = null

export function getPrefs(): Prefs {
  if (cache) return cache
  try {
    if (existsSync(prefsPath())) {
      const raw = JSON.parse(readFileSync(prefsPath(), 'utf8'))
      cache = { ...DEFAULT_PREFS, ...raw }
    } else {
      cache = { ...DEFAULT_PREFS }
    }
  } catch {
    cache = { ...DEFAULT_PREFS }
  }
  return cache as Prefs
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  const next: Prefs = { ...getPrefs(), ...patch }
  cache = next
  try {
    writeFileSync(prefsPath(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    /* preferences are best-effort */
  }
  return next
}

// --- Scheduled reminders (once/daily/weekly/monthly/yearly) -----------------
// Non-sensitive user config, stored as plain JSON (like prefs).

export type Schedule = {
  type: 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly'
  time: string // 'HH:MM' 24-hour, local time
  date?: string // once: 'YYYY-MM-DD'
  days?: number[] // weekly: 0=Sun … 6=Sat
  dayOfMonth?: number // monthly: 1–31 (clamped to the month's length)
  month?: number // yearly: 1–12
  day?: number // yearly: 1–31 (clamped)
}

export type ScheduledReminder = {
  id: string
  title: string
  message: string
  schedule: Schedule
  character?: string
  enabled: boolean
  lastFired?: number // epoch ms of the last occurrence we fired (for de-dupe)
}

let scheduledCache: ScheduledReminder[] | null = null

export function getScheduled(): ScheduledReminder[] {
  if (scheduledCache) return scheduledCache
  try {
    scheduledCache = existsSync(scheduledPath())
      ? (JSON.parse(readFileSync(scheduledPath(), 'utf8')) as ScheduledReminder[])
      : []
  } catch {
    scheduledCache = []
  }
  return scheduledCache
}

export function setScheduled(list: ScheduledReminder[]): void {
  scheduledCache = list
  try {
    writeFileSync(scheduledPath(), JSON.stringify(list, null, 2), 'utf8')
  } catch {
    /* best-effort */
  }
}

// --- OAuth refresh token: encrypted at rest by the OS, and entirely optional ---

export function saveRefreshToken(token: string): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) return
    writeFileSync(tokenPath(), safeStorage.encryptString(token))
  } catch {
    /* ignore */
  }
}

export function loadRefreshToken(): string | null {
  try {
    if (!existsSync(tokenPath()) || !safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(readFileSync(tokenPath()))
  } catch {
    return null
  }
}

export function clearRefreshToken(): void {
  try {
    if (existsSync(tokenPath())) rmSync(tokenPath())
  } catch {
    /* ignore */
  }
}

// --- License entitlement: encrypted at rest by the OS (key + instance id + cache) ---

export function saveEntitlement(json: string): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) return
    writeFileSync(licensePath(), safeStorage.encryptString(json))
  } catch {
    /* ignore */
  }
}

export function loadEntitlement(): string | null {
  try {
    if (!existsSync(licensePath()) || !safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(readFileSync(licensePath()))
  } catch {
    return null
  }
}

export function clearEntitlement(): void {
  try {
    if (existsSync(licensePath())) rmSync(licensePath())
  } catch {
    /* ignore */
  }
}

// --- iCloud CalDAV credentials: Apple ID + app-specific password, encrypted ---

export function saveICloud(json: string): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) return
    writeFileSync(icloudPath(), safeStorage.encryptString(json))
  } catch {
    /* ignore */
  }
}

export function loadICloud(): string | null {
  try {
    if (!existsSync(icloudPath()) || !safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(readFileSync(icloudPath()))
  } catch {
    return null
  }
}

export function clearICloud(): void {
  try {
    if (existsSync(icloudPath())) rmSync(icloudPath())
  } catch {
    /* ignore */
  }
}

// --- Google OAuth client (clientId/secret), pasted in-app, encrypted ---

export function saveGoogleCreds(json: string): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) return
    writeFileSync(googleCredsPath(), safeStorage.encryptString(json))
  } catch {
    /* ignore */
  }
}

export function loadGoogleCreds(): string | null {
  try {
    if (!existsSync(googleCredsPath()) || !safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(readFileSync(googleCredsPath()))
  } catch {
    return null
  }
}

// --- iCal/ICS subscription links (list of feed URLs), encrypted ---

export function saveIcalFeeds(json: string): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) return
    writeFileSync(icalPath(), safeStorage.encryptString(json))
  } catch {
    /* ignore */
  }
}

export function loadIcalFeeds(): string | null {
  try {
    if (!existsSync(icalPath()) || !safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(readFileSync(icalPath()))
  } catch {
    return null
  }
}

// --- Custom character: user-supplied idle/action/tray images (data URLs) ------

export type CustomCharacter = { idle: string; action: string; tray?: string; appIcon?: string }

export function saveCustomCharacter(c: CustomCharacter): void {
  try {
    writeFileSync(customIdlePath(), c.idle, 'utf8')
    writeFileSync(customActionPath(), c.action, 'utf8')
    if (c.tray) writeFileSync(customTrayPath(), c.tray, 'utf8')
    if (c.appIcon) writeFileSync(customAppIconPath(), c.appIcon, 'utf8')
  } catch {
    /* best-effort */
  }
}

export function loadCustomCharacter(): CustomCharacter | null {
  try {
    if (!existsSync(customIdlePath()) || !existsSync(customActionPath())) return null
    return {
      idle: readFileSync(customIdlePath(), 'utf8'),
      action: readFileSync(customActionPath(), 'utf8'),
      tray: existsSync(customTrayPath()) ? readFileSync(customTrayPath(), 'utf8') : undefined,
      appIcon: existsSync(customAppIconPath())
        ? readFileSync(customAppIconPath(), 'utf8')
        : undefined
    }
  } catch {
    return null
  }
}

export function loadCustomTray(): string | null {
  try {
    return existsSync(customTrayPath()) ? readFileSync(customTrayPath(), 'utf8') : null
  } catch {
    return null
  }
}

export function loadCustomAppIcon(): string | null {
  try {
    return existsSync(customAppIconPath()) ? readFileSync(customAppIconPath(), 'utf8') : null
  } catch {
    return null
  }
}

export function clearCustomCharacter(): void {
  for (const p of [customIdlePath(), customActionPath(), customTrayPath(), customAppIconPath()]) {
    try {
      if (existsSync(p)) rmSync(p)
    } catch {
      /* ignore */
    }
  }
}
