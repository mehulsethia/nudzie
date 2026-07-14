// Generates placeholder menu-bar / tray icons (a simple "nudge" bell dot) as
// proper template PNGs, with no external dependencies. Replace with real art
// later by dropping in build/iconTemplate.png + @2x, or editing this shape.
const fs = require('node:fs')
const path = require('node:path')
const { encodePNG } = require('./png.cjs')

function inCircle(u, v, cx, cy, r) {
  const dx = u - cx
  const dy = v - cy
  return dx * dx + dy * dy <= r * r
}

/** A tiny rounded-bell silhouette (black on transparent) — a neutral placeholder. */
function drawBell(size) {
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size
      const v = (y + 0.5) / size
      const body = inCircle(u, v, 0.5, 0.46, 0.32) && v <= 0.68
      const skirt = v > 0.62 && v <= 0.72 && u > 0.16 && u < 0.84
      const clapper = inCircle(u, v, 0.5, 0.8, 0.07)
      if (body || skirt || clapper) {
        const i = (y * size + x) * 4
        buf[i] = 0
        buf[i + 1] = 0
        buf[i + 2] = 0
        buf[i + 3] = 255
      }
    }
  }
  return buf
}

const outDir = path.join(__dirname, '..', 'build')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'iconTemplate.png'), encodePNG(18, drawBell(18)))
fs.writeFileSync(path.join(outDir, 'iconTemplate@2x.png'), encodePNG(36, drawBell(36)))
console.log('Wrote build/iconTemplate.png and build/iconTemplate@2x.png (placeholder)')
