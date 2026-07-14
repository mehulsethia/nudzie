# Nudzie — architecture

Nudzie merges two MIT-licensed apps into one: **Quakpit** provides the app
skeleton (calendar/scheduler/windows/tray/store/license), and **Hydrate Buddy**
provides the on-screen character (corner-walk animation + asset pipeline). Both
reminder trigger types converge on a single overlay component.

```
 calendar events ─┐
                  ├─► scheduler.ts ─► showReminder(Reminder) ─► corner-walk overlay
 interval timer  ─┘        │                                         (walk-in →
                           │                                          bubble + accept/snooze →
                    tray / settings                                   celebrate/snooze beat →
                    (test / remind now)                               walk-off)
```

## What was ported from each source

### From Quakpit (TypeScript / electron-vite / electron-builder)

- **Project skeleton** — `electron.vite.config.ts`, `tsconfig.json`,
  `electron-builder.yml`, the `src/main` + `src/preload` + `src/renderer`
  three-surface layout, icon-generation scripts, auto-updater.
- **Calendar integration** (`src/main/calendar/`) — Google Calendar (hand-rolled
  OAuth PKCE loopback), iCloud CalDAV, and iCal/.ics subscription links, merged by
  `calendar/index.ts`. Ported essentially verbatim (only user-facing "Quakpit"
  strings rebranded).
- **Scheduler** (`src/main/scheduler.ts`) — the 60s poll / 15s tick / 90s
  fire-window calendar logic, dedup `fired` set, and `{title}`/`{minutes}`
  message templating.
- **Persistent store** (`src/main/store.ts`) — `prefs.json` + OS-encrypted
  (`safeStorage`) blobs for tokens/creds/entitlement.
- **Windowing pattern** — settings window (`windows/settings.ts`), and the
  transparent/always-on-top/`showInactive`/keep-Dock-visible overlay handling.
- **Tray** (`src/main/tray.ts`) — base menu (open settings, test trigger, quit).
- **Open-core license check** (`src/main/license.ts`) — activate/validate/
  deactivate flow, encrypted entitlement cache, 14-day offline grace, single
  `isPremium()` gate, and the free/Pro asset-registry pattern.

### From Hydrate Buddy (plain-JS Electron)

- **Corner-walk animation system** — ported to TypeScript as a reusable component
  (`src/renderer/overlay/corner-walk.ts`): walk-in/walk-off via a CSS
  `translateX` transition, `walk-bob` footstep bounce, idle/action **sprite
  swap**, speech bubble, accept → celebration (action pose + happy-hop +
  confetti burst), snooze → "back in N min" beat. The CSS came from Hydrate
  Buddy's `style.css` (`src/renderer/overlay/overlay.css`).
- **Corner window** — `windows/overlay.ts` positions a small transparent
  always-on-top window in the work-area corner, shown per reminder.
- **Interval timing** — active-hours + interval + snooze + "wait until next
  active start" logic, folded into `scheduler.ts` as the second trigger type.

**Nudzie-original:**

- **Scheduled reminders** (third trigger type) — a clock/date rule engine in
  `scheduler.ts` (`computePrevOccurrence`) evaluated on the existing 15s tick:
  once / daily / weekly / monthly / yearly, each `{ time, + date|days|dayOfMonth|
  month+day }`. Persisted as `scheduled.json` (`store.ts`), managed from Settings →
  Personal reminders, and routed through the same corner-walk overlay. Recurring
  occurrences missed while the app was closed are skipped (5-min catch-up window);
  one-off reminders still fire late (once) so they aren't lost.
- **Asset pipeline** — the jimp background-removal / feather / autocrop pipeline
  (`scripts/prepare-assets.cjs`, `npm run prepare-assets`), paths adapted to write
  into `src/renderer/overlay/characters/<id>/`, plus the face-crop **tray icon**
  (`build/tray.png`) so the character is the menu-bar icon.
- **In-app custom character** — the pipeline is also ported to the browser
  (`src/renderer/settings/bg-remove.ts`, a Canvas reimplementation of the jimp
  flood-fill) so a user can upload their own idle/action art in Settings →
  Character; it's processed on-device and stored locally, with the sprites routed
  through the overlay payload and the face set as the tray **and app (Dock/
  taskbar) icon**, updated live via `platform.applyAppIcon()`. Gated by a feature
  flag (`CUSTOM_CHARACTER_REQUIRES_PRO`) — see PRO-TIER.md.

