import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

type VercelRequestLike = {
  method?: string
  body?: unknown
}

type VercelResponseLike = {
  status: (code: number) => VercelResponseLike
  json: (body: unknown) => void
  setHeader: (name: string, value: string | string[]) => void
  end: (body?: string) => void
}

const ADMIN_EMAIL = 'mehul@senseibles.com'
const ADMIN_PASSWORD_SHA256 =
  process.env.ADMIN_PASSWORD_SHA256 ||
  '11a8c47e65b37964c85e849205f8e0b8f2a75f590245018ed071cbcee7f5d345'

function sessionSecret(): string {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    process.env.DODO_WEBHOOK_SECRET_LIVE ||
    process.env.DODO_PAYMENTS_WEBHOOK_KEY ||
    ADMIN_PASSWORD_SHA256
  )
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function sign(value: string): string {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex')
}

function parseBody(body: unknown): Record<string, unknown> {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
}

function makeCookie(): string {
  const payload = base64url(
    JSON.stringify({
      email: ADMIN_EMAIL,
      exp: Date.now() + 12 * 60 * 60 * 1000
    })
  )
  return `nudzie_admin=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`
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

  const body = parseBody(req.body)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const passwordHash = hashPassword(password)

  if (email !== ADMIN_EMAIL || !safeEqual(passwordHash, ADMIN_PASSWORD_SHA256)) {
    res.status(401).json({ error: 'Invalid credentials.' })
    return
  }

  res.setHeader('Set-Cookie', makeCookie())
  res.status(200).json({ ok: true, email: ADMIN_EMAIL })
}
