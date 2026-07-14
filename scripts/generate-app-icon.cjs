// App icon generation, in priority order for the SOURCE art:
//   1. assets/app-icon.png — a finished, designed brand icon (its own tile/bg).
//   2. build/icon-master.png — a character-derived icon (from prepare-assets).
//   3. a neutral rounded-tile placeholder, so the build never fails.
//
// The source is then composited onto a transparent 1024×1024 canvas with
// PLATFORM-APPROPRIATE padding, so the app icon matches the size of neighbouring
// icons on each OS:
//   • build/icon.png     — macOS: inset to Apple's icon grid (~82% of the canvas)
//                          so the rounded tile isn't edge-to-edge in the Dock.
//   • build/icon-win.png — Windows: nearly full-bleed (small margin), matching
//                          how Windows taskbar/desktop icons fill their box.
// electron-builder turns these into .icns / .ico (see electron-builder.yml), and
// the macOS build/runtime Dock icon uses build/icon.png.
const fs = require('node:fs')
const path = require('node:path')
const Jimp = require('jimp')
const { encodePNG } = require('./png.cjs')

const root = path.join(__dirname, '..')
const buildDir = path.join(root, 'build')
const brand = path.join(root, 'assets', 'app-icon.png')
const master = path.join(buildDir, 'icon-master.png')
const outMac = path.join(buildDir, 'icon.png')
const outWin = path.join(buildDir, 'icon-win.png')

const SIZE = 1024
// Fraction of the canvas the visible tile occupies on each platform.
const MAC_SCALE = 0.82 // Apple icon grid — leaves a transparent margin all round.
const WIN_SCALE = 0.94 // Windows icons sit fuller; a small margin only.

fs.mkdirSync(buildDir, { recursive: true })

// Center `src` scaled to `scale` of the canvas on a transparent SIZE×SIZE image.
function padded(src, scale) {
  const content = Math.round(SIZE * scale)
  const offset = Math.round((SIZE - content) / 2)
  const resized = src.clone().resize(content, content)
  const canvas = new Jimp(SIZE, SIZE, 0x00000000)
  canvas.composite(resized, offset, offset)
  return canvas
}

function placeholderMaster() {
  // Neutral rounded tile so the build never fails when no source art exists.
  const RADIUS = 200
  const BG = { r: 74, g: 163, b: 223 } // #4aa3df
  const inside = (x, y, r) => {
    if (x >= r && x <= SIZE - 1 - r) return true
    if (y >= r && y <= SIZE - 1 - r) return true
    const cx = x < r ? r : SIZE - 1 - r
    const cy = y < r ? r : SIZE - 1 - r
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
  const buf = Buffer.alloc(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!inside(x, y, RADIUS)) continue
      const i = (y * SIZE + x) * 4
      buf[i] = BG.r; buf[i + 1] = BG.g; buf[i + 2] = BG.b; buf[i + 3] = 255
    }
  }
  const tmp = path.join(buildDir, 'icon-master.png')
  fs.writeFileSync(tmp, encodePNG(SIZE, buf))
  return tmp
}

async function main() {
  let sourcePath
  let label
  if (fs.existsSync(brand)) {
    sourcePath = brand
    label = 'assets/app-icon.png (brand icon)'
    fs.copyFileSync(brand, master) // keep icon-master consistent with the brand icon
  } else if (fs.existsSync(master)) {
    sourcePath = master
    label = 'icon-master.png'
  } else {
    sourcePath = placeholderMaster()
    label = 'placeholder tile'
  }

  const src = await Jimp.read(sourcePath)
  // Normalise the source to a square canvas first so scaling is predictable.
  const squared = src.getWidth() === src.getHeight()
    ? src
    : src.clone().cover(SIZE, SIZE)

  await padded(squared, MAC_SCALE).writeAsync(outMac)
  await padded(squared, WIN_SCALE).writeAsync(outWin)
  console.log(`Wrote build/icon.png (macOS, ${Math.round(MAC_SCALE * 100)}%) and ` +
    `build/icon-win.png (Windows, ${Math.round(WIN_SCALE * 100)}%) from ${label}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