## What's merged / shared

- **One overlay for all triggers.** `scheduler.ts` builds a generic `Reminder`
  (`{ id, kind, message, acceptLabel, snoozeLabel, snoozeMinutes, character,
  sound }`) for calendar, interval, *and* scheduled reminders; all call
  `showReminder()` and
  render through the same `CornerWalk` component. Only copy + timing source
  differ. Accept/snooze route back by `kind`: interval reschedules the interval
  timer; calendar re-shows once after the snooze delay. Because there's a single
  overlay window, reminders are **serialised through a FIFO queue** in
  `windows/overlay.ts` — if the character is already on screen, the next reminder
  waits and is drained when it walks off (`overlayDone`), rather than being
  dropped or interrupting the current one. The queue de-dupes by id and is
  cleared on pause.
- **One tray** (`tray.ts`) — Quakpit's base + Hydrate Buddy's manual controls
  (Remind me now, Pause reminders) with a live-rebuilt Pause checkbox/tooltip.
  The icon is the character's face (custom → bundled `build/tray.png` → bell
  placeholder), refreshed live when the custom character changes.
- **One preload bridge** — `window.nudzie` exposes both the overlay API
  (`onReminder`/`accept`/`snooze`/`hideOverlay`) and the settings API.
- **One settings window** — calendar connection (Google/iCloud/iCal), interval
  config (enable/active hours/interval/snooze/message), character picker, and the
  Pro/license tab, all in `src/renderer/settings/`.
- **One license gate** — `isPremium()` gates both the calendar-count limit
  (`ipc.ts`) and the character asset (`overlay.ts`). See PRO-TIER.md.

## Design decisions worth revisiting (baseline shortcuts)

- **Corner window vs. Quakpit's persistent full-screen overlay.** We chose a
  Hydrate-Buddy-style per-reminder corner window so the accept/snooze buttons are
  clickable. Quakpit deliberately *never* toggled its overlay (that toggling was
  what dropped its Dock icon / stole focus). We re-added Quakpit's
  `keepDockVisible()` safeguards and `showInactive()`, but if you ever see Dock
  flicker on show/hide, this is the spot — the alternative (single persistent
  overlay, flip click-through per reminder) is documented in the original plan.
- **Timezone.** Interval active-hours now use the machine's **local** time (not
  Hydrate Buddy's hardcoded `Asia/Kolkata`). It's a plain `new Date()` read — no
  explicit tz picker yet; add one to `Prefs` if you want per-user override.
- **Character art is placeholder.** The default `buddy` sprites are copied from
  Hydrate Buddy (MIT, credited) purely so the demo shows a real character.
  Replace via the `prepare-assets` pipeline + `characters.ts`, or per-user via
  the in-app "Make your own" uploader (Settings → Character).
- **Naming/branding placeholder.** "Nudzie", the app id `com.nudzie.app`, the
  publish `owner/repo`, and all icons are placeholders. Icons are generated
  neutral shapes until you drop in `build/icon-master.png`.
- **Google OAuth unconfigured.** `oauth-credentials.json` is intentionally absent;
  Google stays "Not connected" until you add it (README). iCloud/iCal work without
  it. The build never blocks on it.
- **License is a stub** defaulting to free tier — no real key/provider wired.
  `NUDZIE_FORCE_PRO=1` exercises the Pro gates. See PRO-TIER.md.
- **Dropped from Hydrate Buddy:** the "set your name" personalization window
  (and its per-user name in messages) — trimmed to keep the merged surface small.
  The message copy is static per reminder type; re-add name interpolation in
  `scheduler.ts` message builders if wanted.
- **Notch-based staging** (mentioned as a future alternative to corner staging)
  is **not** implemented — the character always enters from the work-area corner.
- **Sound** is a single bundled `chime` (Quakpit's quack sample, renamed); the
  elaborate WebAudio propeller engine was flight-specific and dropped.

## Build / run

```bash
npm install
npm run dev            # gen icons + electron-vite dev
npm run build          # production bundle (verified: main/preload/renderer all build)
npm run prepare-assets # jimp sprite pipeline (verified)
```

> Note: if you launch and immediately see
> `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`,
> your shell has `ELECTRON_RUN_AS_NODE=1` set (it forces Electron to run as plain
> Node). `unset ELECTRON_RUN_AS_NODE` and re-run. A normal terminal won't have it.
