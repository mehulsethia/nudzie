import { CHARACTERS, characterById } from '../characters'
import { BUBBLE_THEMES, BUBBLE_FONTS, SOUND_OPTIONS, fontById, themeById, inkForBg, CUSTOM_BUBBLE_DEFAULT } from '../appearance'
import { processCharacterImage, makeTrayFromIdle, makeAppIconFromIdle } from './bg-remove'
import { playSound } from '../sounds'

const q = window.nudzie
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

// Copy-paste AI prompts for "make your own character".
const IDLE_PROMPT =
  'Full-body pixel-art character, front view, standing and smiling, arms relaxed at their sides, hands empty. [DESCRIBE YOUR CHARACTER — e.g. a young man with short black hair, round glasses, a navy hoodie and grey joggers, brown sneakers]. Clean, detailed pixel-art style with soft shading; friendly and wholesome. Plain solid pale-blue background, a subtle soft shadow under the feet, the character centered with empty space all around. No text, no frame, no border.'
const ACTION_PROMPT =
  'Using the attached/previous image as the reference, keep the exact same character — [DESCRIBE YOUR CHARACTER AGAIN BRIEFLY]. Now show them holding up a small bell in one hand or paw, giving it a cheerful ring, with a bright, alert, friendly expression as if they\'ve just remembered something for you. Same clean pixel-art style, same plain solid pale-blue background, same soft shadow under the feet. Full body, centered, with empty space around them. No text, no frame, no border.'

// Serverless checkout creation redirects to Dodo when configured; if env vars
// are missing, it shows a friendly website fallback instead of failing silently.
const CHECKOUT_URL = 'https://nudzie.app/api/create-checkout?source=app&redirect=1'

let prefs = {} as Prefs
let isPro = false
let hasCustom = false
let customIdleUrl: string | null = null // stored custom idle sprite (for its tile)
let processedIdle: string | null = null
let processedAction: string | null = null
const APPEARANCE_CUSTOMIZATIONS_FREE_FOR_TESTING = false
const canUseAppearanceCustomizations = (): boolean =>
  APPEARANCE_CUSTOMIZATIONS_FREE_FOR_TESTING || isPro

// ---- "Try before you buy": non-Pro live preview of locked Pro options ----
// A non-Pro user can tap a locked theme/font/sound/character to see it in the
// preview above. These overrides are ONLY read when rendering the preview; they
// are NEVER written to prefs via setPrefs, so real reminders keep using the free
// defaults until the license is activated. (The main process also pins Pro
// values to free defaults — see src/main/windows/overlay.ts — so a preview can
// never leak into an actual reminder.)
const preview = { theme: null as string | null, font: null as string | null, char: null as string | null, color: null as string | null }
// A non-Pro user can also upload their own character and see it in the preview
// (the processed sprite lives in `processedIdle`); this flag just tracks that a
// custom upload is being previewed so the "preview only" note shows.
let previewingCustom = false
const clearPreview = (): void => {
  preview.theme = null
  preview.font = null
  preview.char = null
  preview.color = null
  previewingCustom = false
}
const anyPreview = (): boolean => !!(preview.theme || preview.font || preview.char || previewingCustom)
const effTheme = (): string => preview.theme ?? prefs.bubbleTheme
const effFont = (): string => preview.font ?? prefs.bubbleFont
const effColor = (): string => preview.color ?? prefs.bubbleColor ?? CUSTOM_BUBBLE_DEFAULT

// Lazily-created AudioContext so previewing a locked sound actually plays it.
let audioCtx: AudioContext | null = null
function playPreviewSound(id: string): void {
  if (!id || id === 'custom') return // 'custom' has no bundled clip to preview
  try {
    audioCtx = audioCtx ?? new AudioContext()
    void audioCtx.resume()
    playSound(audioCtx, id)
  } catch {
    /* audio may be unavailable; a silent preview is fine */
  }
}

// ---- Tabs ----
const navItems = Array.from(document.querySelectorAll<HTMLButtonElement>('.nav-item'))
const panels = Array.from(document.querySelectorAll<HTMLElement>('.panel'))
function showTab(id: string): void {
  navItems.forEach((n) => n.classList.toggle('active', n.dataset.tab === id))
  panels.forEach((p) => p.classList.toggle('active', p.dataset.panel === id))
}
navItems.forEach((n) => n.addEventListener('click', () => showTab(n.dataset.tab as string)))

// Appearance sub-tabs (Character / Bubble / Font / Sound)
Array.from(document.querySelectorAll<HTMLButtonElement>('.subtab')).forEach((t) =>
  t.addEventListener('click', () => {
    const s = t.dataset.sub
    document.querySelectorAll<HTMLElement>('.subtab').forEach((x) => x.classList.toggle('active', x === t))
    document.querySelectorAll<HTMLElement>('.subpanel').forEach((p) =>
      p.classList.toggle('active', p.dataset.sub === s)
    )
  })
)

// ---- General ----
const lead = $<HTMLInputElement>('lead')
const template = $<HTMLInputElement>('template')
const remindAtStart = $<HTMLInputElement>('remindAtStart')
const sound = $<HTMLInputElement>('sound')
const login = $<HTMLInputElement>('login')
const dockIcon = $<HTMLInputElement>('dockIcon')
const stay = $<HTMLInputElement>('stay')
const display = $<HTMLSelectElement>('display')
const appearanceBubble = $('appearance-bubble')
const appearancePreviewText = $('appearance-preview-text')
const appearancePreviewSprite = $<HTMLImageElement>('appearance-preview-sprite')
const appearancePreviewSnooze = $<HTMLButtonElement>('appearance-preview-snooze')

