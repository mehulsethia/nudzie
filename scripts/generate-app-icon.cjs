// App icon, in priority order:
//   1. assets/app-icon.png — a finished, designed brand icon. If present it WINS
//      and is used verbatim (it already includes its own tile/background). This
//      is the stable path to set the app icon: drop a 1024×1024 PNG there.
//   2. build/icon-master.png — a character-derived icon (from prepare-assets).
//   3. a neutral rounded-tile placeholder, so the build never fails.
// The result is copied to build/icon.png, which electron-builder turns into
// .icns/.ico and which the app also uses at runtime as the default Dock icon.
const fs = require('node:fs')
const path = require('node:path')
const { encodePNG } = require('./png.cjs')

const root = path.join(__dirname, '..')
const buildDir = path.join(root, 'build')
const brand = path.join(root, 'assets', 'app-icon.png')
const master = path.join(buildDir, 'icon-master.png')
const out = path.join(buildDir, 'icon.png')

fs.mkdirSync(buildDir, { recursive: true })

if (fs.existsSync(brand)) {
  fs.copyFileSync(brand, out)
  fs.copyFileSync(brand, master) // keep icon-master consistent with the brand icon
  console.log('Wrote build/icon.png (from assets/app-icon.png — brand icon)')
  return
}

if (fs.existsSync(master)) {
  fs.copyFileSync(master, out)
  console.log('Wrote build/icon.png (from icon-master.png)')
  return
}

const SIZE = 1024
const RADIUS = 200
const BG = { r: 74, g: 163, b: 223 } // #4aa3df

function insideRounded(x, y, s, r) {
  if (x >= r && x <= s - 1 - r) return true
  if (y >= r && y <= s - 1 - r) return true
  const cx = x < r ? r : s - 1 - r
  const cy = y < r ? r : s - 1 - r
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

const buf = Buffer.alloc(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (!insideRounded(x, y, SIZE, RADIUS)) continue
    const i = (y * SIZE + x) * 4
    buf[i] = BG.r
    buf[i + 1] = BG.g
    buf[i + 2] = BG.b
    buf[i + 3] = 255
  }
}
fs.writeFileSync(out, encodePNG(SIZE, buf))
console.log('Wrote build/icon.png (placeholder tile — add build/icon-master.png for real art)')
