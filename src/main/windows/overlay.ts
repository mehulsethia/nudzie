import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { getPrefs, loadCustomCharacter, loadCustomSound } from '../store'
import { isPremium, canUseAppearanceCustomizations, canUseCustomCharacter } from '../license'
import { applyAppIcon } from '../platform'

/**
 * Showing an always-on-top window can make macOS drop the app to "accessory"
 * (Dock icon disappears). Re-assert the Dock icon so the app stays reachable -
 * but only when the user actually wants a Dock icon. In menu-bar-only mode we
 * leave it hidden on purpose.
 */
function keepDockVisible(): void {
  if (process.platform !== 'darwin' || !app.dock) return
  if (!getPrefs().dockIcon) return
  void app.dock.show()
  // dock.show() reverts the icon to the bundle's own, so re-assert the character.
  applyAppIcon()
}

// Free-tier identities and the default. Kept in sync with the renderer registry
// (src/renderer/characters.ts) — the main process can't import it (Vite asset
// imports), so the authoritative free/Pro gate lives here.
const FREE_CHARACTERS = new Set(['male', 'female', 'androgynous'])
const DEFAULT_CHARACTER = 'androgynous'
// Bubble personalization free tiers (Pro unlocks locked themes/fonts/sounds).
// Keep in sync with src/renderer/appearance.ts.
const FREE_THEMES = new Set(['cream'])
const FREE_FONTS = new Set(['system'])
const FREE_SOUNDS = new Set(['chime'])

/** One reminder to show via the corner-walk character. */
export type Reminder = {
  id: string
  // Which trigger produced it (routes accept/snooze). 'summary' is the coalesced
  // "while you were away" catch-up nudge - acknowledge-only, no snooze.
  kind: 'calendar' | 'interval' | 'scheduled' | 'summary'
  // The reminder's name. Shown as the bubble's headline, with `message` beneath
  // it in smaller type. Calendar reminders have no separate title (their text is
  // built from the message template), so `message` becomes the headline instead.
  title?: string
  message: string
  // For 'summary': the list of missed reminders shown inside the bubble.
  items?: string[]
  acceptLabel: string
  snoozeLabel: string
  snoozeMinutes: number
  character?: string // Pro-gated; enforced here so the UI can't be bypassed
  // When the character is the user's custom one, the sprite data URLs travel in
  // the payload (the overlay renderer can't read them from disk directly).
  idleUrl?: string
  actionUrl?: string
  sound?: boolean
  // Bubble personalization (gated in showReminder where needed; free is pinned).
  bubbleTheme?: string
  bubbleBg?: string // custom bubble colour hex (Pro; used when bubbleTheme === 'custom')
  bubbleFont?: string
  soundChoice?: string // bundled sound id; custom is carried by soundUrl
  soundUrl?: string // custom sound data URL (Pro); overrides the default chime
}

// A corner window like Hydrate Buddy's: small, transparent, shown per reminder.
const WIN_WIDTH = 360
const WIN_HEIGHT = 440
const EDGE_MARGIN = 8

let overlay: BrowserWindow | null = null
let ready = false

// Only one character can be on screen at a time (single overlay window), so
// reminders are serialised through a FIFO queue. If one is already showing, the
// next waits and is drained when the character walks off (overlayDone), instead
// of being dropped or abruptly replacing the current one.
const queue: Reminder[] = []
let showing = false
let currentId: string | null = null
const MAX_QUEUE = 20

/**
 * Creates the transparent, frameless, always-on-top corner window the character
 * walks into. Created hidden; shown per reminder and hidden again when the
 * character walks off (unlike QuakPit's persistent full-screen overlay - we chose
 * the Hydrate Buddy per-reminder corner window so the accept/snooze buttons are
 * clickable). The window stays interactive (not click-through) so its buttons work.
 */