function previewMessage(): string {
  const raw = prefs?.messageTemplate || 'Call with {title} in {minutes} minutes'
  return raw
    .replaceAll('{title}', 'Jack')
    .replaceAll('{minutes}', '5')
    .trim() || 'Call with Jack in 5 minutes'
}

function currentPreviewSprite(): string {
  if (preview.char) return characterById(preview.char).idle // Pro character being previewed
  if (processedIdle) return processedIdle
  if (prefs?.character === 'custom' && customIdleUrl) return customIdleUrl
  return characterById(prefs?.character).idle
}

function updateAppearancePreview(): void {
  if (!prefs) return
  const themeId = effTheme()
  const isCustom = themeId === 'custom'
  const bg = isCustom ? effColor() : themeById(themeId).bg
  const ink = isCustom ? inkForBg(effColor()) : themeById(themeId).ink
  const font = fontById(effFont())
  appearanceBubble.style.setProperty('--preview-bubble-bg', bg)
  appearanceBubble.style.setProperty('--preview-bubble-ink', ink)
  appearanceBubble.style.setProperty('--preview-bubble-font', font.family)
  appearancePreviewText.textContent = previewMessage()
  appearancePreviewSnooze.textContent = `+${Math.max(1, Math.min(59, prefs.snoozeMinutes || 15))}m`
  appearancePreviewSprite.src = currentPreviewSprite()
}

lead.addEventListener('change', () => void q.setPrefs({ leadMinutes: Number(lead.value) }))
template.addEventListener('input', () => {
  if (prefs) prefs.messageTemplate = template.value
  updateAppearancePreview()
})
template.addEventListener('change', async () => {
  prefs = await q.setPrefs({ messageTemplate: template.value })
  updateAppearancePreview()
})
remindAtStart.addEventListener('change', () => void q.setPrefs({ remindAtStart: remindAtStart.checked }))
sound.addEventListener('change', () => void q.setPrefs({ soundEnabled: sound.checked }))
login.addEventListener('change', () => void q.setPrefs({ launchAtLogin: login.checked }))
dockIcon.addEventListener('change', () => void q.setPrefs({ dockIcon: dockIcon.checked }))
stay.addEventListener('change', () => void q.setPrefs({ staySignedIn: stay.checked }))
display.addEventListener('change', () =>
  void q.setPrefs({ targetDisplay: display.value as Prefs['targetDisplay'] })
)

Array.from(document.querySelectorAll<HTMLButtonElement>('.tag-btn')).forEach((b) =>
  b.addEventListener('click', () => {
    const token = b.dataset.token ?? ''
    const start = template.selectionStart ?? template.value.length
    const end = template.selectionEnd ?? template.value.length
    template.value = template.value.slice(0, start) + token + template.value.slice(end)
    template.focus()
    const pos = start + token.length
    template.setSelectionRange(pos, pos)
    if (prefs) prefs.messageTemplate = template.value
    updateAppearancePreview()
    void q.setPrefs({ messageTemplate: template.value })
  })
)

$<HTMLButtonElement>('test-btn').addEventListener('click', () => void q.testReminder())
$<HTMLButtonElement>('side-test-btn').addEventListener('click', () => void q.testReminder())

// ---- Snooze length (global, applies to every reminder) ----
const snoozeMinutes = $<HTMLInputElement>('snoozeMinutes')

// ---- Reminders (interval + scheduled, one unified list) ----
const remList = $<HTMLUListElement>('rem-list')
const schedForm = $('sched-form')
const schFormTitle = $('sched-form-title')
const schCancel = $<HTMLButtonElement>('sch-cancel')
let scheduledCache: ScheduledReminder[] = []
let editingId: string | null = null // reminder currently being edited
const schTitle = $<HTMLInputElement>('sch-title')
const schMessage = $<HTMLInputElement>('sch-message')
const schType = $<HTMLSelectElement>('sch-type')
const schTime = $<HTMLInputElement>('sch-time')
const schTimeWrap = $('sch-time-wrap')
const schDate = $<HTMLInputElement>('sch-date')
const schDom = $<HTMLInputElement>('sch-dom')
const schMonth = $<HTMLSelectElement>('sch-month')
const schYDay = $<HTMLInputElement>('sch-yday')
const schEvery = $<HTMLInputElement>('sch-every')
const schActiveStart = $<HTMLInputElement>('sch-active-start')
const schActiveEnd = $<HTMLInputElement>('sch-active-end')
const rowInterval = $('sch-interval-row')
const schAdd = $<HTMLButtonElement>('sch-add')
const schError = document.getElementById('sch-error') as HTMLElement
const schDaysEl = $('sch-days')
const rowOnce = $('sch-once-row')
const rowWeekly = $('sch-weekly-row')
const rowMonthly = $('sch-monthly-row')
const rowYearly = $('sch-yearly-row')

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
const selectedDays = new Set<number>()

// Populate the month dropdown + day toggle buttons once.
MONTH_NAMES.forEach((name, i) => {
  const opt = document.createElement('option')
  opt.value = String(i + 1)
  opt.textContent = name
  schMonth.append(opt)
})
DAY_NAMES.forEach((name, i) => {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'day-toggle'
  b.textContent = name
  b.addEventListener('click', () => {
    if (selectedDays.has(i)) selectedDays.delete(i)
    else selectedDays.add(i)
    b.classList.toggle('on', selectedDays.has(i))
  })
  schDaysEl.append(b)
})

function updateSchRows(): void {
  const t = schType.value
  rowOnce.classList.toggle('hidden', t !== 'once')
  rowWeekly.classList.toggle('hidden', t !== 'weekly')
  rowMonthly.classList.toggle('hidden', t !== 'monthly')
  rowYearly.classList.toggle('hidden', t !== 'yearly')
  rowInterval.classList.toggle('hidden', t !== 'interval')
  schTimeWrap.classList.toggle('hidden', t === 'interval') // interval has no clock time
}
schType.addEventListener('change', updateSchRows)

