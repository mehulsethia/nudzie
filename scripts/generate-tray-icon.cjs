// Menu-bar / tray icon generation.
//   • build/tray.png (+ @2x) = the brand app icon, resized. Using the app icon
//     (not the character) keeps the menu-bar mark clean and avoids an awkward
//     face crop of a full-body sprite.
//   • build/iconTemplate.png (+ @2x) = a monochrome bell, kept only as a fallback
//     for when no brand icon exists.
const fs = require('node:fs')
const path = require('node:path')
const Jimp = require('jimp')
const { encodePNG } = require('./png.cjs')

function inCircle(u, v, cx, cy, r) {
  const dx = u - cx
  const dy = v - cy
  return dx * dx + dy * dy <= r * r
}

/** A tiny rounded-bell silhouette (black on transparent) - a neutral placeholder. */
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

const ROOT = path.join(__dirname, '..')
const outDir = path.join(ROOT, 'build')
fs.mkdirSync(outDir, { recursive: true })

// Bell template fallback.
fs.writeFileSync(path.join(outDir, 'iconTemplate.png'), encodePNG(18, drawBell(18)))
fs.writeFileSync(path.join(outDir, 'iconTemplate@2x.png'), encodePNG(36, drawBell(36)))
console.log('Wrote build/iconTemplate.png + @2x (bell fallback)')

// The real menu-bar icon: the brand app icon at menu-bar sizes.
;(async () => {
  const brand = path.join(ROOT, 'assets', 'app-icon.png')
  if (!fs.existsSync(brand)) return
  const img = await Jimp.read(brand)
  await img.clone().resize(22, 22).writeAsync(path.join(outDir, 'tray.png'))
  await img.clone().resize(44, 44).writeAsync(path.join(outDir, 'tray@2x.png'))
  console.log('Wrote build/tray.png + @2x (brand app icon)')
})()
