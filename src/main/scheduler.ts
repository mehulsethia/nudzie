import {
  getPrefs,
  getScheduled,
  setScheduled,
  type Schedule,
  type ScheduledReminder
} from './store'
import { listUpcoming, type UpcomingEvent } from './calendar'
import { showReminder, clearQueuedReminders, type Reminder } from './windows/overlay'

// ---------------------------------------------------------------------------
// The scheduler drives BOTH reminder trigger types, and both route through the
// same corner-walk overlay (showReminder):
//   1. Calendar reminders  - from QuakPit: fires N minutes before meetings.
//   2. Interval reminders  - from Hydrate Buddy: fires every INTERVAL_MIN inside
//      active hours, for personal nudges (water, breaks, …).
// ---------------------------------------------------------------------------

let pollTimer: NodeJS.Timeout | null = null
let tickTimer: NodeJS.Timeout | null = null
const snoozeTimers = new Map<string, NodeJS.Timeout>()
const lastFired = new Map<string, Reminder>() // so a snooze can re-show the same one

let upcoming: UpcomingEvent[] = []
const fired = new Set<string>()
let paused = false

const POLL_MS = 60_000 // refresh the event window every minute
const TICK_MS = 15_000 // check calendar trigger times every 15s
const FIRE_WINDOW_MS = 90_000 // fire within 90s after the trigger time

// ---------------------------------------------------------------------------
// Catch-up on return (sleep/lock overnight, or the app was quit and reopened).
// One-off reminders and snoozes that come due while we're away would otherwise
// fire in a back-to-back burst the moment you return. Instead, anything firing
// more than LATE_SLACK_MS after its due time is treated as "missed while away":
// collected, and - after a short debounce so a whole batch lands together -
// shown as ONE acknowledge-only "while you were away" summary. Items older than
// STALE_MS are dropped as no longer relevant. Interval nudges (water/breaks) and
// calendar/recurring reminders already self-skip on return, so they're untouched.
const LATE_SLACK_MS = 120_000 // >2 min late ⇒ we were away, not normal operation
const STALE_MS = 12 * 60 * 60_000 // drop anything older than 12h
const FLUSH_DEBOUNCE_MS = 1_500 // wait this long for the rest of the batch
const MAX_SUMMARY_ITEMS = 6 // cap the list; the rest become "+N more"

type Missed = { message: string; dueAt: number }
let missed: Missed[] = []
let flushTimer: NodeJS.Timeout | null = null

/** True when `dueAt` is late enough (relative to `now`) to count as missed-while-away. */
export function isMissed(dueAt: number, now: number, lateSlackMs = LATE_SLACK_MS): boolean {
  return now - dueAt > lateSlackMs
}

/** True when `dueAt` is old enough to drop rather than surface. */
export function isStale(dueAt: number, now: number, staleMs = STALE_MS): boolean {
  return now - dueAt > staleMs
}

/** Cap the list, folding any overflow into a trailing "+N more" line. */
export function summarizeItems(items: string[], max = MAX_SUMMARY_ITEMS): string[] {
  if (items.length <= max) return items
  const shown = items.slice(0, max - 1)
  shown.push(`+${items.length - (max - 1)} more`)
  return shown
}

/** Collect a missed reminder into the pending batch (dropping stale ones). */
function collectMissed(message: string, dueAt: number): void {
  if (isStale(dueAt, Date.now())) return
  missed.push({ message, dueAt })
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(flushMissed, FLUSH_DEBOUNCE_MS) // re-arm so a whole batch coalesces
}

/** Show the collected batch as one acknowledge-only summary, or drop it if paused. */
function flushMissed(): void {
  flushTimer = null
  const batch = missed
  missed = []
  if (paused || batch.length === 0) return
  const items = summarizeItems(batch.sort((a, b) => a.dueAt - b.dueAt).map((m) => m.message))
  const summary: Reminder = {
    id: `summary:${Date.now()}`,
    kind: 'summary',
    message: 'While you were away',
    items,
    acceptLabel: 'Got it',
    snoozeLabel: '', // acknowledge-only - the renderer hides the snooze button
    snoozeMinutes: 0,
    sound: getPrefs().soundEnabled
  }
  showReminder(summary)
}

export function startScheduler(): void {
  stopScheduler()
  void refresh()
  pollTimer = setInterval(() => void refresh(), POLL_MS)
  tickTimer = setInterval(tick, TICK_MS)
  // Interval reminders are now list items, evaluated on each tick (see evalInterval).
}