const pad2 = (n: number): string => String(n).padStart(2, '0')

function describeSchedule(s: Schedule): string {
  const t = s.time
  switch (s.type) {
    case 'interval': {
      const start = s.activeStartHour ?? 0
      const end = s.activeEndHour ?? 24
      return `Every ${s.everyMinutes ?? 60} min · active ${pad2(start)}:00-${pad2(end)}:00`
    }
    case 'once':
      return `Once · ${s.date ?? ''} at ${t}`
    case 'daily':
      return `Daily at ${t}`
    case 'weekly': {
      const names = (s.days ?? []).slice().sort().map((d) => DAY_NAMES[d]).join(', ')
      return `Weekly on ${names || '-'} at ${t}`
    }
    case 'monthly':
      return `Monthly on day ${s.dayOfMonth ?? 1} at ${t}`
    case 'yearly':
      return `Yearly on ${MONTH_NAMES[(s.month ?? 1) - 1]} ${s.day ?? 1} at ${t}`
  }
}

/** A pixel-style on/off toggle switch. */
function makeSwitch(checked: boolean, onChange: (on: boolean) => void): HTMLElement {
  const label = document.createElement('label')
  label.className = 'switch'
  label.title = 'Enabled'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = checked
  const track = document.createElement('span')
  track.className = 'track'
  input.addEventListener('change', () => onChange(input.checked))
  label.append(input, track)
  return label
}

function smallBtn(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = 'btn btn-outline btn-sm'
  b.textContent = text
  b.addEventListener('click', onClick)
  return b
}

/** One reminder card (interval or scheduled - all uniform now). */
function scheduledCard(r: ScheduledReminder): HTMLElement {
  const li = document.createElement('li')
  li.className = 'rem-item' + (r.enabled ? '' : ' off') + (editingId === r.id ? ' editing' : '')

  const meta = document.createElement('div')
  meta.className = 'rem-meta'
  const title = document.createElement('span')
  title.className = 'rem-title'
  title.textContent = r.title
  const desc = document.createElement('span')
  desc.className = 'rem-desc'
  desc.textContent = describeSchedule(r.schedule)
  meta.append(title, desc)

  const actions = document.createElement('div')
  actions.className = 'item-actions'
  actions.append(
    makeSwitch(r.enabled, async (on) => {
      scheduledCache = await q.scheduledSetEnabled(r.id, on)
      renderReminders()
    }),
    smallBtn('Edit', () => loadSchedIntoForm(r)),
    smallBtn('Remove', async () => {
      scheduledCache = await q.scheduledRemove(r.id)
      if (editingId === r.id) resetSchedForm()
      renderReminders()
    })
  )

  li.append(meta, actions)
  return li
}

/** Rebuild the unified reminders list. */
function renderReminders(): void {
  remList.innerHTML = ''
  if (scheduledCache.length === 0) {
    const li = document.createElement('li')
    li.className = 'muted small'
    li.textContent = 'No reminders yet. Add one below.'
    remList.append(li)
    return
  }
  for (const r of scheduledCache) remList.append(scheduledCard(r))
}

