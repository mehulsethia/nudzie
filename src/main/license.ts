import { createHash } from 'node:crypto'
import os from 'node:os'
import { machineIdSync } from 'node-machine-id'
import { clearEntitlement, loadEntitlement, saveEntitlement } from './store'

// ---------------------------------------------------------------------------
// LICENSE CHECK - STUB (defaults to FREE tier).
//
// This preserves QuakPit's open-core license-check *flow and gating shape*
// (activate → validate → deactivate, an encrypted entitlement cache, an offline
// grace window, and a single isPremium() gate), but every reference to a real
// payment provider has been replaced with a generic placeholder. No real keys
// or backend are wired up yet - see PRO-TIER.md for exactly what to fill in.
//
// Turn LICENSE_BACKEND_ENABLED on and implement verifyKey()/revalidateKey()
// against your own backend + payment provider to go live. Until then activate()
// explains that licensing isn't configured, and the app runs as free tier.
//
// Dev/testing: set env NUDZIE_FORCE_PRO=1 to force premium and exercise all the
// Pro gates without a backend.
// ---------------------------------------------------------------------------
const LICENSE_BACKEND_ENABLED = false

// Premium keeps working offline this long after the last successful validation.
const GRACE_MS = 14 * 24 * 60 * 60 * 1000

export type LicenseStatus = {
  premium: boolean
  active: boolean
  keyMasked: string | null
  expiresAt: number | null
  lastChecked: number | null
}

type Entitlement = {
  key: string
  instanceId: string // activation id returned by the backend
  status: string // granted | revoked | disabled
  validatedAt: number
  expiresAt: number | null
}

let ent: Entitlement | null | undefined // undefined = not loaded yet

function loadCache(): void {
  if (ent !== undefined) return
  const raw = loadEntitlement()
  try {
    ent = raw ? (JSON.parse(raw) as Entitlement) : null
  } catch {
    ent = null
  }
}

function persist(): void {
  if (ent) saveEntitlement(JSON.stringify(ent))
}

/** Stable, anonymised per-machine id used as the activation label. */
function deviceId(): string {
  let base: string
  try {
    base = machineIdSync(true)
  } catch {
    base = `${os.hostname()}|${os.platform()}|${os.arch()}`
  }
  return 'nudzie-' + createHash('sha256').update(base).digest('hex').slice(0, 24)
}

function maskKey(k: string): string {
  return k.length <= 8 ? '••••' : `${k.slice(0, 4)}••••${k.slice(-4)}`
}

function parseExpiry(v: unknown): number | null {
  return typeof v === 'string' ? new Date(v).getTime() : null
}

/**
 * THE SINGLE PRO GATE. Every Pro feature/asset ultimately checks this. Today it
 * returns false (free tier) unless a real backend is wired up and a valid key is
 * activated, or NUDZIE_FORCE_PRO=1 is set for local testing.
 */
export function isPremium(): boolean {
  if (process.env.NUDZIE_FORCE_PRO === '1') return true
  loadCache()
  if (!ent) return false
  const now = Date.now()
  const statusOk = ent.status === 'granted'
  const notExpired = ent.expiresAt == null || now < ent.expiresAt
  const withinGrace = now - ent.validatedAt < GRACE_MS
  return statusOk && notExpired && withinGrace
}

// ---------------------------------------------------------------------------
// Feature flag: is "make your own character" a paid (Pro) feature?
// Set to `true` to gate custom characters behind isPremium() (the intended
// monetisation). Left `false` for now so the feature is usable in this free
// baseline; flipping it makes it Pro-only with no other code changes.
// ---------------------------------------------------------------------------
export const CUSTOM_CHARACTER_REQUIRES_PRO = false

export function canUseCustomCharacter(): boolean {
  return !CUSTOM_CHARACTER_REQUIRES_PRO || isPremium()
}

export function status(): LicenseStatus {
  loadCache()
  return {
    premium: isPremium(),
    active: !!ent && ent.status === 'granted',
    keyMasked: ent ? maskKey(ent.key) : null,
    expiresAt: ent?.expiresAt ?? null,
    lastChecked: ent?.validatedAt ?? null
  }
}

// ---------------------------------------------------------------------------
// Backend integration points - STUBBED. Fill these two functions in to go live.
// Each should talk to your license/payment backend and return a normalized shape.
// ---------------------------------------------------------------------------

type VerifyResult = { instanceId: string; status: string; expiresAt: number | null }

/** Activate (bind) a key to this device. STUB: throws "not configured" today. */
async function verifyKey(_key: string, _label: string): Promise<VerifyResult> {
  // TODO(pro): POST to your backend's "activate" endpoint with { key, label },
  // returning { instanceId, status, expiresAt }. See PRO-TIER.md.
  throw new Error(
    'Licensing is not set up in this build yet. Nudzie is running as the free tier.'
  )
}

/** Re-check a previously activated key. STUB: returns the cached values today. */
async function revalidateKey(e: Entitlement): Promise<VerifyResult> {
  // TODO(pro): POST to your backend's "validate" endpoint with
  // { key, activationId }, returning the current { instanceId, status, expiresAt }.
  return { instanceId: e.instanceId, status: e.status, expiresAt: e.expiresAt }
}

/** Binds the key to this device (backend enforces the per-key device limit). */
export async function activate(key: string): Promise<LicenseStatus> {
  const trimmed = key.trim()
  if (!trimmed) throw new Error('Please enter a license key.')
  if (!LICENSE_BACKEND_ENABLED) {
    throw new Error(
      'Licensing is not set up in this build yet. Nudzie is running as the free tier.'
    )
  }

  const res = await verifyKey(trimmed, deviceId())
  ent = {
    key: trimmed,
    instanceId: res.instanceId,
    status: res.status || 'granted',
    validatedAt: Date.now(),
    expiresAt: res.expiresAt
  }
  persist()
  return status()
}

/** Re-checks the license online; on network failure keeps the cache (offline grace). */
export async function validate(): Promise<LicenseStatus> {
  loadCache()
  if (!ent || !LICENSE_BACKEND_ENABLED) return status()
  try {
    const res = await revalidateKey(ent)
    ent = {
      ...ent,
      status: res.status ?? ent.status,
      validatedAt: Date.now(),
      expiresAt: res.expiresAt ?? ent.expiresAt
    }
    persist()
  } catch {
    // Offline - keep the cached entitlement; the grace window covers this.
  }
  return status()
}

/** Releases the seat so the key can be activated on another device. */
export async function deactivate(): Promise<LicenseStatus> {
  loadCache()
  // TODO(pro): also notify the backend's "deactivate" endpoint before clearing.
  ent = null
  clearEntitlement()
  return status()
}

// Kept so parseExpiry stays referenced if a backend impl needs it inline.
void parseExpiry
