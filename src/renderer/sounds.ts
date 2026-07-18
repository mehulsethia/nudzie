// A tiny sound helper for the corner-walk overlay. Sound selection is gated by
// the main process; this renderer only resolves approved bundled ids and plays
// custom data URLs. Kept simple: decode once, cache, play on demand.
import chimeUrl from '../../assets/sound/chime.mp3'
import kalimbaPluckUrl from '../../assets/sound/kalimba-pluck.mp3'
import popUrl from '../../assets/sound/pop.mp3'
import sparkleUrl from '../../assets/sound/sparkle.mp3'
import steelDrumUrl from '../../assets/sound/steel-drum.mp3'
import synthBlipUrl from '../../assets/sound/synth-blip.mp3'
import zenBowlUrl from '../../assets/sound/zen-bowl.mp3'

const URLS: Record<string, string> = {
  chime: chimeUrl,
  'kalimba-pluck': kalimbaPluckUrl,
  pop: popUrl,
  sparkle: sparkleUrl,
  'steel-drum': steelDrumUrl,
  'synth-blip': synthBlipUrl,
  'zen-bowl': zenBowlUrl
}

const buffers: Record<string, AudioBuffer> = {}
const loading: Record<string, Promise<void>> = {}

function load(ctx: AudioContext, id: string): Promise<void> {
  if (buffers[id]) return Promise.resolve()
  const url = URLS[id] ?? URLS.chime
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

/** Play an arbitrary audio URL (e.g. a user's custom-sound data URL). */
export function playSoundUrl(ctx: AudioContext, url: string, volume = 0.9): void {
  if (!url) return
  void fetch(url)
    .then((r) => r.arrayBuffer())
    .then((buf) => ctx.decodeAudioData(buf))
    .then((decoded) => {
      const src = ctx.createBufferSource()
      src.buffer = decoded
      const gain = ctx.createGain()
      gain.gain.value = volume
      src.connect(gain).connect(ctx.destination)
      src.start()
    })
    .catch(() => {
      /* ignore undecodable audio */
    })
}