// ---- Reminder form: edit vs add ----
function loadSchedIntoForm(r: ScheduledReminder): void {
  editingId = r.id
  const s = r.schedule
  schTitle.value = r.title
  schMessage.value = r.message ?? ''
  schType.value = s.type
  schTime.value = s.type === 'interval' ? '09:00' : s.time || '09:00'
  schDate.value = s.type === 'once' ? (s.date ?? '') : ''
  schDom.value = String(s.type === 'monthly' ? (s.dayOfMonth ?? 1) : 1)
  schMonth.value = String(s.type === 'yearly' ? (s.month ?? 1) : 1)
  schYDay.value = String(s.type === 'yearly' ? (s.day ?? 1) : 1)
  schEvery.value = String(s.type === 'interval' ? (s.everyMinutes ?? 60) : 60)
  schActiveStart.value = String(s.type === 'interval' ? (s.activeStartHour ?? 10) : 10)
  schActiveEnd.value = String(s.type === 'interval' ? (s.activeEndHour ?? 19) : 19)
  selectedDays.clear()
  Array.from(schDaysEl.children).forEach((el, i) => {
    const on = s.type === 'weekly' && (s.days ?? []).includes(i)
    el.classList.toggle('on', on)
    if (on) selectedDays.add(i)
  })
  updateSchRows()
  hide(schError)
  schFormTitle.textContent = 'Edit reminder'
  schAdd.textContent = 'Save changes'
  schCancel.classList.remove('hidden')
  renderReminders() // reflect the "editing" highlight
  schedForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function resetSchedForm(): void {
  editingId = null
  schTitle.value = ''
  schMessage.value = ''
  schType.value = 'once'
  schTime.value = '09:00'
  schDate.value = ''
  schDom.value = '1'
  schMonth.value = '1'
  schYDay.value = '1'
  schEvery.value = '60'
  schActiveStart.value = '10'
  schActiveEnd.value = '19'
  selectedDays.clear()
  Array.from(schDaysEl.children).forEach((el) => el.classList.remove('on'))
  updateSchRows()
  hide(schError)
  schFormTitle.textContent = 'Add a reminder'
  schAdd.textContent = 'Add reminder'
  schCancel.classList.add('hidden')
  renderReminders()
}
schCancel.addEventListener('click', resetSchedForm)

schAdd.addEventListener('click', async () => {
  schError.classList.add('hidden')
  const title = schTitle.value.trim()
  const time = schTime.value || '09:00'
  const type = schType.value as Schedule['type']
  if (!title) return fail('Give your reminder a title.')

  const schedule: Schedule = { type, time }
  if (type === 'interval') {
    const start = clampHour(schActiveStart.value)
    const end = clampHour(schActiveEnd.value)
    if (start >= end) return fail('Active "from" must be earlier than "until".')
    schedule.everyMinutes = Math.max(1, Math.min(600, Number(schEvery.value) || 60))
    schedule.activeStartHour = start
    schedule.activeEndHour = end
    schedule.time = ''
  } else if (type === 'once') {
    if (!schDate.value) return fail('Pick a date for a one-off reminder.')
    schedule.date = schDate.value
  } else if (type === 'weekly') {
    if (selectedDays.size === 0) return fail('Pick at least one day of the week.')
    schedule.days = [...selectedDays].sort()
  } else if (type === 'monthly') {
    schedule.dayOfMonth = Math.max(1, Math.min(31, Number(schDom.value) || 1))
  } else if (type === 'yearly') {
    schedule.month = Number(schMonth.value) || 1
    schedule.day = Math.max(1, Math.min(31, Number(schYDay.value) || 1))
  }

  schAdd.disabled = true
  try {
    // Editing = replace the old entry (no backend "update", so remove + re-add),
    // preserving its enabled state.
    let wasEnabled = true
    if (editingId) {
      wasEnabled = scheduledCache.find((x) => x.id === editingId)?.enabled ?? true
      await q.scheduledRemove(editingId)
    }
    scheduledCache = await q.scheduledAdd({ title, message: schMessage.value.trim(), schedule })
    if (!wasEnabled) {
      const added = scheduledCache[scheduledCache.length - 1]
      if (added) scheduledCache = await q.scheduledSetEnabled(added.id, false)
    }
    resetSchedForm() // clears fields, exits edit mode, re-renders the list
  } finally {
    schAdd.disabled = false
  }

  function fail(msg: string): void {
    schError.textContent = msg
    schError.classList.remove('hidden')
  }
})
snoozeMinutes.addEventListener('change', async () => {
  const v = Math.max(1, Math.min(59, Number(snoozeMinutes.value) || 1))
  snoozeMinutes.value = String(v) // reflect the clamp back into the field
  prefs = await q.setPrefs({ snoozeMinutes: v })
  updateAppearancePreview()
})
const clampHour = (v: string): number => Math.max(0, Math.min(23, Number(v) || 0))

// ---- Characters ----
const charactersEl = $('characters')
function renderCharacters(): void {
  charactersEl.innerHTML = ''
  const unlocked = canUseAppearanceCustomizations()
  for (const c of CHARACTERS) {
    const locked = !c.free && !unlocked
    const selected = prefs.character === c.id && !preview.char
    const previewing = preview.char === c.id
    const tile = document.createElement('button')
    tile.className =
      'tile' + (selected ? ' selected' : '') + (previewing ? ' previewing' : '') + (locked ? ' locked' : '')
    const img = document.createElement('img')
    img.src = c.idle
    const name = document.createElement('span')
    name.className = 'tile-name'
    name.textContent = c.name
    tile.append(img, name)
    if (locked) {
      const lk = document.createElement('span')
      lk.className = 'lock'
      lk.textContent = '🔒'
      tile.append(lk)
    }
    tile.addEventListener('click', () => {
      if (locked) {
        // Preview only — don't save. Real reminders keep the free default.
        preview.char = c.id
        renderCharacters()
        refreshPreviewNote()
        return
      }
      preview.char = null
      prefs.character = c.id
      prefs.characterChosen = true
      void q.setPrefs({ character: c.id, characterChosen: true })
      renderCharacters()
      refreshPreviewNote()
      updateAppearancePreview()
    })
    charactersEl.append(tile)
  }

  // The user's custom character (if any) gets its own selectable tile.
  if (hasCustom && customIdleUrl) {
    const selected = prefs.character === 'custom' && !preview.char
    const tile = document.createElement('button')
    tile.className = 'tile' + (selected ? ' selected' : '')
    const img = document.createElement('img')
    img.src = customIdleUrl
    const name = document.createElement('span')
    name.className = 'tile-name'
    name.textContent = 'Yours'
    tile.append(img, name)
    tile.addEventListener('click', () => {
      preview.char = null
      prefs.character = 'custom'
      prefs.characterChosen = true
      void q.setPrefs({ character: 'custom', characterChosen: true })
      renderCharacters()
      refreshPreviewNote()
      updateAppearancePreview()
    })
    charactersEl.append(tile)
  }
  updateAppearancePreview()
}

// ---- Custom character ("make your own") ----
const customPanel = $('custom-panel')
const customLocked = $('custom-locked')
const customProTag = $('custom-pro-tag')
const upIdle = $<HTMLInputElement>('up-idle')
const upAction = $<HTMLInputElement>('up-action')
const prevIdle = $('prev-idle')
const prevAction = $('prev-action')
const customError = $('custom-error')
const customSave = $<HTMLButtonElement>('custom-save')
const customRemove = $<HTMLButtonElement>('custom-remove')

function copyToClipboard(text: string, btn: HTMLButtonElement): void {
  void navigator.clipboard.writeText(text).then(() => {
    const old = btn.textContent
    btn.textContent = 'Copied!'
    setTimeout(() => (btn.textContent = old), 1200)
  })
}
$<HTMLButtonElement>('copy-idle-prompt').addEventListener('click', (e) => {
  e.preventDefault()
  copyToClipboard(IDLE_PROMPT, e.currentTarget as HTMLButtonElement)
})
$<HTMLButtonElement>('copy-action-prompt').addEventListener('click', (e) => {
  e.preventDefault()
  copyToClipboard(ACTION_PROMPT, e.currentTarget as HTMLButtonElement)
})

function setPreview(el: HTMLElement, dataUrl: string): void {
  el.innerHTML = ''
  const img = document.createElement('img')
  img.src = dataUrl
  el.append(img)
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 // 5 MB

async function onUpload(input: HTMLInputElement, target: HTMLElement, which: 'idle' | 'action'): Promise<void> {
  const file = input.files?.[0]
  if (!file) return
  hide(customError)
  if (!file.type.startsWith('image/')) {
    customError.textContent = 'Please choose an image file (PNG, JPG or WebP).'
    show(customError)
    input.value = ''
    return
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1)
    customError.textContent = `That image is ${mb} MB - please use one under 5 MB.`
    show(customError)
    input.value = ''
    return
  }
  target.classList.add('processing')
  try {
    const processed = await processCharacterImage(file)
    if (which === 'idle') processedIdle = processed
    else processedAction = processed
    setPreview(target, processed)
    // The processed idle sprite now drives the big preview (see
    // currentPreviewSprite). For non-Pro, flag it so the "preview only" note shows.
    if (!canUseAppearanceCustomizations() && processedIdle) {
      previewingCustom = true
      refreshPreviewNote()
    }
    updateAppearancePreview()
  } catch (err) {
    customError.textContent = (err as Error).message
    show(customError)
  } finally {
    target.classList.remove('processing')
    customSave.disabled = !(processedIdle && processedAction)
  }
}
upIdle.addEventListener('change', () => void onUpload(upIdle, prevIdle, 'idle'))
upAction.addEventListener('change', () => void onUpload(upAction, prevAction, 'action'))

customSave.addEventListener('click', async () => {
  if (!processedIdle || !processedAction) return
  // Non-Pro: the character is already previewing above; keeping it needs Pro.
  if (!canUseAppearanceCustomizations()) {
    previewingCustom = true
    refreshPreviewNote(true)
    showTab('pro')
    return
  }
  hide(customError)
  customSave.disabled = true
  try {
    const tray = await makeTrayFromIdle(processedIdle)
    const appIcon = await makeAppIconFromIdle(processedIdle)
    prefs = await q.setCustomCharacter({
      idle: processedIdle,
      action: processedAction,
      tray,
      appIcon
    })
    customIdleUrl = processedIdle
    hasCustom = true
    show(customRemove)
    renderCharacters()
    updateAppearancePreview()
  } catch (err) {
    customError.textContent = (err as Error).message
    show(customError)
  } finally {
    customSave.disabled = !(processedIdle && processedAction)
  }
})

customRemove.addEventListener('click', async () => {
  prefs = await q.clearCustomCharacter()
  hasCustom = false
  customIdleUrl = null
  processedIdle = null
  processedAction = null
  previewingCustom = false
  refreshPreviewNote()
  prevIdle.innerHTML = ''
  prevAction.innerHTML = ''
  upIdle.value = ''
  upAction.value = ''
  customSave.disabled = true
  hide(customRemove)
  renderCharacters()
  updateAppearancePreview()
})

$('custom-upsell').addEventListener('click', (e) => {
  e.preventDefault()
  showTab('pro')
})

async function initCustom(): Promise<void> {
  const canCustom = await q.canCustomCharacter()
  // Always show the upload panel + AI-prompt recipe, even for non-Pro users:
  // they can build and PREVIEW their own character to decide if it's worth
  // buying. Only saving/using it (customSave) is gated — see its handler.
  customPanel.classList.remove('hidden')
  customLocked.classList.toggle('hidden', canCustom) // "preview free, Pro to keep" note
  customProTag.classList.toggle('hidden', canCustom) // show PRO tag only when gated
  applyCustomSaveMode(canCustom)
  const existing = await q.getCustomCharacter()
  if (existing) {
    hasCustom = true
    customIdleUrl = existing.idle
    setPreview(prevIdle, existing.idle)
    setPreview(prevAction, existing.action)
    show(customRemove)
  }
  renderCharacters()
  updateAppearancePreview()
}

// The "Use this character" button applies+saves for Pro; for non-Pro it becomes
// an upsell (the character is already previewing above — keeping it needs Pro).
function applyCustomSaveMode(canCustom: boolean): void {
  customSave.textContent = canCustom ? 'Use this character' : 'Activate Pro to use this →'
}

// ---- Appearance extras: bubble theme, message font, sound (all Pro) ----
const themesEl = $('themes')
const fontsEl = $('fonts')
const soundsEl = $('sounds')
const upSound = $<HTMLInputElement>('up-sound')
const soundError = $('sound-error')
const apprProBadges = Array.from(document.querySelectorAll<HTMLElement>('.appr-pro'))
let hasCustomSound = false

function apprTile(o: {
  name: string
  selected: boolean
  previewing?: boolean
  locked: boolean
  fill: (tile: HTMLElement) => void
  onClick: () => void
}): HTMLElement {
  const tile = document.createElement('button')
  tile.className =
    'tile' + (o.selected ? ' selected' : '') + (o.previewing ? ' previewing' : '') + (o.locked ? ' locked' : '')
  o.fill(tile)
  const name = document.createElement('span')
  name.className = 'tile-name'
  name.textContent = o.name
  tile.append(name)
  if (o.locked) {
    const lk = document.createElement('span')
    lk.className = 'lock'
    lk.textContent = '🔒'
    tile.append(lk)
  }
  tile.addEventListener('click', o.onClick)
  return tile
}

// Opens the OS colour picker for the custom bubble colour. Pro applies+saves;
// non-Pro only previews it (never persisted — real reminders stay on the free
// default, also enforced in the main process).
function pickCustomColor(locked: boolean): void {
  const input = document.createElement('input')
  input.type = 'color'
  input.value = (locked ? preview.color : prefs.bubbleColor) || CUSTOM_BUBBLE_DEFAULT
  input.style.cssText = 'position:fixed;left:-9999px;opacity:0'
  document.body.appendChild(input)
  input.addEventListener('input', () => {
    if (locked) {
      preview.theme = 'custom'
      preview.color = input.value
      renderAppearance()
    } else {
      preview.theme = null
      preview.color = null
      prefs.bubbleTheme = 'custom'
      prefs.bubbleColor = input.value
      void q.setPrefs({ bubbleTheme: 'custom', bubbleColor: input.value })
      renderAppearance()
    }
  })
  input.addEventListener('change', () => input.remove())
  input.click()
}

function renderAppearance(): void {
  const unlocked = canUseAppearanceCustomizations()
  apprProBadges.forEach((b) => b.classList.toggle('hidden', unlocked))

  themesEl.innerHTML = ''
  for (const t of BUBBLE_THEMES) {
    const locked = !t.free && !unlocked
    themesEl.append(
      apprTile({
        name: t.name,
        selected: prefs.bubbleTheme === t.id && !preview.theme,
        previewing: preview.theme === t.id,
        locked,
        fill: (tile) => {
          const sw = document.createElement('span')
          sw.className = 'swatch'
          sw.style.background = t.bg
          tile.append(sw)
        },
        onClick: () => {
          if (locked) {
            preview.theme = t.id // preview only — not saved
            renderAppearance()
            return
          }
          preview.theme = null
          prefs.bubbleTheme = t.id
          void q.setPrefs({ bubbleTheme: t.id })
          renderAppearance()
        }
      })
    )
  }

  // Custom colour (Pro): pick any hex. Non-Pro can preview it; keeping it needs Pro.
  {
    const locked = !unlocked
    const selected = prefs.bubbleTheme === 'custom' && !preview.theme
    const previewing = preview.theme === 'custom'
    themesEl.append(
      apprTile({
        name: 'Any colour',
        selected,
        previewing,
        locked,
        fill: (tile) => {
          const sw = document.createElement('span')
          sw.className = 'swatch'
          // Show the chosen colour when active, else a rainbow to signal "any colour".
          sw.style.background =
            selected || previewing
              ? effColor()
              : 'conic-gradient(from 0deg,#f5c4e6,#b9e3ff,#bfe9cc,#fff1a8,#ffb27a,#f5c4e6)'
          tile.append(sw)
        },
        onClick: () => pickCustomColor(locked)
      })
    )
  }

  fontsEl.innerHTML = ''
  for (const f of BUBBLE_FONTS) {
    const locked = !f.free && !unlocked
    fontsEl.append(
      apprTile({
        name: f.name,
        selected: prefs.bubbleFont === f.id && !preview.font,
        previewing: preview.font === f.id,
        locked,
        fill: (tile) => {
          const p = document.createElement('span')
          p.className = 'fontprev'
          p.style.fontFamily = f.family
          p.textContent = 'Aa'
          tile.append(p)
        },
        onClick: () => {
          if (locked) {
            preview.font = f.id // preview only — not saved
            renderAppearance()
            return
          }
          preview.font = null
          prefs.bubbleFont = f.id
          void q.setPrefs({ bubbleFont: f.id })
          renderAppearance()
        }
      })
    )
  }

  soundsEl.innerHTML = ''
  for (const s of SOUND_OPTIONS) {
    const locked = !s.free && !unlocked
    const isUpload = !!s.upload
    soundsEl.append(
      apprTile({
        // Sounds aren't part of the visual preview; selecting one just plays it.
        // For non-Pro, a locked sound plays as a preview but isn't saved.
        name: isUpload && hasCustomSound ? 'Your sound' : s.name,
        selected: prefs.soundChoice === s.id,
        locked,
        fill: (tile) => {
          const ic = document.createElement('span')
          ic.className = 'snd-ic'
          ic.textContent = isUpload ? '⬆️' : '🔊'
          tile.append(ic)
        },
        onClick: () => {
          if (locked) {
            // Preview the locked sound (nothing to preview for the upload tile).
            if (!isUpload) playPreviewSound(s.id)
            refreshPreviewNote(true)
            return
          }
          if (isUpload) {
            if (hasCustomSound) {
              prefs.soundChoice = 'custom'
              void q.setPrefs({ soundChoice: 'custom' })
              renderAppearance()
            } else {
              upSound.click()
            }
            return
          }
          playPreviewSound(s.id) // let the user hear their pick
          prefs.soundChoice = s.id
          void q.setPrefs({ soundChoice: s.id })
          renderAppearance()
        }
      })
    )
  }
  refreshPreviewNote()
  updateAppearancePreview()
}

// The "preview only — get Pro" banner shown under the appearance preview. It
// stays visible for non-Pro users as a hint, and switches to an active-preview
// state (with a CTA) when they're previewing a locked option. `soundPreviewed`
// forces the active state after playing a locked sound (which leaves no visible
// swatch to indicate a preview is in effect).
const previewNote = document.getElementById('appearance-preview-note') as HTMLElement
const previewNoteText = document.getElementById('preview-note-text') as HTMLElement
const previewNoteCta = document.getElementById('preview-note-cta') as HTMLAnchorElement
function refreshPreviewNote(soundPreviewed = false): void {
  if (!previewNote) return
  if (canUseAppearanceCustomizations()) {
    previewNote.classList.add('hidden') // Pro: no preview messaging needed
    return
  }
  previewNote.classList.remove('hidden')
  const active = anyPreview() || soundPreviewed
  previewNote.classList.toggle('active', active)
  previewNoteText.textContent = active
    ? '👀 Preview only — activate Nudzie Pro to keep this.'
    : '🔒 Tap any locked option to try it in the preview above.'
  previewNoteCta.classList.toggle('hidden', !active)
}
previewNoteCta?.addEventListener('click', (e) => {
  e.preventDefault()
  showTab('pro')
})

const MAX_SOUND_BYTES = 2 * 1024 * 1024
const MAX_SOUND_SECONDS = 5
function audioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const a = new Audio()
    a.preload = 'metadata'
    a.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(a.duration)
    }
    a.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that audio file.'))
    }
    a.src = url
  })
}
function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Could not read that file.'))
    r.readAsDataURL(file)
  })
}
upSound.addEventListener('change', async () => {
  const file = upSound.files?.[0]
  if (!file) return
  soundError.classList.add('hidden')
  try {
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a)$/i.test(file.name)) {
      throw new Error('Please choose an mp3, wav, or m4a file.')
    }
    if (file.size > MAX_SOUND_BYTES) {
      throw new Error(`That file is ${(file.size / 1048576).toFixed(1)} MB - please use one under 2 MB.`)
    }
    const dur = await audioDuration(file)
    if (dur > MAX_SOUND_SECONDS + 0.25) {
      throw new Error(`That clip is ${dur.toFixed(1)}s - please use one up to ${MAX_SOUND_SECONDS} seconds.`)
    }
    await q.setCustomSound(await readDataUrl(file))
    hasCustomSound = true
    prefs.soundChoice = 'custom'
    await q.setPrefs({ soundChoice: 'custom' })
    renderAppearance()
  } catch (e) {
    soundError.textContent = (e as Error).message
    soundError.classList.remove('hidden')
  } finally {
    upSound.value = ''
  }
})

