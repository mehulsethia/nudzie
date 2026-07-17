const { createHmac, timingSafeEqual } = require('node:crypto') as typeof import('node:crypto')

type HeaderValue = string | string[] | undefined

type VercelRequestLike = {
  method?: string
  headers?: Record<string, HeaderValue>
  query?: Record<string, string | string[] | undefined>
}

type VercelResponseLike = {
  status: (code: number) => VercelResponseLike
  json: (body: unknown) => void
  setHeader: (name: string, value: string | string[]) => void
}

type Mode = 'test' | 'live'

type Payment = {
  created_at?: string
  currency?: string
  customer?: { customer_id?: string; email?: string; name?: string }
  payment_id?: string
  total_amount?: number
  refund_status?: string | null
  status?: string
  product_id?: string
}

type LicenseKey = {
  created_at?: string
  customer_id?: string
  id?: string
  instances_count?: number
  key?: string
  product_id?: string
  status?: string
  activations_limit?: number | null
  payment_id?: string | null
}

type DodoListResponse<T> = {
  items?: T[]
}

type ReleaseAsset = {
  name?: string
  download_count?: number
  browser_download_url?: string
  size?: number
  updated_at?: string
}

type GitHubRelease = {
  name?: string
  tag_name?: string
  published_at?: string
  html_url?: string
  assets?: ReleaseAsset[]
}

const DEFAULT_TEST_PRODUCT_ID = 'pdt_0NjNhzbBKhRAFXIfhHWst'
const DEFAULT_LIVE_PRODUCT_ID = 'pdt_0NjNGaI7YglU4NWijdT4B'
const GITHUB_RELEASES_API =
  process.env.NUDZIE_RELEASES_API ||
  'https://api.github.com/repos/mehulsethia/nudzie-releases/releases/latest'
const ADMIN_EMAIL = 'mehul@senseibles.com'
const ADMIN_PASSWORD_SHA256 =
  process.env.ADMIN_PASSWORD_SHA256 ||
  '11a8c47e65b37964c85e849205f8e0b8f2a75f590245018ed071cbcee7f5d345'
const SESSION_MAX_AGE_SECONDS = 15 * 60

function first(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function sessionSecret(): string {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    process.env.DODO_WEBHOOK_SECRET_LIVE ||
    process.env.DODO_PAYMENTS_WEBHOOK_KEY ||
    ADMIN_PASSWORD_SHA256
  )
}

function sign(value: string): string {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function makeAdminCookie(): string {
  const payload = Buffer.from(
    JSON.stringify({
      email: ADMIN_EMAIL,
      exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000
    }),
    'utf8'
  ).toString('base64url')
  return `nudzie_admin=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`
}

function isAuthed(req: VercelRequestLike): boolean {
  const cookie = first(req.headers?.cookie) || ''
  const raw = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('nudzie_admin='))
    ?.slice('nudzie_admin='.length)
  if (!raw) return false
  const [payload, signature] = raw.split('.')
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return false
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: string
      exp?: number
    }
    return parsed.email === ADMIN_EMAIL && typeof parsed.exp === 'number' && parsed.exp > Date.now()
  } catch {
    return false
  }
}

function modeApiKey(mode: Mode): string | undefined {
  return mode === 'test'
    ? process.env.DODO_API_KEY_TEST || process.env.DODO_API_KEY
    : process.env.DODO_API_KEY_LIVE || process.env.DODO_API_KEY
}

function modeProductId(mode: Mode): string {
  return mode === 'test'
    ? process.env.DODO_PRODUCT_ID_TEST || DEFAULT_TEST_PRODUCT_ID
    : process.env.DODO_PRODUCT_ID_LIVE || DEFAULT_LIVE_PRODUCT_ID
}

function dodoBaseUrl(mode: Mode): string {
  return mode === 'test' ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com'
}

async function dodoList<T>(
  mode: Mode,
  path: string,
  params: Record<string, string | number | undefined> = {},
  maxPages = 5
): Promise<T[]> {
  const apiKey = modeApiKey(mode)
  if (!apiKey) return []

  const rows: T[] = []
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    const url = new URL(`${dodoBaseUrl(mode)}${path}`)
    url.searchParams.set('page_size', '100')
    url.searchParams.set('page_number', String(pageNumber))
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })
    if (!response.ok) throw new Error(`${mode} ${path} failed with HTTP ${response.status}`)
    const data = (await response.json()) as DodoListResponse<T>
    const items = data.items || []
    rows.push(...items)
    if (items.length < 100) break
  }
  return rows
}

function centsToMajor(value: number): number {
  return Math.round(value) / 100
}

function daysAgo(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000
}