export function stopScheduler(): void {
  if (pollTimer) clearInterval(pollTimer)
  if (tickTimer) clearInterval(tickTimer)
  pollTimer = null
  tickTimer = null
  for (const t of snoozeTimers.values()) clearTimeout(t)
  snoozeTimers.clear()
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  missed = []
}

export function getUpcoming(): UpcomingEvent[] {
  return upcoming
}

// --- Pause (tray control) --------------------------------------------------

export function setPaused(p: boolean): void {
  paused = p
  if (paused) {
    for (const t of snoozeTimers.values()) clearTimeout(t)
    snoozeTimers.clear()
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = null
    missed = [] // drop any collected catch-up items
    clearQueuedReminders() // drop anything waiting to appear
  }
  // Unpausing needs no re-arm: the tick evaluates interval + scheduled reminders.
}

export function isPaused(): boolean {
  return paused
}

// Snooze length is capped 1-59 min at the source (the settings UI clamps too,
// but a stale/hand-edited prefs.json shouldn't be able to exceed it).
const MAX_SNOOZE = 59
const clampSnooze = (m: number): number => Math.max(1, Math.min(MAX_SNOOZE, Math.round(m || 0)))

// Keep the on-screen banner readable: trim very long meeting titles with an
// ellipsis so they fit the corner window.
const MAX_TITLE = 48
const truncateTitle = (t: string): string =>
  t.length > MAX_TITLE ? t.slice(0, MAX_TITLE - 1).trimEnd() + '…' : t

// --- Calendar trigger (ported from QuakPit) --------------------------------

async function refresh(): Promise<void> {
  try {
    upcoming = await listUpcoming(60)
    const idList = upcoming.map((e) => e.id)
    for (const key of fired) {
      if (!idList.some((id) => key.startsWith(`${id}:`))) fired.delete(key)
    }
  } catch {
    /* offline / not connected - keep last known list */
  }
}

function tick(): void {
  if (paused) return
  const prefs = getPrefs()
  const now = Date.now()
  const lead = prefs.leadMinutes * 60_000

  for (const ev of upcoming) {
    // 1) The lead-time reminder (e.g. "Call with Jack in 5 minutes").
    const triggerAt = ev.start - lead
    const leadKey = `${ev.id}:${prefs.leadMinutes}`
    const leadDue = now >= triggerAt && now < triggerAt + FIRE_WINDOW_MS
    if (leadDue && ev.start > now && !fired.has(leadKey)) {
      fired.add(leadKey)
      const minutes = Math.max(1, Math.round((ev.start - now) / 60_000))
      const message = prefs.messageTemplate
        .replaceAll('{title}', truncateTitle(ev.title))
        .replaceAll('{minutes}', String(minutes))
      fireCalendar(leadKey, message)
    }

    // 2) Optional second nudge right at the start time ("… starting now").
    if (prefs.remindAtStart) {
      const startKey = `${ev.id}:start`
      const startDue = now >= ev.start && now < ev.start + FIRE_WINDOW_MS
      if (startDue && !fired.has(startKey)) {
        fired.add(startKey)
        fireCalendar(startKey, `${truncateTitle(ev.title)} starting now`)
      }
    }
  }

  evaluateScheduled(new Date())
}

// --- Scheduled trigger (once/daily/weekly/monthly/yearly) ------------------

// A recurring occurrence that we were closed for by more than this is skipped
// (we advance past it rather than firing hours late). One-off reminders always
// fire, even late, so a missed "remind me at 3pm" still shows when you return.
const SCHEDULED_CATCHUP_MS = 5 * 60_000

const daysInMonth = (year: number, monthIndex: number): number =>
  new Date(year, monthIndex + 1, 0).getDate()

function parseHM(time: string): { h: number; m: number } {
  const [h, m] = (time || '00:00').split(':').map((n) => parseInt(n, 10))
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 }
}

function at(base: Date, y: number, monthIndex: number, day: number, h: number, m: number): Date {
  return new Date(y, monthIndex, day, h, m, 0, 0)
}

