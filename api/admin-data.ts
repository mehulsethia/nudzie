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
// All releases, not just the latest one: GitHub resets an asset's download_count
// every time the asset is re-uploaded, so per-release counters only ever describe
// the current build. Lifetime downloads = sum across every release.
const GITHUB_RELEASES_API =
  process.env.NUDZIE_RELEASES_API ||
  'https://api.github.com/repos/mehulsethia/nudzie-releases/releases'
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

function timeValue(value?: string): number {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function maskKey(value?: string): string | null {
  if (!value) return null
  return value.length <= 10 ? '****' : `${value.slice(0, 4)}...${value.slice(-4)}`
}

// Rows go to the browser unaggregated so the dashboard can re-slice them by any
// time span (in the viewer's own timezone) without another round trip to Dodo.
function slimMode(mode: Mode, payments: Payment[], licenses: LicenseKey[]) {
  return {
    mode,
    configured: !!modeApiKey(mode),
    productId: modeProductId(mode),
    payments: payments
      .slice()
      .sort((a, b) => timeValue(b.created_at) - timeValue(a.created_at))
      .map((p) => ({
        id: p.payment_id || null,
        date: p.created_at || null,
        email: p.customer?.email || null,
        customerId: p.customer?.customer_id || null,
        amount: centsToMajor(p.total_amount || 0),
        currency: p.currency || null,
        status: p.status || null,
        refundStatus: p.refund_status || null
      })),
    licenses: licenses
      .slice()
      .sort((a, b) => timeValue(b.created_at) - timeValue(a.created_at))
      .map((l) => ({
        id: l.id || null,
        date: l.created_at || null,
        key: maskKey(l.key),
        status: l.status || null,
        activations: l.instances_count || 0,
        activationLimit: l.activations_limit ?? null,
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
  return slimMode(mode, payments, licenses)
}

async function fetchDownloads() {
  try {
    const url = new URL(GITHUB_RELEASES_API)
    if (!url.searchParams.has('per_page')) url.searchParams.set('per_page', '100')
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'nudzie-admin-dashboard'
    }
    const token = process.env.GITHUB_TOKEN || process.env.NUDZIE_RELEASES_TOKEN
    if (token) headers.Authorization = `Bearer ${token}`

    const response = await fetch(url, { headers })
    if (!response.ok) throw new Error(`GitHub releases failed with HTTP ${response.status}`)
    const payload = (await response.json()) as GitHubRelease | GitHubRelease[]
    const releases = Array.isArray(payload) ? payload : [payload]
    if (releases.length === 0) throw new Error('No releases published yet.')

    const sorted = releases
      .slice()
      .sort((a, b) => timeValue(b.published_at) - timeValue(a.published_at))
    const latest = sorted[0]

    // Same asset name across releases (Nudzie.dmg in v0.1.0, v0.1.1, ...) rolls up
    // into a single lifetime row.
    const totals = new Map<string, { name: string; downloads: number; updatedAt: string | null }>()
    const byRelease = sorted.map((release) => {
      const assets = release.assets || []
      let releaseTotal = 0
      for (const asset of assets) {
        const name = asset.name || 'unknown'
        const downloads = asset.download_count || 0
        releaseTotal += downloads
        const existing = totals.get(name)
        if (existing) {
          existing.downloads += downloads
          if (timeValue(asset.updated_at) > timeValue(existing.updatedAt || undefined)) {
            existing.updatedAt = asset.updated_at || existing.updatedAt
          }
        } else {
          totals.set(name, { name, downloads, updatedAt: asset.updated_at || null })
        }
      }
      return {
        release: release.name || release.tag_name || 'untagged',
        publishedAt: release.published_at || null,
        url: release.html_url || null,
        downloads: releaseTotal
      }
    })

    const assetTotals = Array.from(totals.values()).sort((a, b) => b.downloads - a.downloads)
    const sumWhere = (test: (name: string) => boolean) =>
      assetTotals.filter((a) => test(a.name)).reduce((sum, a) => sum + a.downloads, 0)
    // .zip / .yml / .blockmap are auto-updater traffic, not user downloads.
    const mac = sumWhere((name) => /\.dmg$/i.test(name))
    const windows = sumWhere((name) => /\.exe$/i.test(name))
    const total = assetTotals.reduce((sum, a) => sum + a.downloads, 0)

    return {
      configured: true,
      release: latest.name || latest.tag_name || 'latest',
      publishedAt: latest.published_at || null,
      url: latest.html_url || null,
      releaseCount: sorted.length,
      total,
      mac,
      windows,
      other: total - mac - windows,
      assets: assetTotals,
      releases: byRelease
    }
  } catch (error) {
    return {
      configured: false,
      error: error instanceof Error ? error.message : 'Could not load downloads.',
      total: 0,
      mac: 0,
      windows: 0,
      other: 0,
      assets: [],
      releases: []
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
