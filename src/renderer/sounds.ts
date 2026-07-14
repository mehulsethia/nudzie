// A tiny sound helper for the corner-walk overlay (ported/trimmed from QuakPit's
// sounds module). Ships one free "chime" sample; the Pro build can add more,
// gated by the license in the main process. Kept simple: decode once, cache,
// play on demand.
import chimeUrl from './overlay/chime.wav'

const URLS: Record<string, string> = {
  chime: chimeUrl
}

const buffers: Record<string, AudioBuffer> = {}
const loading: Record<string, Promise<void>> = {}

function load(ctx: AudioContext, id: string): Promise<void> {
  if (buffers[id]) return Promise.resolve()
  const url = URLS[id]
  if (!url) return Promise.resolve()
  if (!loading[id]) {
    loading[id] = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => {
        buffers[id] = decoded
      })
      .catch(() => {
        delete loading[id]
      })
  }
  return loading[id]
}

export function playSound(ctx: AudioContext, id = 'chime', when?: number, volume = 0.9): void {
  const at = when ?? ctx.currentTime
  void load(ctx, id).then(() => {
    const buffer = buffers[id]
    if (!buffer) return
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = volume
    src.connect(gain).connect(ctx.destination)
    src.start(Math.max(at, ctx.currentTime))
  })
}