// ---- Calendars (picker + wizards) ----
const calPicker = $('cal-picker')
const wizIcal = $('wiz-ical')
const wizIcloud = $('wiz-icloud')
const wizGoogle = $('wiz-google')
const calFreeNote = $('cal-free-note')
const pickIcalStatus = $('pick-ical-status')
const pickIcloudStatus = $('pick-icloud-status')
const pickGoogleStatus = $('pick-google-status')

const icalUrl = $<HTMLInputElement>('ical-url')
const icalName = $<HTMLInputElement>('ical-name')
const icalAdd = $<HTMLButtonElement>('ical-add')
const icalError = $('ical-error')
const icalFeeds = $<HTMLUListElement>('ical-feeds')
const iUser = $<HTMLInputElement>('i-user')
const iPass = $<HTMLInputElement>('i-pass')
const iConnect = $<HTMLButtonElement>('i-connect')
const iDisconnect = $<HTMLButtonElement>('i-disconnect')
const icloudForm = $('icloud-form')
const icloudConnected = $('icloud-connected')
const iDetail = $('i-detail')
const iError = $('i-error')
const gConnect = $<HTMLButtonElement>('g-connect')
const gDisconnect = $<HTMLButtonElement>('g-disconnect')
const gError = $('g-error')
const upcomingList = $<HTMLUListElement>('upcoming')

