/**
 * Character-art pipeline (ported from Hydrate Buddy's remove-bg.js).
 *
 * Turns a flat single-colour background in the source art into transparency
 * (border-seeded flood fill, so interior colours matching the bg are preserved),
 * feathers the 1px halo, trims empty margins, and writes ready-to-render sprites.
 *
 * Input : assets/raw/<character>/idle.png  and  assets/raw/<character>/action.png
 *         (falls back to assets/raw/idle.png / action.png for the default char)
 * Output: src/renderer/overlay/characters/<character>/idle.png + action.png
 *
 * Run with:  npm run prepare-assets            (default character = "buddy")
 *            npm run prepare-assets -- <id>     (a specific character folder)
 */
const path = require('node:path')
const fs = require('node:fs')
const Jimp = require('jimp')

const CHARACTER = process.argv[2] || 'buddy'
const ROOT = path.join(__dirname, '..')
// Prefer a per-character raw folder; fall back to the flat assets/raw/ layout.
const perChar = path.join(ROOT, 'assets', 'raw', CHARACTER)
const RAW_DIR = fs.existsSync(perChar) ? perChar : path.join(ROOT, 'assets', 'raw')
const OUT_DIR = path.join(ROOT, 'src', 'renderer', 'overlay', 'characters', CHARACTER)

// How close a pixel must be to the corner colour to count as background.
const TOLERANCE = 72

function removeBackground(image, tolerance) {
  const { width, height, data } = image.bitmap

  // Background colour = average of the four corners.
  const cornerIdx = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + (width - 1)) * 4
  ]
  let br = 0
  let bg = 0
  let bb = 0
  for (const i of cornerIdx) {
    br += data[i]
    bg += data[i + 1]
    bb += data[i + 2]
  }
  br /= 4
  bg /= 4
  bb /= 4

  const tol2 = tolerance * tolerance
  const visited = new Uint8Array(width * height)
  const stack = []

  // Seed the flood fill from every border pixel.
  for (let x = 0; x < width; x++) {
    stack.push(x)
    stack.push((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    stack.push(y * width)
    stack.push(y * width + (width - 1))
  }

  while (stack.length) {
    const p = stack.pop()
    if (visited[p]) continue
    visited[p] = 1

    const i = p * 4
    const dr = data[i] - br
    const dg = data[i + 1] - bg
    const db = data[i + 2] - bb
    if (dr * dr + dg * dg + db * db > tol2) continue // hit the character

    data[i + 3] = 0 // make transparent

    const x = p % width
    const y = (p - x) / width
    if (x + 1 < width) stack.push(p + 1)
    if (x - 1 >= 0) stack.push(p - 1)
    if (y + 1 < height) stack.push(p + width)
    if (y - 1 >= 0) stack.push(p - width)
  }

  // Feather the 1px halo left along the silhouette so edges aren't hard.
  const T2 = tolerance * 1.7
  const T2sq = T2 * T2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const i = p * 4
      if (data[i + 3] === 0) continue

      const touchesEmpty =
        (x > 0 && data[(p - 1) * 4 + 3] === 0) ||
        (x < width - 1 && data[(p + 1) * 4 + 3] === 0) ||
        (y > 0 && data[(p - width) * 4 + 3] === 0) ||
        (y < height - 1 && data[(p + width) * 4 + 3] === 0)
      if (!touchesEmpty) continue

      const dr = data[i] - br
      const dg = data[i + 1] - bg
      const db = data[i + 2] - bb
      const dist2 = dr * dr + dg * dg + db * db
      if (dist2 < T2sq) {
        const d = Math.sqrt(dist2)
        const a = Math.round(((d - tolerance) / (T2 - tolerance)) * 255)
        const clamped = Math.max(0, Math.min(255, a))
        if (clamped < data[i + 3]) data[i + 3] = clamped
      }
    }
  }

  return image
}

