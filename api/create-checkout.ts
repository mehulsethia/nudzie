type VercelRequestLike = {
  method?: string
  query?: Record<string, string | string[] | undefined>
  body?: unknown
}

type VercelResponseLike = {
  status: (code: number) => VercelResponseLike
  json: (body: unknown) => void
  setHeader: (name: string, value: string) => void
  end: (body?: string) => void
}

type CheckoutResponse = {
  checkout_url?: string
  session_id?: string
}

const DEFAULT_TEST_PRODUCT_ID = 'pdt_0NjNhzbBKhRAFXIfhHWst'
const DEFAULT_LIVE_PRODUCT_ID = 'pdt_0NjNGaI7YglU4NWijdT4B'
const PLACEHOLDER_IDS = new Set(['', 'prod_test_placeholder', 'prod_live_placeholder'])

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

function mode(): 'test' | 'live' {
  const raw = (process.env.DODO_MODE || 'live').toLowerCase()
  return raw === 'test' || raw === 'test_mode' ? 'test' : 'live'
}

function dodoBaseUrl(): string {
  return mode() === 'test' ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com'
}

function siteUrl(): string {
  return (process.env.NUDZIE_SITE_URL || 'https://www.nudzie.app').replace(/\/+$/, '')
}

function productId(): string {
  return mode() === 'test'
    ? process.env.DODO_PRODUCT_ID_TEST || DEFAULT_TEST_PRODUCT_ID
    : process.env.DODO_PRODUCT_ID_LIVE || DEFAULT_LIVE_PRODUCT_ID
}

function apiKey(): string | undefined {
  return mode() === 'test'
    ? process.env.DODO_API_KEY_TEST || process.env.DODO_API_KEY
    : process.env.DODO_API_KEY_LIVE || process.env.DODO_API_KEY
}

function sendError(res: VercelResponseLike, status: number, message: string): void {
  res.status(status).json({ error: message })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function sendHtmlError(res: VercelResponseLike, status: number, message: string): void {
  res.status(status)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Nudzie Pro</title><style>body{font-family:system-ui,sans-serif;max-width:680px;margin:80px auto;padding:0 24px;line-height:1.6;color:#211f36;background:#fdfdf7}a{color:#4a3fca}</style></head><body><h1>Nudzie Pro checkout is not ready yet.</h1><p>${escapeHtml(message)}</p><p><a href="/#pricing">Back to pricing</a></p></body></html>`)
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as Record<string, unknown>
    const detail = data.message || data.error || data.detail
    if (typeof detail === 'string' && detail.trim()) return detail
  } catch {
    /* ignore */
  }
  return `Dodo checkout failed with HTTP ${response.status}.`
}

async function createCheckout(source: string): Promise<CheckoutResponse> {
  const selectedApiKey = apiKey()
  const selectedProductId = productId()
  if (!selectedApiKey) {
    throw new Error(`Missing ${mode() === 'test' ? 'DODO_API_KEY_TEST' : 'DODO_API_KEY_LIVE'}.`)
  }
  if (PLACEHOLDER_IDS.has(selectedProductId)) {
    throw new Error(
      `Missing ${mode() === 'test' ? 'DODO_PRODUCT_ID_TEST' : 'DODO_PRODUCT_ID_LIVE'}.`
    )
  }

  const response = await fetch(`${dodoBaseUrl()}/checkout-sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${selectedApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      product_cart: [{ product_id: selectedProductId, quantity: 1 }],
      return_url: `${siteUrl()}/success`,
      cancel_url: `${siteUrl()}/#pricing`,
      feature_flags: { redirect_immediately: true },
      metadata: {
        app: 'nudzie',
        source,
        mode: mode()
      }
    })
  })

  if (!response.ok) throw new Error(await readError(response))
  return (await response.json()) as CheckoutResponse
}

export default async function handler(
  req: VercelRequestLike,
  res: VercelResponseLike
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS')
    res.status(204).end()
    return
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS')
    sendError(res, 405, 'Method not allowed.')
    return
  }

  const source = first(req.query?.source) || (req.method === 'GET' ? 'app' : 'site')
  const wantsRedirect = req.method === 'GET' && first(req.query?.redirect) !== '0'

  try {
    const checkout = await createCheckout(source)
    if (!checkout.checkout_url) throw new Error('Dodo did not return a checkout URL.')
    if (wantsRedirect) {
      res.status(302)
      res.setHeader('Location', checkout.checkout_url)
      res.end()
      return
    }
    res.status(200).json(checkout)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Checkout could not be created.'
    if (wantsRedirect) sendHtmlError(res, 503, message)
    else sendError(res, 503, message)
  }
}