const show = (el: HTMLElement): void => el.classList.remove('hidden')
const hide = (el: HTMLElement): void => el.classList.add('hidden')

function setStatus(el: HTMLElement, connected: boolean, text: string): void {
  el.textContent = text
  el.classList.toggle('connected', connected)
}

// Picker ⇄ wizard navigation.
function showPicker(): void {
  show(calPicker)
  hide(wizIcal)
  hide(wizIcloud)
  hide(wizGoogle)
}
function openWizard(provider: string): void {
  hide(calPicker)
  wizIcal.classList.toggle('hidden', provider !== 'ical')
  wizIcloud.classList.toggle('hidden', provider !== 'icloud')
  wizGoogle.classList.toggle('hidden', provider !== 'google')
  hide(icalError)
  hide(iError)
  hide(gError)
}
document.querySelectorAll<HTMLElement>('.provider-btn').forEach((b) =>
  b.addEventListener('click', () => openWizard(b.dataset.go ?? ''))
)
document.querySelectorAll<HTMLElement>('[data-back]').forEach((b) =>
  b.addEventListener('click', showPicker)
)
calFreeNote.addEventListener('click', () => showTab('pro'))

function renderFeeds(feeds: Feed[]): void {
  icalFeeds.innerHTML = ''
  for (const f of feeds) {
    const li = document.createElement('li')
    const name = document.createElement('span')
    name.textContent = f.name
    const rm = document.createElement('button')
    rm.className = 'btn btn-outline btn-sm'
    rm.textContent = 'Remove'
    rm.addEventListener('click', async () => {
      renderFeeds(await q.icalRemove(f.id))
      await refreshCalendar()
    })
    li.append(name, rm)
    icalFeeds.append(li)
  }
}

