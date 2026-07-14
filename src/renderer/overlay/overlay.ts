// Overlay entry point. Wires the reusable CornerWalk component to the main
// process: it receives "a reminder is firing" via window.nudzie.onReminder and
// reports accept/snooze/done back. Message copy + timing come entirely from the
// payload, so calendar and interval reminders share this exact code path.
import { CornerWalk, type ReminderView } from './corner-walk'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const walk = new CornerWalk(
  {
    pet: $('pet'),
    spriteIdle: $<HTMLImageElement>('sprite-idle'),
    spriteAction: $<HTMLImageElement>('sprite-action'),
    bubble: $('bubble'),
    bubbleText: $('bubble-text'),
    buttons: $('buttons'),
    acceptBtn: $<HTMLButtonElement>('accept-btn'),
    snoozeBtn: $<HTMLButtonElement>('snooze-btn'),
    confetti: $('confetti')
  },
  {
    onAccept: (r) => window.nudzie.accept(r.id, r.kind),
    onSnooze: (r) => window.nudzie.snooze(r.id, r.kind, r.snoozeMinutes),
    onDone: () => window.nudzie.hideOverlay()
  }
)

window.nudzie?.onReminder((r: ReminderView) => void walk.show(r))
