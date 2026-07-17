type VercelRequestLike = {
  method?: string
}

type VercelResponseLike = {
  status: (code: number) => VercelResponseLike
  json: (body: unknown) => void
  setHeader: (name: string, value: string | string[]) => void
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
  res.setHeader('Set-Cookie', 'nudzie_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0')
  res.status(200).json({ ok: true })
}
