const { createHmac, timingSafeEqual } = require('node:crypto') as typeof import('node:crypto')

type VercelRequestLike = {
  method?: string
  headers?: Record<string, string | string[] | undefined>
}

type VercelResponseLike = {
  status: (code: number) => VercelResponseLike
  json: (body: unknown) => void
  setHeader: (name: string, value: string | string[]) => void
}

const ADMIN_EMAIL = 'mehul@senseibles.com'
const ADMIN_PASSWORD_SHA256 =
  process.env.ADMIN_PASSWORD_SHA256 ||
  '11a8c47e65b37964c85e849205f8e0b8f2a75f590245018ed071cbcee7f5d345'
const SESSION_MAX_AGE_SECONDS = 15 * 60

function first(value: string | string[] | undefined): string | undefined {
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

export default async function handler(
  req: VercelRequestLike,
  res: VercelResponseLike
): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }
  if (!isAuthed(req)) {
    res.status(401).json({ error: 'Unauthorized.' })
    return
  }
  res.setHeader('Set-Cookie', makeAdminCookie())
  res.status(200).json({ ok: true })
}