function renderUpcoming(events: UpcomingEvent[], connected: boolean): void {
  upcomingList.innerHTML = ''
  if (events.length === 0) {
    const li = document.createElement('li')
    li.textContent = connected
      ? 'No more meetings today.'
      : 'Connect a calendar to see your meetings.'
    upcomingList.append(li)
    return
  }
  for (const ev of events.slice(0, 30)) {
    const li = document.createElement('li')
    const title = document.createElement('span')
    title.className = 'up-title'
    title.textContent = ev.title
    const when = document.createElement('span')
    when.className = 'up-time'
    when.textContent = new Date(ev.start).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    })
    li.append(title, when)
    upcomingList.append(li)
  }
}

async function refreshCalendar(): Promise<void> {
  const statuses = await q.calStatus()
  const ical = statuses.find((s) => s.id === 'ical')
  const icloud = statuses.find((s) => s.id === 'icloud')
  const google = statuses.find((s) => s.id === 'google')

  setStatus(
    pickIcalStatus,
    !!ical?.connected,
    ical?.connected ? (ical.detail ?? 'Connected') : 'Not connected'
  )

  if (icloud?.connected) {
    hide(icloudForm)
    show(icloudConnected)
    iDetail.textContent = icloud.detail ?? 'Connected'
    setStatus(pickIcloudStatus, true, `Connected · ${icloud.detail ?? ''}`)
  } else {
    show(icloudForm)
    hide(icloudConnected)
    setStatus(pickIcloudStatus, false, 'Not connected')
  }

  const gConnected = !!google?.connected
  setStatus(
    pickGoogleStatus,
    gConnected,
    gConnected ? (google?.detail ?? 'Connected') : 'Not connected'
  )
  gConnect.classList.toggle('hidden', gConnected)
  gDisconnect.classList.toggle('hidden', !gConnected)

  const connected = statuses.some((s) => s.connected)
  renderFeeds(await q.icalList())
  renderUpcoming(connected ? await q.upcoming() : [], connected)
}

