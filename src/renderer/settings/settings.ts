import { CHARACTERS, characterById } from '../characters'
import { processCharacterImage, makeTrayFromIdle, makeAppIconFromIdle } from './bg-remove'

const q = window.nudzie
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

// Copy-paste AI prompts for "make your own character".
const IDLE_PROMPT =
  'Full-body pixel-art character, front view, standing and smiling. [DESCRIBE YOUR CHARACTER — e.g. a young man with short black hair, round glasses, a navy hoodie and grey joggers, brown sneakers]. They are holding a reusable water bottle in one hand, down at their side. Clean, detailed pixel-art style with soft shading; friendly and wholesome. Plain solid pale-blue background, a subtle soft shadow under the feet, the character centered with empty space all around. No text, no frame, no border.'
const ACTION_PROMPT =
  'Using the previous image as the reference, keep the exact same character — same face, hairstyle, glasses, outfit, colours, art style and proportions. Now show them tilting their head back and drinking from the same water bottle, seen from the side. Same clean pixel-art style, same plain solid pale-blue background, same soft shadow under the feet. Full body, centered, with empty space around them. No text, no frame, no border.'

// A placeholder checkout URL. The license backend is stubbed in this build; swap
// this (and wire up license.ts) when you connect a real payment provider.
const CHECKOUT_URL = 'https://example.com/nudzie-pro'

let prefs: Prefs
let isPro = false
let hasCustom = false
let customIdleUrl: string | null = null // stored custom idle sprite (for its tile)

// ---- Tabs ----
const navItems = Array.from(document.querySelectorAll<HTMLButtonElement>('.nav-item'))
const panels = Array.from(document.querySelectorAll<HTMLElement>('.panel'))
function showTab(id: string): void {
  navItems.forEach((n) => n.classList.toggle('active', n.dataset.tab === id))
  panels.forEach((p) => p.classList.toggle('active', p.dataset.panel === id))
}
navItems.forEach((n) => n.addEventListener('click', () => showTab(n.dataset.tab as string)))

// ---- General ----
const lead = $<HTMLInputElement>('lead')
const template = $<HTMLInputElement>('template')
const remindAtStart = $<HTMLInputElement>('remindAtStart')
const sound = $<HTMLInputElement>('sound')
const login = $<HTMLInputElement>('login')
const dockIcon = $<HTMLInputElement>('dockIcon')
const stay = $<HTMLInputElement>('stay')
const display = $<HTMLSelectElement>('display')

lead.addEventListener('change', () => void q.setPrefs({ leadMinutes: Number(lead.value) }))
template.addEventListener('change', () => void q.setPrefs({ messageTemplate: template.value }))
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
    void q.setPrefs({ messageTemplate: template.value })
  })
)

$<HTMLButtonElement>('test-btn').addEventListener('click', () => void q.testReminder())
$<HTMLButtonElement>('now-btn').addEventListener('click', () => void q.remindNow())
$<HTMLButtonElement>('side-test-btn').addEventListener('click', () => void q.testReminder())

// ---- Interval ----
const intervalEnabled = $<HTMLInputElement>('intervalEnabled')
const intervalMessage = $<HTMLInputElement>('intervalMessage')
const activeStart = $<HTMLInputElement>('activeStart')
const activeEnd = $<HTMLInputElement>('activeEnd')
const intervalMinutes = $<HTMLInputElement>('intervalMinutes')
const snoozeMinutes = $<HTMLInputElement>('snoozeMinutes')

intervalEnabled.addEventListener('change', () =>
  void q.setPrefs({ intervalEnabled: intervalEnabled.checked })
)
intervalMessage.addEventListener('change', () =>
  void q.setPrefs({ intervalMessage: intervalMessage.value })
)
const intervalError = document.getElementById('interval-error') as HTMLElement
async function commitActiveHours(): Promise<void> {
  const start = clampHour(activeStart.value)
  const end = clampHour(activeEnd.value)
  // Overnight windows (start >= end) aren't supported — the interval scheduler
  // would silently never fire. Reject and revert to the last saved values.
  if (start >= end) {
    intervalError.textContent =
      'Active "from" must be earlier than "until" (overnight ranges aren’t supported yet).'
    intervalError.classList.remove('hidden')
    activeStart.value = String(prefs.activeStartHour)
    activeEnd.value = String(prefs.activeEndHour)
    return
  }
  intervalError.classList.add('hidden')
  prefs = await q.setPrefs({ activeStartHour: start, activeEndHour: end })
}
activeStart.addEventListener('change', () => void commitActiveHours())
activeEnd.addEventListener('change', () => void commitActiveHours())

