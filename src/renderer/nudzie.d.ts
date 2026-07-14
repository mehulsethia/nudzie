// Shared ambient types for the renderer side (the API exposed by the preload).
export {}

declare global {
  type Reminder = {
    id: string
    kind: 'calendar' | 'interval' | 'scheduled'
    message: string
    acceptLabel: string
    snoozeLabel: string
    snoozeMinutes: number
    character?: string
    idleUrl?: string
    actionUrl?: string
    sound?: boolean
  }

  type CustomCharacter = { idle: string; action: string; tray?: string; appIcon?: string }

  type Schedule = {
    type: 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly'
    time: string
    date?: string
    days?: number[]
    dayOfMonth?: number
    month?: number
    day?: number
  }
  type ScheduledReminder = {
    id: string
    title: string
    message: string
    schedule: Schedule
    character?: string
    enabled: boolean
    lastFired?: number
  }
  type NewScheduledReminder = {
    title: string
    message: string
    schedule: Schedule
    character?: string
  }

  type Prefs = {
    leadMinutes: number
    messageTemplate: string
    remindAtStart: boolean
    intervalEnabled: boolean
    activeStartHour: number
    activeEndHour: number
    intervalMinutes: number
    snoozeMinutes: number
    intervalMessage: string
    soundEnabled: boolean
    staySignedIn: boolean
    launchAtLogin: boolean
    dockIcon: boolean
    targetDisplay: 'cursor' | 'primary'
    character: string
  }

  type ProviderStatus = {
    id: string
    name: string
    connected: boolean
    detail: string | null
    configured: boolean
  }
  type UpcomingEvent = { id: string; title: string; start: number }
  type Feed = { id: string; name: string; url: string }
  type LicenseStatus = {
    premium: boolean
    active: boolean
    keyMasked: string | null
    expiresAt: number | null
    lastChecked: number | null
  }

  interface NudzieApi {
    // Overlay
    onReminder: (cb: (reminder: Reminder) => void) => () => void
    accept: (id: string, kind: string) => void
    snooze: (id: string, kind: string, minutes: number) => void
    hideOverlay: () => void
    // Settings
    getPrefs: () => Promise<Prefs>
    setPrefs: (patch: Partial<Prefs>) => Promise<Prefs>
    calStatus: () => Promise<ProviderStatus[]>
    calConnect: (
      provider: string,
      params?: { username?: string; password?: string }
    ) => Promise<ProviderStatus[]>
    calDisconnect: (provider: string) => Promise<ProviderStatus[]>
    calConfigure: (
      provider: string,
      params: { clientId?: string; clientSecret?: string }
    ) => Promise<ProviderStatus[]>
    icalList: () => Promise<Feed[]>
    icalAdd: (url: string, name?: string) => Promise<Feed[]>
    icalRemove: (id: string) => Promise<Feed[]>
    upcoming: () => Promise<UpcomingEvent[]>
    openExternal: (url: string) => Promise<void>
    testReminder: () => Promise<boolean>
    remindNow: () => Promise<boolean>
    // Scheduled reminders
    scheduledList: () => Promise<ScheduledReminder[]>
    scheduledAdd: (r: NewScheduledReminder) => Promise<ScheduledReminder[]>
    scheduledRemove: (id: string) => Promise<ScheduledReminder[]>
    scheduledSetEnabled: (id: string, enabled: boolean) => Promise<ScheduledReminder[]>
    // Custom character
    canCustomCharacter: () => Promise<boolean>
    getCustomCharacter: () => Promise<CustomCharacter | null>
    setCustomCharacter: (c: CustomCharacter) => Promise<Prefs>
    clearCustomCharacter: () => Promise<Prefs>
    // License / premium
    licenseStatus: () => Promise<LicenseStatus>
    licenseActivate: (key: string) => Promise<LicenseStatus>
    licenseDeactivate: () => Promise<LicenseStatus>
  }

  interface Window {
    nudzie: NudzieApi
  }
}