/** The most recent scheduled occurrence at or before `now`, or null. */
function computePrevOccurrence(s: Schedule, now: Date): number | null {
  const { h, m } = parseHM(s.time)

  if (s.type === 'once') {
    if (!s.date) return null
    const [y, mo, d] = s.date.split('-').map((n) => parseInt(n, 10))
    if (!y || !mo || !d) return null
    const occ = at(now, y, mo - 1, d, h, m)
    return occ.getTime() <= now.getTime() ? occ.getTime() : null
  }

  if (s.type === 'daily') {
    const today = at(now, now.getFullYear(), now.getMonth(), now.getDate(), h, m)
    if (today.getTime() <= now.getTime()) return today.getTime()
    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    return at(y, y.getFullYear(), y.getMonth(), y.getDate(), h, m).getTime()
  }

  if (s.type === 'weekly') {
    const days = s.days ?? []
    if (days.length === 0) return null
    for (let off = 0; off <= 7; off++) {
      const d = new Date(now)
      d.setDate(d.getDate() - off)
      const occ = at(d, d.getFullYear(), d.getMonth(), d.getDate(), h, m)
      if (days.includes(occ.getDay()) && occ.getTime() <= now.getTime()) return occ.getTime()
    }
    return null
  }

  if (s.type === 'monthly') {
    const dom = s.dayOfMonth ?? 1
    const thisMonth = at(
      now,
      now.getFullYear(),
      now.getMonth(),
      Math.min(dom, daysInMonth(now.getFullYear(), now.getMonth())),
      h,
      m
    )
    if (thisMonth.getTime() <= now.getTime()) return thisMonth.getTime()
    const py = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
    const pm = now.getMonth() === 0 ? 11 : now.getMonth() - 1
    return at(now, py, pm, Math.min(dom, daysInMonth(py, pm)), h, m).getTime()
  }

  if (s.type === 'yearly') {
    const mo = (s.month ?? 1) - 1
    const day = s.day ?? 1
    const thisYear = at(now, now.getFullYear(), mo, Math.min(day, daysInMonth(now.getFullYear(), mo)), h, m)
    if (thisYear.getTime() <= now.getTime()) return thisYear.getTime()
    const py = now.getFullYear() - 1
    return at(now, py, mo, Math.min(day, daysInMonth(py, mo)), h, m).getTime()
  }

  return null
}

function evaluateScheduled(now: Date): void {
  const list = getScheduled()
  if (list.length === 0) return
  let changed = false

  for (const r of list) {
    if (!r.enabled) continue

    // Interval reminders repeat every N minutes inside their active window.
    if (r.schedule.type === 'interval') {
      if (evalInterval(r, now)) changed = true
      continue
    }

    const prev = computePrevOccurrence(r.schedule, now)
    if (prev == null) continue
    if ((r.lastFired ?? 0) >= prev) continue // already fired this occurrence

    const isOnce = r.schedule.type === 'once'
    const withinCatchup = isOnce || now.getTime() - prev <= SCHEDULED_CATCHUP_MS
    if (!withinCatchup) {
      // Recurring occurrence we were closed for - skip it, don't fire late.
      r.lastFired = prev
      changed = true
      continue
    }

    r.lastFired = prev
    if (isOnce) r.enabled = false // one-off: fire exactly once
    changed = true
    fireScheduled(r, prev)
  }

  if (changed) setScheduled(list)
}

function fireScheduled(r: ScheduledReminder, occ: number): void {
  const prefs = getPrefs()
  const message = r.message?.trim() || r.title

  // A one-off firing well after its time = missed while we were away. Coalesce it
  // into the "while you were away" summary instead of a solo late walk-in.
  // (Recurring occurrences we were away for are skipped upstream, so they never
  // reach here late.)
  if (r.schedule.type === 'once' && isMissed(occ, Date.now())) {
    collectMissed(message, occ)
    return
  }

  const reminder: Reminder = {
    id: `sched:${r.id}:${occ}`,
    kind: 'scheduled',
    message,
    acceptLabel: 'Got it',
    snoozeLabel: `+${clampSnooze(prefs.snoozeMinutes)}m`,
    snoozeMinutes: clampSnooze(prefs.snoozeMinutes),
    character: r.character,
    sound: prefs.soundEnabled
  }
  lastFired.set(reminder.id, reminder)
  showReminder(reminder)
}

function fireCalendar(id: string, message: string): void {
  const prefs = getPrefs()
  const reminder: Reminder = {
    id,
    kind: 'calendar',
    message,
    acceptLabel: 'Got it',
    snoozeLabel: `+${clampSnooze(prefs.snoozeMinutes)}m`,
    snoozeMinutes: clampSnooze(prefs.snoozeMinutes),
    sound: prefs.soundEnabled
  }
  lastFired.set(id, reminder)
  showReminder(reminder)
}

// --- Interval reminders (list items: repeat every N min inside active hours) ---

