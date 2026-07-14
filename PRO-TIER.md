# Pro-tier boundary

Nudzie preserves Quakpit's open-core license-check flow and free/Pro gating
shape, but with every real payment-provider reference replaced by a generic
stub. This document says exactly where the free/Pro boundary sits, what's real
vs stubbed, and what to fill in to go live.

## The single gate

Everything ultimately checks **one function**:

- `isPremium()` in [`src/main/license.ts`](src/main/license.ts)

Today it returns `false` (free tier) unless:

- a real backend is wired up (see below) **and** a valid key is activated, or
- the env var **`NUDZIE_FORCE_PRO=1`** is set (dev/testing shortcut to exercise
  every Pro gate without a backend).

## Where gating is enforced (free vs Pro decisions)

| Location | Gate | Behaviour today (free) |
| --- | --- | --- |
| `src/main/windows/overlay.ts` → `showReminder()` | Character asset | Non-Pro is forced to the default `buddy` character, so the UI can't be bypassed. This is the asset-gating pattern — Pro characters get chosen freely, free tier is pinned to the default. |
| `src/main/ipc.ts` → `cal:connect` / `ical:add` | Calendar count | Free tier is limited to **one** connected calendar across all providers (`FREE_CAL_MSG`). Pro removes the limit. |
| `src/renderer/settings/settings.ts` → `renderCharacters()` | Character picker | Locked (`!free && !isPro`) tiles show a 🔒 and route to the Pro tab instead of selecting. |
| `src/renderer/characters.ts` | Asset registry | Each character carries a `free: boolean`. Only the free `buddy` ships in this open build; add Pro characters here (with `free: false`). |
| `src/main/license.ts` → `CUSTOM_CHARACTER_REQUIRES_PRO` / `canUseCustomCharacter()` | "Make your own character" | Feature flag for the in-app custom-character uploader. Currently **`false`** (usable in the free baseline). Flip to `true` to make it a paid feature — the UI locks itself, the `character:setCustom` IPC refuses, and `showReminder` falls back to the default, all with no other code changes. |

The renderer gates are **UX only** — the authoritative enforcement is always in
the main process (`isPremium()` in `overlay.ts` / `ipc.ts`), so a tampered
renderer still can't unlock Pro assets.

## What's real vs stubbed

**Real (kept from Quakpit's design):**

- Entitlement caching, encrypted at rest via the OS (`saveEntitlement` /
  `loadEntitlement` in `store.ts`, written to `license.bin`).
- The **14-day offline grace window** (`GRACE_MS`) so Pro keeps working offline.
- The `activate` → `validate` → `deactivate` flow and the `LicenseStatus` shape
  surfaced to the settings UI.
- Device-id derivation for the activation label (`deviceId()`).

**Stubbed (no real network calls / provider):**

- `LICENSE_BACKEND_ENABLED = false` — the master switch. While `false`,
  `activate()` refuses with a friendly "not set up yet" message and the app runs
  as free tier.
- `verifyKey(key, label)` — **TODO**: POST to your backend's *activate* endpoint,
  return `{ instanceId, status, expiresAt }`.
- `revalidateKey(entitlement)` — **TODO**: POST to your backend's *validate*
  endpoint; currently just echoes the cached values.
- `deactivate()` — clears locally; **TODO**: also notify your backend's
  *deactivate* endpoint.
- `CHECKOUT_URL` in `settings.ts` — placeholder `https://example.com/nudzie-pro`.

## To wire up a real license check + payment flow

1. Stand up (or buy) a license backend + payment provider (Merchant-of-Record,
   Stripe, your own server, etc.).
2. In `src/main/license.ts`:
   - Set `LICENSE_BACKEND_ENABLED = true`.
   - Implement `verifyKey()` and `revalidateKey()` against your endpoints,
     returning the normalized `{ instanceId, status, expiresAt }` shape.
   - Add `deactivate()`'s backend call.
3. In `src/renderer/settings/settings.ts`, set `CHECKOUT_URL` to your real
   checkout link.
4. Add Pro assets:
   - Drop new character art through `npm run prepare-assets -- <id>` and register
     them in `src/renderer/characters.ts` with `free: false`.
   - (Same pattern extends to Pro sounds/themes — add a registry with a `free`
     flag and gate the enforcement in the main process next to the character
     gate in `overlay.ts`.)

No re-architecting is required — the gating structure, entitlement storage,
offline grace, and UI states are already in place; you're filling in the two
network calls and flipping one flag.