async function processPose(name) {
  const src = path.join(RAW_DIR, `${name}.png`)
  if (!fs.existsSync(src)) {
    console.warn(`  - ${name}.png missing in ${RAW_DIR} (skipped)`)
    return null
  }
  const out = path.join(OUT_DIR, `${name}.png`)
  console.log(`  - ${name}.png ...`)
  const image = await Jimp.read(src)
  removeBackground(image, TOLERANCE)
  try {
    image.autocrop({ tolerance: 0.002, cropOnlyFrames: false })
  } catch (e) {
    console.log(`    (autocrop skipped: ${e.message})`)
  }
  await image.writeAsync(out)
  return image
}

// A loose skin-tone test (works across light–medium–brown tones; excludes hair,
// glasses, dark clothing). Used to locate the face for the icon crops.
function isSkin(r, g, b) {
  return r > 60 && g > 40 && b > 20 && r > g && g >= b && r - b > 15 && r < 250
}

/**
 * Finds a square crop centred on the character's face, by locating the bounding
 * box of skin-tone pixels in the (transparent) idle sprite. This makes the icon
 * work for BOTH full-body sprites (small head near the top) and head-and-
 * shoulders busts (head fills the frame). Returns null if no clear face is found
 * so callers can fall back to the old top-of-sprite crop.
 */
function computeFaceBox(image) {
  const { width: w, height: h, data } = image.bitmap
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  let count = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (data[i + 3] < 200) continue
      if (!isSkin(data[i], data[i + 1], data[i + 2])) continue
      count++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0 || count < w * h * 0.002) return null
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  // Include some hair above and a little shoulder below the skin box.
  let size = Math.round(Math.max(maxX - minX, maxY - minY) * 1.5)
  size = Math.max(1, Math.min(size, Math.min(w, h)))
  let x = Math.round(cx - size / 2)
  let y = Math.round(cy - size / 2)
  x = Math.max(0, Math.min(x, w - size))
  y = Math.max(0, Math.min(y, h - size))
  return { x, y, size }
}

/** Old fixed crop (head near the top) — fallback when no face is detected. */
function topFaceBox(w, h) {
  const size = Math.round(h * 0.27)
  const cx = Math.round(w * 0.46)
  const x = Math.max(0, Math.min(Math.round(cx - size / 2), w - size))
  const y = Math.max(0, Math.min(Math.round(h * 0.02), h - size))
  return { x, y, size }
}

/**
 * Carves a face crop from the (transparent) idle sprite for the menu-bar / tray
 * icon — the character becomes the tray icon. Face-aware (see computeFaceBox),
 * output at menu-bar sizes with an @2x retina variant. Written to build/tray.png.
 */
async function makeTrayIcon(idleImage) {
  const buildDir = path.join(ROOT, 'build')
  fs.mkdirSync(buildDir, { recursive: true })
  try {
    const w = idleImage.bitmap.width
    const h = idleImage.bitmap.height
    const box = computeFaceBox(idleImage) ?? topFaceBox(w, h)
    const face = idleImage.clone().crop(box.x, box.y, box.size, box.size)
    // Menu-bar sizes (macOS renders ~18–22px tall). @2x for retina crispness.
    await face.clone().resize(20, 20).writeAsync(path.join(buildDir, 'tray.png'))
    await face.clone().resize(40, 40).writeAsync(path.join(buildDir, 'tray@2x.png'))
    console.log('  - build/tray.png + @2x (character face)')
  } catch (e) {
    console.log(`    (tray icon skipped: ${e.message})`)
  }
}

/**
 * Composes the app icon (build/icon-master.png, 1024²) from the character's face
 * on a rounded tile — so the Dock / taskbar icon IS the character. generate-app-
 * icon.cjs then copies this to build/icon.png. (Ported from Hydrate Buddy's
 * make-icon.js, scaled up.)
 *
 * The tile is INSET with ~10% transparent padding on every side, matching
 * Apple's macOS icon grid (~824/1024). Without this, the tile fills the whole
 * canvas and macOS renders it visibly larger than neighbouring Dock icons.
 */