/**
 * Evaluate one interval reminder on the tick. Fires when it's inside its active
 * hour window and at least `everyMinutes` have elapsed since it last fired.
 * Returns true when `lastFired` changed (so the caller persists it).
 */
function evalInterval(r: ScheduledReminder, now: Date): boolean {
  const s = r.schedule
  const start = s.activeStartHour ?? 0
  const end = s.activeEndHour ?? 24
  const hour = now.getHours()
  if (hour < start || hour >= end) return false // outside the active window

  // Arm without firing the first time (e.g. right after enabling) so the first
  // nudge lands a full interval later, not immediately.
  if (r.lastFired == null) {
    r.lastFired = now.getTime()
    return true
  }

  const every = Math.max(1, s.everyMinutes ?? 60) * 60_000
  if (now.getTime() - r.lastFired < every) return false // not due yet

  r.lastFired = now.getTime()
  fireIntervalReminder(r)
  return true
}

function fireIntervalReminder(r: ScheduledReminder): void {
  const prefs = getPrefs()
  const reminder: Reminder = {
    id: `interval:${r.id}:${Date.now()}`,
    kind: 'interval',
    message: r.message?.trim() || r.title,
    acceptLabel: 'Done ✅',
    snoozeLabel: `+${clampSnooze(prefs.snoozeMinutes)}m`,
    snoozeMinutes: clampSnooze(prefs.snoozeMinutes),
    character: r.character,
    sound: prefs.soundEnabled
  }
  lastFired.set(reminder.id, reminder) // remembered so a snooze can re-show it
  showReminder(reminder)
}

/** The default personal-reminder payload used by the manual "Remind me now" nudge. */
function intervalReminder(): Reminder {
  const prefs = getPrefs()
  return {
    id: `interval:${Date.now()}`,
    kind: 'interval',
    message: prefs.intervalMessage,
    acceptLabel: 'Done ✅',
    snoozeLabel: `+${clampSnooze(prefs.snoozeMinutes)}m`,
    snoozeMinutes: clampSnooze(prefs.snoozeMinutes),
    sound: prefs.soundEnabled
  }
}

// --- Accept / snooze routing (called from ipc, driven by the overlay) ------

export function handleAccept(id: string, _kind: Reminder['kind']): void {
  // Interval reminders re-arm themselves on the tick (via lastFired), so accept
  // just clears any pending snooze and forgets the payload.
  snoozeCancel(id)
  lastFired.delete(id)
}

export function handleSnooze(id: string, _kind: Reminder['kind'], minutes: number): void {
  snoozeCancel(id)
  const mins = clampSnooze(minutes || getPrefs().snoozeMinutes)
  const reminder = lastFired.get(id)
  if (!reminder) return

  // A snooze is an explicit "remind me again in N minutes": it re-shows the SAME
  // reminder after exactly that delay, for every kind. The regular interval cadence
  // keeps running independently (it's driven by lastFired on the tick).
  const dueAt = Date.now() + mins * 60_000
  const t = setTimeout(() => {
    snoozeTimers.delete(id)
    if (paused) return
    // If the machine slept through the snooze, this re-show is "missed while
    // away" - coalesce it into the summary instead of a lone late walk-in.
    if (isMissed(dueAt, Date.now())) collectMissed(reminder.message, dueAt)
    else showReminder(reminder)
  }, mins * 60_000)
  snoozeTimers.set(id, t)
}

function snoozeCancel(id: string): void {
  const t = snoozeTimers.get(id)
  if (t) {
    clearTimeout(t)
    snoozeTimers.delete(id)
  }
}

// --- Manual triggers (tray / settings) -------------------------------------

/** "Remind me now": fire a one-off personal reminder without touching the cadence. */
export function remindNow(): void {
  const reminder = { ...intervalReminder(), id: `manual:${Date.now()}` }
  lastFired.set(reminder.id, reminder)
  showReminder(reminder)
}

/** A test reminder (tray + settings "trigger a test reminder"). */
export function triggerTestReminder(): void {
  const prefs = getPrefs()
  const reminder: Reminder = {
    id: `test:${Date.now()}`,
    kind: 'interval',
    message: 'Call with Jack in 5 minutes',
    acceptLabel: 'Got it',
    snoozeLabel: `+${clampSnooze(prefs.snoozeMinutes)}m`,
    snoozeMinutes: clampSnooze(prefs.snoozeMinutes),
    sound: prefs.soundEnabled
  }
  lastFired.set(reminder.id, reminder)
  showReminder(reminder)
}