icalAdd.addEventListener('click', async () => {
  hide(icalError)
  icalAdd.disabled = true
  try {
    renderFeeds(await q.icalAdd(icalUrl.value, icalName.value))
    icalUrl.value = ''
    icalName.value = ''
    await refreshCalendar()
  } catch (e) {
    icalError.textContent = (e as Error).message
    show(icalError)
  } finally {
    icalAdd.disabled = false
  }
})

iConnect.addEventListener('click', async () => {
  hide(iError)
  iConnect.disabled = true
  try {
    await q.calConnect('icloud', { username: iUser.value, password: iPass.value })
    iPass.value = ''
    await refreshCalendar()
  } catch (e) {
    iError.textContent = (e as Error).message
    show(iError)
  } finally {
    iConnect.disabled = false
  }
})
iDisconnect.addEventListener('click', async () => {
  await q.calDisconnect('icloud')
  await refreshCalendar()
})

gConnect.addEventListener('click', async () => {
  hide(gError)
  gConnect.disabled = true
  try {
    await q.calConnect('google')
    await refreshCalendar()
  } catch (e) {
    gError.textContent = (e as Error).message
    show(gError)
  } finally {
    gConnect.disabled = false
  }
})
gDisconnect.addEventListener('click', async () => {
  await q.calDisconnect('google')
  await refreshCalendar()
})

$<HTMLButtonElement>('upcoming-refresh').addEventListener('click', () => void refreshCalendar())

// ---- License / Pro ----
const planBadge = $('plan-badge')
const licenseLine = $('license-line')
const licenseLocked = $('license-locked')
const licenseActive = $('license-active')
const licenseKey = $<HTMLInputElement>('license-key')
const activateBtn = $<HTMLButtonElement>('activate-btn')
const deactivateBtn = $<HTMLButtonElement>('deactivate-btn')
const licenseError = $('license-error')

function renderLicense(s: LicenseStatus): void {
  isPro = s.premium
  // Now Pro: drop any "try before you buy" previews — the real (saved) choices
  // are what apply, and the picker returns to normal apply-and-save behaviour.
  if (s.premium) clearPreview()
  planBadge.textContent = s.premium ? 'PRO' : 'Free'
  planBadge.className = 'badge ' + (s.premium ? 'pro' : 'free')
  licenseLocked.classList.toggle('hidden', s.premium)
  licenseActive.classList.toggle('hidden', !s.premium)
  calFreeNote.classList.toggle('hidden', s.premium) // "one calendar source only" note
  licenseLine.textContent = s.premium
    ? `Nudzie Pro is active on this device. Key ${s.keyMasked ?? ''}`
    : 'Unlock custom characters, themes, fonts, sounds and unlimited calendars for $9.99 once.'
  applyCustomSaveMode(s.premium) // "Use this character" vs "Activate Pro to use this →"
  renderCharacters()
  renderAppearance()
}

activateBtn.addEventListener('click', async () => {
  hide(licenseError)
  activateBtn.disabled = true
  try {
    renderLicense(await q.licenseActivate(licenseKey.value))
  } catch (e) {
    licenseError.textContent = (e as Error).message
    show(licenseError)
  } finally {
    activateBtn.disabled = false
  }
})
deactivateBtn.addEventListener('click', async () => {
  hide(licenseError)
  deactivateBtn.disabled = true
  try {
    renderLicense(await q.licenseDeactivate())
  } catch (e) {
    licenseError.textContent = (e as Error).message
    show(licenseError)
  } finally {
    deactivateBtn.disabled = false
  }
})
$<HTMLButtonElement>('buy-btn').addEventListener('click', () => void q.openExternal(CHECKOUT_URL))

// ---- Init ----
function fillPrefs(p: Prefs): void {
  prefs = p
  lead.value = String(p.leadMinutes)
  template.value = p.messageTemplate
  remindAtStart.checked = p.remindAtStart
  sound.checked = p.soundEnabled
  login.checked = p.launchAtLogin
  dockIcon.checked = p.dockIcon
  stay.checked = p.staySignedIn
  display.value = p.targetDisplay
  snoozeMinutes.value = String(p.snoozeMinutes)
  // Make sure the selected built-in character still exists (custom is loaded below).
  prefs.character = p.character === 'custom' ? 'custom' : characterById(p.character).id
  renderCharacters()
  renderReminders()
  updateAppearancePreview()
}

void (async () => {
  fillPrefs(await q.getPrefs())
  hasCustomSound = !!(await q.getCustomSound())
  renderLicense(await q.licenseStatus())
  await initCustom()
  renderAppearance()
  updateSchRows()
  scheduledCache = await q.scheduledList()
  renderReminders()
  showPicker()
  await refreshCalendar()
  // First run: land on Character so the user picks one of the free identities.
  if (!prefs.characterChosen) showTab('character')
})()