export function createOverlayWindow(): BrowserWindow {
  overlay = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    show: false,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    // macOS: a non-activating panel (NSPanel). Clicking a normal window's
    // buttons makes its app frontmost - which is why acknowledging a reminder
    // used to yank Nudzie forward and drag the settings window up with it.
    // A panel takes clicks WITHOUT activating the app, so Accept/Snooze no
    // longer steals focus from whatever the user was doing.
    //
    // This is the actual fix; suppressSettingsActivation() only ever blocked
    // openSettings(), and could never stop macOS raising a window that already
    // existed.
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  // Float above app windows on every space, including full-screen apps.
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  overlay.webContents.on('did-finish-load', () => {
    ready = true
    pump() // show anything queued before the renderer finished loading
  })

  // Hiding (not closing) keeps the pet ready for the next reminder.
  overlay.on('close', (e) => {
    if (!(app as unknown as { isQuiting?: boolean }).isQuiting) {
      e.preventDefault()
      overlay?.hide()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    overlay.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay/index.html`)
  } else {
    overlay.loadFile(join(__dirname, '../renderer/overlay/index.html'))
  }

  return overlay
}

/** Positions the window in the corner of the chosen display's work area. */
function positionCorner(): void {
  if (!overlay) return
  const display =
    getPrefs().targetDisplay === 'primary'
      ? screen.getPrimaryDisplay()
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { workArea } = display
  const x = workArea.x + workArea.width - WIN_WIDTH - EDGE_MARGIN
  const y = workArea.y + workArea.height - WIN_HEIGHT - EDGE_MARGIN
  overlay.setBounds({ x, y, width: WIN_WIDTH, height: WIN_HEIGHT })
}

function showNow(reminder: Reminder): void {
  if (!overlay || overlay.isDestroyed()) return
  positionCorner()
  overlay.showInactive() // appear without stealing keyboard focus
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.webContents.send('reminder:show', reminder)
  keepDockVisible()
}

/**
 * The `interval:<reminderId>:` prefix shared by every occurrence of one timer
 * reminder, or null for ids that aren't timer occurrences (calendar, scheduled,
 * the manual test nudge - all of which carry no reminder id to group by).
 */
function intervalSeries(id: string): string | null {
  const parts = id.split(':')
  return parts[0] === 'interval' && parts.length === 3 ? `interval:${parts[1]}:` : null
}

const isSameSeries = (id: string | null, series: string): boolean => id != null && id.startsWith(series)

/** Sends the next queued reminder to the overlay, if it's free and ready. */
function pump(): void {
  if (showing || !ready) return
  const next = queue.shift()
  if (!next) return
  showing = true
  currentId = next.id
  showNow(next)
}

/**
 * Queues one reminder. The character walks in, shows the message + buttons, and
 * - because reminders are serialised - anything that arrives while it's on
 * screen waits its turn instead of interrupting it.
 */
export function showReminder(reminder: Reminder): void {
  try {
    if (!overlay || overlay.isDestroyed()) createOverlayWindow()
    if (!overlay) return

    // Resolve the character with gating enforced here (so a tampered renderer
    // can't unlock Pro assets). Custom characters have their own feature flag.
    const prefs = getPrefs()
    const pro = isPremium()
    const appearanceUnlocked = canUseAppearanceCustomizations()
    const selected = reminder.character ?? prefs.character

    let character = DEFAULT_CHARACTER
    if (selected === 'custom' && canUseCustomCharacter()) character = 'custom'
    else if (appearanceUnlocked) character = selected
    else if (FREE_CHARACTERS.has(selected)) character = selected // any free identity

    const full: Reminder = {
      ...reminder,
      character,
      sound: reminder.sound ?? prefs.soundEnabled
    }

    // Attach the custom sprites (fall back to the default if they're missing).
    if (character === 'custom') {
      const custom = loadCustomCharacter()
      if (custom) {
        full.idleUrl = custom.idle
        full.actionUrl = custom.action
      } else {
        full.character = DEFAULT_CHARACTER
      }
    }

    // Bubble theme / font / sound - gated in the main process so a tampered
    // renderer can't unlock them.
    full.bubbleTheme = appearanceUnlocked || FREE_THEMES.has(prefs.bubbleTheme) ? prefs.bubbleTheme : 'cream'
    // Custom colour is Pro; bubbleTheme is only 'custom' here when appearance is unlocked.
    if (full.bubbleTheme === 'custom') full.bubbleBg = prefs.bubbleColor
    full.bubbleFont = appearanceUnlocked || FREE_FONTS.has(prefs.bubbleFont) ? prefs.bubbleFont : 'system'
    const soundId = appearanceUnlocked || FREE_SOUNDS.has(prefs.soundChoice) ? prefs.soundChoice : 'chime'
    full.soundChoice = soundId
    if (soundId === 'custom') {
      const clip = loadCustomSound()
      if (clip) full.soundUrl = clip // else: no clip → overlay plays the default chime
    }

    // De-dupe: don't queue (or re-queue) a reminder that's already showing or
    // waiting - e.g. a repeated snooze re-show of the same id.
    if (currentId === full.id || queue.some((r) => r.id === full.id)) return

    // Timer reminders also collapse across occurrences: each slot gets its own id
    // (`interval:<reminderId>:<ts>`), but a stale "drink water" nudge has no value
    // once an unacknowledged one is already on screen. Skip the new occurrence
    // rather than stacking one per slot while the user is away. Calendar and
    // scheduled reminders are distinct events, so they still queue individually.
    const series = intervalSeries(full.id)
    if (series && (isSameSeries(currentId, series) || queue.some((r) => isSameSeries(r.id, series)))) return
    if (queue.length >= MAX_QUEUE) return // guard against unbounded growth

    queue.push(full)
    pump()
  } catch (err) {
    console.error('[showReminder] failed (ignored):', err)
  }
}

/**
 * Called when the character has finished walking off (the renderer signals this
 * via the preload once its accept/snooze animation completes). Frees the overlay
 * and drains the next queued reminder, or hides the window if the queue is empty.
 */
export function overlayDone(): void {
  showing = false
  currentId = null
  if (queue.length === 0) {
    hideOverlay()
    return
  }
  pump()
}

/** Drops any waiting reminders (e.g. when the user pauses reminders). */
export function clearQueuedReminders(): void {
  queue.length = 0
}

/** Hides the corner window. */
export function hideOverlay(): void {
  if (overlay && !overlay.isDestroyed()) overlay.hide()
}