// ---- Scheduled reminders (once/daily/weekly/monthly/yearly) ----
const schList = $<HTMLUListElement>('scheduled-list')
const schTitle = $<HTMLInputElement>('sch-title')
const schMessage = $<HTMLInputElement>('sch-message')
const schType = $<HTMLSelectElement>('sch-type')
const schTime = $<HTMLInputElement>('sch-time')
const schDate = $<HTMLInputElement>('sch-date')
const schDom = $<HTMLInputElement>('sch-dom')
const schMonth = $<HTMLSelectElement>('sch-month')
const schYDay = $<HTMLInputElement>('sch-yday')
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
}
schType.addEventListener('change', updateSchRows)

function describeSchedule(s: Schedule): string {
  const t = s.time
  switch (s.type) {
    case 'once':
      return `Once · ${s.date ?? ''} at ${t}`
    case 'daily':
      return `Daily at ${t}`
    case 'weekly': {
      const names = (s.days ?? []).slice().sort().map((d) => DAY_NAMES[d]).join(', ')
      return `Weekly on ${names || '—'} at ${t}`
    }
    case 'monthly':
      return `Monthly on day ${s.dayOfMonth ?? 1} at ${t}`
    case 'yearly':
      return `Yearly on ${MONTH_NAMES[(s.month ?? 1) - 1]} ${s.day ?? 1} at ${t}`
  }
}

function renderScheduled(list: ScheduledReminder[]): void {
  schList.innerHTML = ''
  if (list.length === 0) {
    const li = document.createElement('li')
    li.className = 'muted small'
    li.textContent = 'No scheduled reminders yet.'
    schList.append(li)
    return
  }
  for (const r of list) {
    const li = document.createElement('li')
    li.className = 'sched-item'
    const meta = document.createElement('div')
    meta.className = 'sched-meta'
    const title = document.createElement('span')
    title.className = 'sched-title'
    title.textContent = r.title
    const desc = document.createElement('span')
    desc.className = 'sched-desc'
    desc.textContent = describeSchedule(r.schedule)
    meta.append(title, desc)

    const toggle = document.createElement('input')
    toggle.type = 'checkbox'
    toggle.checked = r.enabled
    toggle.title = 'Enabled'
    toggle.addEventListener('change', async () => {
      renderScheduled(await q.scheduledSetEnabled(r.id, toggle.checked))
    })

    const rm = document.createElement('button')
    rm.className = 'btn btn-outline btn-sm'
    rm.textContent = 'Remove'
    rm.addEventListener('click', async () => {
      renderScheduled(await q.scheduledRemove(r.id))
    })

    li.append(meta, toggle, rm)
    if (!r.enabled) li.classList.add('off')
    schList.append(li)
  }
}

schAdd.addEventListener('click', async () => {
  schError.classList.add('hidden')
  const title = schTitle.value.trim()
  const time = schTime.value || '09:00'
  const type = schType.value as Schedule['type']
  if (!title) return fail('Give your reminder a title.')

  const schedule: Schedule = { type, time }
  if (type === 'once') {
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
    renderScheduled(await q.scheduledAdd({ title, message: schMessage.value.trim(), schedule }))
    // Reset the simple fields.
    schTitle.value = ''
    schMessage.value = ''
  } finally {
    schAdd.disabled = false
  }

  function fail(msg: string): void {
    schError.textContent = msg
    schError.classList.remove('hidden')
  }
})
intervalMinutes.addEventListener('change', () =>
  void q.setPrefs({ intervalMinutes: Math.max(1, Number(intervalMinutes.value)) })
)
snoozeMinutes.addEventListener('change', () => {
  const v = Math.max(1, Math.min(59, Number(snoozeMinutes.value) || 1))
  snoozeMinutes.value = String(v) // reflect the clamp back into the field
  void q.setPrefs({ snoozeMinutes: v })
})
const clampHour = (v: string): number => Math.max(0, Math.min(23, Number(v) || 0))

