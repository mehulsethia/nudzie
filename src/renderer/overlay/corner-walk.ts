// Reusable corner-walk animation component (ported from Hydrate Buddy's
// renderer.js and generalised). It is NOT tied to any one reminder type: it
// takes a generic payload (message + button labels + character + snooze delay)
// and runs the whole beat - walk in, show a speech bubble with accept/snooze,
// celebrate on accept or play a "snoozed" beat on snooze, then walk off.
//
// Both calendar reminders and interval reminders route through this same
// component (see src/main/scheduler.ts). The host (overlay.ts) supplies the
// callbacks that talk to the main process.
import { characterById } from '../characters'
import { playSound, playSoundUrl } from '../sounds'
import { themeById, fontById } from '../appearance'

export type ReminderView = {
  id: string
  kind: 'calendar' | 'interval' | 'scheduled' | 'summary'
  message: string
  items?: string[] // for 'summary': the missed reminders listed in the bubble
  acceptLabel: string
  snoozeLabel: string
  snoozeMinutes: number
  character?: string
  idleUrl?: string // custom-character sprites (override the registry lookup)
  actionUrl?: string
  sound?: boolean
  bubbleTheme?: string
  bubbleFont?: string
  soundUrl?: string // custom sound clip (data URL); overrides the default chime
}

export type CornerWalkCallbacks = {
  onAccept: (r: ReminderView) => void
  onSnooze: (r: ReminderView) => void
  onDone: () => void // walked off - safe to hide the window
}