function timeValue(value?: string): number {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function maskKey(value?: string): string | null {
  if (!value) return null
  return value.length <= 10 ? '****' : `${value.slice(0, 4)}...${value.slice(-4)}`
}

function uniqueCount(values: Array<string | undefined>): number {
  return new Set(values.filter((value): value is string => !!value)).size
}

function summarizeMode(mode: Mode, payments: Payment[], licenses: LicenseKey[]) {
  const now7 = daysAgo(7)
  const now30 = daysAgo(30)
  const succeeded = payments.filter((p) => p.status === 'succeeded')
  const failed = payments.filter((p) => p.status === 'failed')
  const cancelled = payments.filter((p) => p.status === 'cancelled')
  const refunded = payments.filter((p) => p.refund_status && p.refund_status !== 'none')
  const revenueCents = succeeded.reduce((sum, p) => sum + (p.total_amount || 0), 0)
  const revenue30Cents = succeeded
    .filter((p) => timeValue(p.created_at) >= now30)
    .reduce((sum, p) => sum + (p.total_amount || 0), 0)
  const activeLicenses = licenses.filter((l) => l.status === 'active')
  const disabledLicenses = licenses.filter((l) => l.status === 'disabled')
  const expiredLicenses = licenses.filter((l) => l.status === 'expired')
  const activationsUsed = licenses.reduce((sum, l) => sum + (l.instances_count || 0), 0)

  return {
    mode,
    configured: !!modeApiKey(mode),
    productId: modeProductId(mode),
    currency: succeeded[0]?.currency || 'USD',
    payments: payments.length,
    paidOrders: succeeded.length,
    failedPayments: failed.length,
    cancelledPayments: cancelled.length,
    refundedPayments: refunded.length,
    customers: uniqueCount(payments.map((p) => p.customer?.email || p.customer?.customer_id)),
    revenue: centsToMajor(revenueCents),
    revenue30: centsToMajor(revenue30Cents),
    orders7: succeeded.filter((p) => timeValue(p.created_at) >= now7).length,
    orders30: succeeded.filter((p) => timeValue(p.created_at) >= now30).length,
    licenses: licenses.length,
    activeLicenses: activeLicenses.length,
    disabledLicenses: disabledLicenses.length,
    expiredLicenses: expiredLicenses.length,
    activatedDevices: activationsUsed,
    unactivatedLicenses: licenses.filter((l) => (l.instances_count || 0) === 0).length,
    licenseUtilization:
      licenses.length > 0 ? Math.round((activationsUsed / licenses.length) * 100) : 0,
    recentPayments: payments
      .slice()
      .sort((a, b) => timeValue(b.created_at) - timeValue(a.created_at))
      .slice(0, 12)
      .map((p) => ({
        id: p.payment_id,
        date: p.created_at,
        email: p.customer?.email || null,
        amount: centsToMajor(p.total_amount || 0),
        currency: p.currency || null,
        status: p.status || null,
        refundStatus: p.refund_status || null
      })),
    recentLicenses: licenses
      .slice()
      .sort((a, b) => timeValue(b.created_at) - timeValue(a.created_at))
      .slice(0, 12)
      .map((l) => ({
        id: l.id,
        date: l.created_at,
        key: maskKey(l.key),
        status: l.status || null,
        activations: l.instances_count || 0,
        activationLimit: l.activations_limit,
        paymentId: l.payment_id || null
      }))
  }
}

async function fetchMode(mode: Mode) {
  const product_id = modeProductId(mode)
  const [payments, licenses] = await Promise.all([
    dodoList<Payment>(mode, '/payments', { product_id }),
    dodoList<LicenseKey>(mode, '/license_keys', { product_id })
  ])
  return summarizeMode(mode, payments, licenses)
}

async function fetchDownloads() {
  try {
    const response = await fetch(GITHUB_RELEASES_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'nudzie-admin-dashboard'
      }
    })
    if (!response.ok) throw new Error(`GitHub release failed with HTTP ${response.status}`)
    const release = (await response.json()) as GitHubRelease
    const assets = release.assets || []
    const byAsset = assets.map((asset) => ({
      name: asset.name || 'unknown',
      downloads: asset.download_count || 0,
      size: asset.size || 0,
      url: asset.browser_download_url || null,
      updatedAt: asset.updated_at || null
    }))
    const mac = byAsset
      .filter((asset) => /\.dmg$/i.test(asset.name))
      .reduce((sum, asset) => sum + asset.downloads, 0)
    const windows = byAsset
      .filter((asset) => /\.exe$/i.test(asset.name))
      .reduce((sum, asset) => sum + asset.downloads, 0)
    const total = byAsset.reduce((sum, asset) => sum + asset.downloads, 0)
    return {
      configured: true,
      release: release.name || release.tag_name || 'latest',
      publishedAt: release.published_at || null,
      url: release.html_url || null,
      total,
      mac,
      windows,
      other: total - mac - windows,
      assets: byAsset
    }
  } catch (error) {
    return {
      configured: false,
      error: error instanceof Error ? error.message : 'Could not load downloads.',
      total: 0,
      mac: 0,
      windows: 0,
      other: 0,
      assets: []
    }
  }
}

export default async function handler(
  req: VercelRequestLike,
  res: VercelResponseLike
): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  if (!isAuthed(req)) {
    res.status(401).json({ error: 'Unauthorized.' })
    return
  }
  res.setHeader('Set-Cookie', makeAdminCookie())

  const selected = first(req.query?.mode)
  const modes: Mode[] = selected === 'test' || selected === 'live' ? [selected] : ['live', 'test']
  try {
    const [modeSummaries, downloads] = await Promise.all([
      Promise.all(modes.map((mode) => fetchMode(mode))),
      fetchDownloads()
    ])
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      admin: ADMIN_EMAIL,
      downloads,
      modes: modeSummaries
    })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Could not load admin data.'
    })
  }
}