// ---- Characters ----
const charactersEl = $('characters')
function renderCharacters(): void {
  charactersEl.innerHTML = ''
  for (const c of CHARACTERS) {
    const locked = !c.free && !isPro
    const selected = prefs.character === c.id
    const tile = document.createElement('button')
    tile.className = 'tile' + (selected ? ' selected' : '') + (locked ? ' locked' : '')
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
      if (locked) return showTab('pro')
      prefs.character = c.id
      void q.setPrefs({ character: c.id })
      renderCharacters()
    })
    charactersEl.append(tile)
  }

  // The user's custom character (if any) gets its own selectable tile.
  if (hasCustom && customIdleUrl) {
    const selected = prefs.character === 'custom'
    const tile = document.createElement('button')
    tile.className = 'tile' + (selected ? ' selected' : '')
    const img = document.createElement('img')
    img.src = customIdleUrl
    const name = document.createElement('span')
    name.className = 'tile-name'
    name.textContent = 'Yours'
    tile.append(img, name)
    tile.addEventListener('click', () => {
      prefs.character = 'custom'
      void q.setPrefs({ character: 'custom' })
      renderCharacters()
    })
    charactersEl.append(tile)
  }
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

let processedIdle: string | null = null
let processedAction: string | null = null

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
    customError.textContent = `That image is ${mb} MB — please use one under 5 MB.`
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
  prevIdle.innerHTML = ''
  prevAction.innerHTML = ''
  upIdle.value = ''
  upAction.value = ''
  customSave.disabled = true
  hide(customRemove)
  renderCharacters()
})

$('custom-upsell').addEventListener('click', (e) => {
  e.preventDefault()
  showTab('pro')
})

async function initCustom(): Promise<void> {
  const canCustom = await q.canCustomCharacter()
  customPanel.classList.toggle('hidden', !canCustom)
  customLocked.classList.toggle('hidden', canCustom)
  customProTag.classList.toggle('hidden', canCustom) // show PRO tag only when gated
  const existing = await q.getCustomCharacter()
  if (existing) {
    hasCustom = true
    customIdleUrl = existing.idle
    setPreview(prevIdle, existing.idle)
    setPreview(prevAction, existing.action)
    show(customRemove)
  }
  renderCharacters()
}

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
  planBadge.textContent = s.premium ? 'PRO' : 'Free'
  planBadge.className = 'badge ' + (s.premium ? 'pro' : 'free')
  licenseLocked.classList.toggle('hidden', s.premium)
  licenseActive.classList.toggle('hidden', !s.premium)
  calFreeNote.classList.toggle('hidden', s.premium) // "one calendar only" note
  licenseLine.textContent = s.premium
    ? `Thanks for supporting Nudzie! Key ${s.keyMasked ?? ''}`
    : 'Unlock extra characters, sounds and themes — and support the project.'
  renderCharacters()
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
  renderLicense(await q.licenseDeactivate())
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
  intervalEnabled.checked = p.intervalEnabled
  intervalMessage.value = p.intervalMessage
  activeStart.value = String(p.activeStartHour)
  activeEnd.value = String(p.activeEndHour)
  intervalMinutes.value = String(p.intervalMinutes)
  snoozeMinutes.value = String(p.snoozeMinutes)
  // Make sure the selected character still exists (falls back to default).
  prefs.character = characterById(p.character).id
  renderCharacters()
}

void (async () => {
  fillPrefs(await q.getPrefs())
  renderLicense(await q.licenseStatus())
  await initCustom()
  updateSchRows()
  renderScheduled(await q.scheduledList())
  showPicker()
  await refreshCalendar()
})()
