const { createHmac, timingSafeEqual } = require('node:crypto') as typeof import('node:crypto')

type HeaderValue = string | string[] | undefined

type VercelRequestLike = {
  method?: string
  headers?: Record<string, HeaderValue>
  body?: unknown
  on?: (event: string, cb: (chunk?: Buffer | Error) => void) => void
}

type VercelResponseLike = {
  status: (code: number) => VercelResponseLike
  json: (body: unknown) => void
  setHeader: (name: string, value: string) => void
  end: (body?: string) => void
}

type DodoWebhookEvent = {
  business_id?: string
  type?: string
  timestamp?: string
  data?: {
    payload_type?: string
    product_id?: string
    license_key_id?: string
    payment_id?: string
    customer?: { email?: string }
    email?: string
    [key: string]: unknown
  }
}

type MatchedSecret = {
  mode: 'test' | 'live' | 'default'
  secret: string
}

export const config = {
  api: {
    bodyParser: false
  }
}

const ALLOWED_EVENTS = new Set([
  'payment.succeeded',
  'payment.failed',
  'payment.cancelled',
  'refund.succeeded',
  'refund.failed',
  'license_key.created',
  'entitlement_grant.created',
  'entitlement_grant.delivered',
  'entitlement_grant.failed',
  'entitlement_grant.revoked',
  'abandoned_checkout.detected',
  'abandoned_checkout.recovered'
])

function first(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function header(req: VercelRequestLike, name: string): string | undefined {
  const headers = req.headers || {}
  return first(headers[name]) || first(headers[name.toLowerCase()])
}

function webhookSecrets(): MatchedSecret[] {
  const configured = [
    { mode: 'test' as const, secret: process.env.DODO_WEBHOOK_SECRET_TEST },
    { mode: 'live' as const, secret: process.env.DODO_WEBHOOK_SECRET_LIVE },
    { mode: 'default' as const, secret: process.env.DODO_PAYMENTS_WEBHOOK_KEY },
    { mode: 'default' as const, secret: process.env.DODO_WEBHOOK_SECRET }
  ]
  return configured.filter((s): s is MatchedSecret => !!s.secret)
}

function secretKey(secret: string): Buffer {
  if (secret.startsWith('whsec_')) return Buffer.from(secret.slice('whsec_'.length), 'base64')
  return Buffer.from(secret, 'utf8')
}

function signatureCandidates(signature: string): string[] {
  return signature
    .split(/\s+/)
    .flatMap((part) => {
      if (!part) return []
      if (part.startsWith('v1,')) return [part.slice(3)]
      if (part.startsWith('v1=')) return [part.slice(3)]
      if (part.includes(',')) return [part.split(',').slice(1).join(',')]
      return [part]
    })
    .filter(Boolean)
}

function safeCompare(a: string, b: string, encoding: BufferEncoding): boolean {
  try {
    const left = Buffer.from(a, encoding)
    const right = Buffer.from(b, encoding)
    return left.length === right.length && timingSafeEqual(left, right)
  } catch {
    return false
  }
}

function verifySignature(rawBody: string, req: VercelRequestLike): MatchedSecret | null {
  const webhookId = header(req, 'webhook-id')
  const timestamp = header(req, 'webhook-timestamp')
  const signature = header(req, 'webhook-signature')
  if (!webhookId || !timestamp || !signature) return null

  const timestampMs = Number(timestamp) * 1000
  if (!Number.isFinite(timestampMs)) return null
  const ageMs = Math.abs(Date.now() - timestampMs)
  if (ageMs > 10 * 60 * 1000) return null

  const signedPayload = `${webhookId}.${timestamp}.${rawBody}`
  const candidates = signatureCandidates(signature)
  for (const configuredSecret of webhookSecrets()) {
    const key = secretKey(configuredSecret.secret)
    const base64Digest = createHmac('sha256', key).update(signedPayload).digest('base64')
    const hexDigest = createHmac('sha256', key).update(signedPayload).digest('hex')
    if (
      candidates.some(
        (candidate) =>
          safeCompare(candidate, base64Digest, 'base64') || safeCompare(candidate, hexDigest, 'hex')
      )
    ) {
      return configuredSecret
    }
  }
  return null
}

function readRawBody(req: VercelRequestLike): Promise<string> {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString('utf8'))
  if (typeof req.body === 'string') return Promise.resolve(req.body)
  if (req.body != null) return Promise.resolve(JSON.stringify(req.body))
  if (typeof req.on !== 'function') return Promise.resolve('')

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on?.('data', (chunk?: Buffer | Error) => {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk)
    })
    req.on?.('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on?.('error', (error?: Buffer | Error) => reject(error))
  })
}

function safeEventLog(event: DodoWebhookEvent, webhookId: string | undefined, mode: string): void {
  const payload = event.data || {}
  console.log('dodo.webhook.received', {
    webhookId,
    mode,
    type: event.type || 'unknown',
    payloadType: payload.payload_type || 'unknown',
    productId: typeof payload.product_id === 'string' ? payload.product_id : undefined,
    paymentId: typeof payload.payment_id === 'string' ? payload.payment_id : undefined,
    licenseKeyId: typeof payload.license_key_id === 'string' ? payload.license_key_id : undefined,
    allowed: !!event.type && ALLOWED_EVENTS.has(event.type)
  })
}

export default async function handler(
  req: VercelRequestLike,
  res: VercelResponseLike
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS')
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  const rawBody = await readRawBody(req)
  const secrets = webhookSecrets()
  if (secrets.length === 0) {
    res.status(503).json({ error: 'Webhook signing secret is not configured.' })
    return
  }

  const matchedSecret = verifySignature(rawBody, req)
  if (!matchedSecret) {
    res.status(401).json({ error: 'Invalid signature.' })
    return
  }

  let event: DodoWebhookEvent
  try {
    event = JSON.parse(rawBody) as DodoWebhookEvent
  } catch {
    res.status(400).json({ error: 'Invalid JSON payload.' })
    return
  }

  safeEventLog(event, header(req, 'webhook-id'), matchedSecret.mode)
  res.status(200).json({ received: true })
}
