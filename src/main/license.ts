import { createHash } from 'node:crypto'
import os from 'node:os'
import { machineIdSync } from 'node-machine-id'
import { clearEntitlement, loadEntitlement, saveEntitlement } from './store'

// ---------------------------------------------------------------------------
// LICENSE CHECK - Dodo license-key entitlements.
//
// Checkout is created by the website/serverless API because it needs the
// private Dodo API key. The desktop app only calls Dodo's public license
// endpoints directly: activate, validate, deactivate.
//
// Dev/testing: set env NUDZIE_FORCE_PRO=1 to force premium and exercise Pro
// gates without a Dodo key. Set NUDZIE_DODO_MODE=test to hit Dodo test mode.
// ---------------------------------------------------------------------------

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
  instanceId: string // Dodo license_key_instance_id
  status: string // granted | revoked | disabled
  validatedAt: number
  expiresAt: number | null
}

type DodoLicenseResponse = {
  id?: string
  valid?: boolean
  error?: string
  message?: string
  detail?: string
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

function dodoMode(): 'test' | 'live' {
  const raw = (process.env.NUDZIE_DODO_MODE || process.env.DODO_MODE || 'live').toLowerCase()
  return raw === 'test' || raw === 'test_mode' ? 'test' : 'live'
}

function dodoBaseUrl(): string {
  return dodoMode() === 'test'
    ? 'https://test.dodopayments.com'
    : 'https://live.dodopayments.com'
}

async function dodoPost(path: string, body: Record<string, unknown>): Promise<DodoLicenseResponse> {
  const response = await fetch(`${dodoBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  let data: DodoLicenseResponse = {}
  try {
    data = (await response.json()) as DodoLicenseResponse
  } catch {
    /* Dodo can still fail with an empty/non-JSON body. */
  }

  if (!response.ok) {
    const message = data.message || data.error || data.detail || `Dodo returned HTTP ${response.status}.`
    throw new Error(message)
  }
  return data
}

/**
 * THE SINGLE PRO GATE. Every Pro feature/asset ultimately checks this. A Dodo
 * key must be activated and have a recent successful validation, or
 * NUDZIE_FORCE_PRO=1 must be set for local testing.
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
// monetisation). Pro-only keeps the free tier simple: default characters,
// default bubble, default font, default sound.
// ---------------------------------------------------------------------------
export const CUSTOM_CHARACTER_REQUIRES_PRO = true

export function canUseCustomCharacter(): boolean {
  return !CUSTOM_CHARACTER_REQUIRES_PRO || isPremium()
}

// Temporary launch/testing flag. Keep false for public builds: Pro appearance
// customizations must remain locked unless the license is active.
export const APPEARANCE_CUSTOMIZATIONS_FREE_FOR_TESTING = false

export function canUseAppearanceCustomizations(): boolean {
  return APPEARANCE_CUSTOMIZATIONS_FREE_FOR_TESTING || isPremium()
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

type VerifyResult = { instanceId: string; status: string; expiresAt: number | null }

/** Activate (bind) a key to this device. Dodo enforces the activation limit. */
async function verifyKey(key: string, label: string): Promise<VerifyResult> {
  const data = await dodoPost('/licenses/activate', {
    license_key: key,
    name: label
  })
  if (!data.id) throw new Error('Dodo did not return a license activation id.')
  return { instanceId: data.id, status: 'granted', expiresAt: null }
}

/** Re-check a previously activated key. */
async function revalidateKey(e: Entitlement): Promise<VerifyResult> {
  const data = await dodoPost('/licenses/validate', {
    license_key: e.key,
    license_key_instance_id: e.instanceId
  })
  return {
    instanceId: e.instanceId,
    status: data.valid === true ? 'granted' : 'disabled',
    expiresAt: null
  }
}

/** Binds the key to this device (backend enforces the per-key device limit). */
export async function activate(key: string): Promise<LicenseStatus> {
  const trimmed = key.trim()
  if (!trimmed) throw new Error('Please enter a license key.')

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
  if (!ent) return status()
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
  if (ent) {
    await dodoPost('/licenses/deactivate', {
      license_key: ent.key,
      license_key_instance_id: ent.instanceId
    })
  }
  ent = null
  clearEntitlement()
  return status()
}