type Refs = {
  pet: HTMLElement
  spriteIdle: HTMLImageElement
  spriteAction: HTMLImageElement
  bubble: HTMLElement
  bubbleText: HTMLElement
  buttons: HTMLElement
  acceptBtn: HTMLButtonElement
  snoozeBtn: HTMLButtonElement
  confetti: HTMLElement
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class CornerWalk {
  private busy = false
  private current: ReminderView | null = null
  private audioCtx: AudioContext | null = null

  constructor(
    private refs: Refs,
    private cb: CornerWalkCallbacks
  ) {
    refs.acceptBtn.addEventListener('click', () => void this.onAccept())
    refs.snoozeBtn.addEventListener('click', () => void this.onSnooze())
  }

  /** Entry point: show one reminder. */
  async show(r: ReminderView): Promise<void> {
    if (this.busy) return
    this.busy = true
    this.current = r

    // Character sprites (idle + action pose). Custom characters supply their own
    // sprite data URLs in the payload; otherwise resolve from the registry.
    if (r.idleUrl && r.actionUrl) {
      this.refs.spriteIdle.src = r.idleUrl
      this.refs.spriteAction.src = r.actionUrl
    } else {
      const char = characterById(r.character)
      this.refs.spriteIdle.src = char.idle
      this.refs.spriteAction.src = char.action
    }

    // Button labels come from the payload (per reminder type). A summary - or any
    // reminder with no snooze label - is acknowledge-only, so hide the snooze button.
    this.refs.acceptBtn.textContent = r.acceptLabel
    this.refs.snoozeBtn.textContent = r.snoozeLabel
    const snoozable = r.kind !== 'summary' && !!r.snoozeLabel
    this.refs.snoozeBtn.classList.toggle('hidden', !snoozable)

    // Bubble personalization (colour theme + message font) from the payload.
    const theme = themeById(r.bubbleTheme)
    const font = fontById(r.bubbleFont)
    this.refs.bubble.style.setProperty('--bubble-bg', theme.bg)
    this.refs.bubble.style.setProperty('--bubble-ink', theme.ink)
    this.refs.bubble.style.setProperty('--bubble-font', font.family)

    if (r.sound !== false) this.playChime(r.soundUrl)

    await this.walkIn()
    if (r.kind === 'summary') this.showSummary(r.message, r.items ?? [])
    else this.showBubble(r.message, true)
    this.busy = false
  }

  // ---- sound ----
  private playChime(url?: string): void {
    try {
      if (!this.audioCtx) this.audioCtx = new AudioContext()
      if (this.audioCtx.state === 'suspended') void this.audioCtx.resume()
      if (url) playSoundUrl(this.audioCtx, url)
      else playSound(this.audioCtx, 'chime')
    } catch {
      /* audio is a nice-to-have */
    }
  }

  // ---- pose swap ----
  private showAction(on: boolean): void {
    this.refs.spriteIdle.classList.toggle('hidden', on)
    this.refs.spriteAction.classList.toggle('hidden', !on)
  }

  // ---- walk in / out ----
  private async walkIn(): Promise<void> {
    const { pet } = this.refs
    this.showAction(false)
    pet.classList.remove('celebrate', 'face-right')
    pet.classList.add('offstage')
    void pet.offsetWidth // reflow so the transition runs from offstage
    pet.classList.add('walking')
    pet.classList.remove('offstage')
    await wait(1150)
    pet.classList.remove('walking')
  }

  private async walkOut(): Promise<void> {
    const { pet, bubble } = this.refs
    bubble.classList.add('hidden')
    pet.classList.add('face-right', 'walking', 'offstage')
    await wait(1150)
    pet.classList.remove('walking', 'face-right')
  }

  // ---- bubble ----
  private showBubble(text: string, withButtons: boolean): void {
    this.refs.bubbleText.classList.remove('summary')
    this.refs.bubbleText.textContent = text
    this.refs.buttons.classList.toggle('hidden', !withButtons)
    this.refs.bubble.classList.remove('hidden')
  }

  // The "while you were away" catch-up: a header plus a bullet list of the missed
  // reminders. Built as DOM nodes (never innerHTML) so reminder text can't inject markup.
  private showSummary(header: string, items: string[]): void {
    const el = this.refs.bubbleText
    el.classList.add('summary')
    el.textContent = ''
    const head = document.createElement('div')
    head.className = 'summary-head'
    head.textContent = header
    el.appendChild(head)
    const list = document.createElement('ul')
    list.className = 'summary-list'
    for (const item of items) {
      const li = document.createElement('li')
      li.textContent = item
      list.appendChild(li)
    }
    el.appendChild(list)
    this.refs.buttons.classList.remove('hidden')
    this.refs.bubble.classList.remove('hidden')
  }

  // ---- celebration ----
  private burstConfetti(glyphs: string[]): void {
    const colors = ['#37c24a', '#4aa3df', '#ffd447', '#ff7a59', '#8ad6ff']
    for (let i = 0; i < 42; i++) {
      const piece = document.createElement('div')
      piece.className = 'confetti-piece'
      if (Math.random() < 0.5) {
        piece.textContent = glyphs[(Math.random() * glyphs.length) | 0]
      } else {
        piece.textContent = '■'
        piece.style.color = colors[(Math.random() * colors.length) | 0]
      }
      piece.style.left = Math.random() * 100 + '%'
      piece.style.setProperty('--dur', 0.9 + Math.random() * 0.9 + 's')
      piece.style.setProperty('--fall', 280 + Math.random() * 160 + 'px')
      piece.style.setProperty('--spin', Math.random() * 720 - 360 + 'deg')
      piece.style.animationDelay = Math.random() * 0.25 + 's'
      this.refs.confetti.appendChild(piece)
      setTimeout(() => piece.remove(), 2200)
    }
  }

  private async celebrate(): Promise<void> {
    // Celebration copy + confetti match the reminder type.
    const isCalendar = this.current?.kind === 'calendar'
    const cheer = isCalendar ? "You're all set! 👍" : 'Nice one! ✨'
    const glyphs = isCalendar
      ? ['👍', '✨', '🎉', '⭐', '📌']
      : ['✨', '🎉', '⭐', '💫', '💙']
    this.showBubble(cheer, false)
    this.showAction(true) // action pose
    await wait(950)
    this.showAction(false)
    this.refs.pet.classList.add('celebrate')
    this.burstConfetti(glyphs)
    await wait(1000)
    this.refs.pet.classList.remove('celebrate')
  }

  // ---- button flows ----
  private async onAccept(): Promise<void> {
    if (this.busy || !this.current) return
    this.busy = true
    const r = this.current
    this.cb.onAccept(r)
    await this.celebrate()
    this.showBubble('See you later! 👋', false)
    await wait(600)
    await this.walkOut()
    // Free ourselves before signalling done, so the next queued reminder (which
    // onDone may trigger immediately) isn't dropped by the busy guard.
    this.busy = false
    this.cb.onDone()
  }

  private async onSnooze(): Promise<void> {
    if (this.busy || !this.current) return
    this.busy = true
    const r = this.current
    this.cb.onSnooze(r)
    this.showBubble(`Okay - back in ${r.snoozeMinutes} min!`, false)
    await wait(1300)
    await this.walkOut()
    this.busy = false
    this.cb.onDone()
  }
}