async function makeAppIcon(idleImage) {
  // A designed brand icon (assets/app-icon.png) always wins — don't clobber it
  // with a character-derived one.
  if (fs.existsSync(path.join(ROOT, 'assets', 'app-icon.png'))) {
    console.log('  - app icon: using assets/app-icon.png (brand icon) — skipped')
    return
  }
  const buildDir = path.join(ROOT, 'build')
  fs.mkdirSync(buildDir, { recursive: true })
  const SIZE = 1024
  const MARGIN = Math.round(SIZE * 0.1) // ~102px transparent padding each side
  const TILE = SIZE - MARGIN * 2 // ~820px rounded tile
  const RADIUS = Math.round(TILE * 0.225) // Apple-ish corner radius
  // Diagonal gradient (top-left → bottom-right): light sky blue → indigo.
  const GRAD_A = { r: 0x63, g: 0xb8, b: 0xf5 } // #63b8f5
  const GRAD_B = { r: 0x3b, g: 0x4c, b: 0xc9 } // #3b4cc9
  const lerp = (a, b, t) => Math.round(a + (b - a) * t)

  // Rounded-rect test in the tile's local coordinates.
  const inTile = (lx, ly) => {
    if (lx < 0 || ly < 0 || lx >= TILE || ly >= TILE) return false
    if (lx >= RADIUS && lx <= TILE - 1 - RADIUS) return true
    if (ly >= RADIUS && ly <= TILE - 1 - RADIUS) return true
    const cx = lx < RADIUS ? RADIUS : TILE - 1 - RADIUS
    const cy = ly < RADIUS ? RADIUS : TILE - 1 - RADIUS
    const dx = lx - cx
    const dy = ly - cy
    return dx * dx + dy * dy <= RADIUS * RADIUS
  }

  try {
    const icon = new Jimp(SIZE, SIZE, 0x00000000)
    icon.scan(0, 0, SIZE, SIZE, function (x, y, idx) {
      const lx = x - MARGIN
      const ly = y - MARGIN
      if (inTile(lx, ly)) {
        const t = Math.max(0, Math.min(1, (lx + ly) / (2 * TILE)))
        this.bitmap.data[idx] = lerp(GRAD_A.r, GRAD_B.r, t)
        this.bitmap.data[idx + 1] = lerp(GRAD_A.g, GRAD_B.g, t)
        this.bitmap.data[idx + 2] = lerp(GRAD_A.b, GRAD_B.b, t)
        this.bitmap.data[idx + 3] = 255
      }
    })

    const w = idleImage.bitmap.width
    const h = idleImage.bitmap.height
    const box = computeFaceBox(idleImage) ?? topFaceBox(w, h)
    // Face sits inside the tile (about 62% of the tile width, near its top).
    const face = idleImage.clone().crop(box.x, box.y, box.size, box.size).resize(Math.round(TILE * 0.62), Jimp.AUTO)
    const px = Math.round((SIZE - face.bitmap.width) / 2)
    const py = MARGIN + Math.round(TILE * 0.14)
    icon.composite(face, px, py)
    await icon.writeAsync(path.join(buildDir, 'icon-master.png'))
    console.log('  - build/icon-master.png (character app icon)')
  } catch (e) {
    console.log(`    (app icon skipped: ${e.message})`)
  }
}

;(async () => {
  if (!fs.existsSync(path.join(RAW_DIR, 'idle.png'))) {
    console.error(`Missing ${path.join(RAW_DIR, 'idle.png')} — nothing to process.`)
    process.exit(1)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  console.log(`Preparing transparent sprites for "${CHARACTER}":`)
  const idle = await processPose('idle')
  await processPose('action')
  // The default character also becomes the tray icon + app icon.
  if (idle && CHARACTER === 'buddy') {
    await makeTrayIcon(idle)
    await makeAppIcon(idle)
  }
  console.log(`Done. Sprites written to ${path.relative(ROOT, OUT_DIR)}/`)
})()
