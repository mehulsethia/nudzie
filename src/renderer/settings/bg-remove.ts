// Client-side character-art pipeline — a Canvas port of the jimp
// `scripts/prepare-assets.cjs` pipeline, so a user's uploaded images can be
// processed in-app (in the settings renderer) without shipping jimp at runtime.
// Same algorithm: border-seeded flood fill of the flat background to
// transparency, edge feather, autocrop. Then a small face crop for the tray.

const TOLERANCE = 72

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read that image.'))
    img.src = src
  })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('Could not read that file.'))
    fr.readAsDataURL(file)
  })
}

function removeBackground(data: Uint8ClampedArray, width: number, height: number): void {
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

  const tol2 = TOLERANCE * TOLERANCE
  const visited = new Uint8Array(width * height)
  const stack: number[] = []

  for (let x = 0; x < width; x++) {
    stack.push(x)
    stack.push((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    stack.push(y * width)
    stack.push(y * width + (width - 1))
  }

  while (stack.length) {
    const p = stack.pop() as number
    if (visited[p]) continue
    visited[p] = 1

    const i = p * 4
    const dr = data[i] - br
    const dg = data[i + 1] - bg
    const db = data[i + 2] - bb
    if (dr * dr + dg * dg + db * db > tol2) continue // hit the character

    data[i + 3] = 0 // transparent

    const x = p % width
    const y = (p - x) / width
    if (x + 1 < width) stack.push(p + 1)
    if (x - 1 >= 0) stack.push(p - 1)
    if (y + 1 < height) stack.push(p + width)
    if (y - 1 >= 0) stack.push(p - width)
  }

  // Feather the 1px halo along the silhouette.
  const T2 = TOLERANCE * 1.7
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
        const a = Math.round(((d - TOLERANCE) / (T2 - TOLERANCE)) * 255)
        const clamped = Math.max(0, Math.min(255, a))
        if (clamped < data[i + 3]) data[i + 3] = clamped
      }
    }
  }
}

/** Bounding box of non-transparent pixels (for autocrop). */
function contentBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number
): { x: number; y: number; w: number; h: number } {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 4) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: width, h: height }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** Removes the flat background from an uploaded file → transparent PNG data URL. */
export async function processCharacterImage(file: File): Promise<string> {
  const img = await loadImage(await fileToDataUrl(file))
  const w = img.naturalWidth
  const h = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not available.')
  ctx.drawImage(img, 0, 0)

  const imageData = ctx.getImageData(0, 0, w, h)
  removeBackground(imageData.data, w, h)
  ctx.putImageData(imageData, 0, 0)

  // Autocrop to the character.
  const b = contentBounds(imageData.data, w, h)
  const out = document.createElement('canvas')
  out.width = b.w
  out.height = b.h
  const octx = out.getContext('2d')
  if (!octx) throw new Error('Canvas not available.')
  octx.drawImage(canvas, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h)
  return out.toDataURL('image/png')
}

// Loose skin-tone test (mirrors scripts/prepare-assets.cjs) to locate the face.
function isSkin(r: number, g: number, b: number): boolean {
  return r > 60 && g > 40 && b > 20 && r > g && g >= b && r - b > 15 && r < 250
}

/**
 * Finds a square crop centred on the face via the skin-tone bounding box, so the
 * icon works for both full-body sprites and head-and-shoulders busts. Falls back
 * to the old top-of-sprite crop when no clear face is found.
 */
function faceBox(img: HTMLImageElement): { x: number; y: number; size: number } {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const fallback = (): { x: number; y: number; size: number } => {
    const size = Math.round(h * 0.27)
    const cx = Math.round(w * 0.46)
    return {
      x: Math.max(0, Math.min(Math.round(cx - size / 2), w - size)),
      y: Math.max(0, Math.min(Math.round(h * 0.02), h - size)),
      size
    }
  }
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const cx2 = c.getContext('2d')
  if (!cx2) return fallback()
  cx2.drawImage(img, 0, 0)
  const data = cx2.getImageData(0, 0, w, h).data
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
  if (maxX < 0 || count < w * h * 0.002) return fallback()
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  let size = Math.round(Math.max(maxX - minX, maxY - minY) * 1.5)
  size = Math.max(1, Math.min(size, Math.min(w, h)))
  return {
    x: Math.max(0, Math.min(Math.round(cx - size / 2), w - size)),
    y: Math.max(0, Math.min(Math.round(cy - size / 2), h - size)),
    size
  }
}

/** Carves a face crop from a (transparent) idle sprite for the tray icon. */
export async function makeTrayFromIdle(idleDataUrl: string): Promise<string> {
  const img = await loadImage(idleDataUrl)
  const box = faceBox(img)
  const out = document.createElement('canvas')
  out.width = 40
  out.height = 40
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('Canvas not available.')
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(img, box.x, box.y, box.size, box.size, 0, 0, 40, 40)
  return out.toDataURL('image/png')
}

/**
 * Composes an app-icon (Dock / taskbar) from a (transparent) idle sprite: the
 * character's face on a rounded blue tile — matching the build-time app icon so
 * a custom character updates the app icon to match. Output 512², PNG data URL.
 */
export async function makeAppIconFromIdle(idleDataUrl: string): Promise<string> {
  const img = await loadImage(idleDataUrl)
  const SIZE = 512
  const MARGIN = Math.round(SIZE * 0.1) // ~10% transparent padding (macOS grid)
  const TILE = SIZE - MARGIN * 2
  const RADIUS = Math.round(TILE * 0.225)
  const out = document.createElement('canvas')
  out.width = SIZE
  out.height = SIZE
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('Canvas not available.')

  // Rounded tile, inset by MARGIN (transparent surround).
  const tilePath = (): void => {
    ctx.beginPath()
    ctx.moveTo(MARGIN + RADIUS, MARGIN)
    ctx.arcTo(MARGIN + TILE, MARGIN, MARGIN + TILE, MARGIN + TILE, RADIUS)
    ctx.arcTo(MARGIN + TILE, MARGIN + TILE, MARGIN, MARGIN + TILE, RADIUS)
    ctx.arcTo(MARGIN, MARGIN + TILE, MARGIN, MARGIN, RADIUS)
    ctx.arcTo(MARGIN, MARGIN, MARGIN + TILE, MARGIN, RADIUS)
    ctx.closePath()
  }
  // Diagonal gradient (top-left → bottom-right): light sky blue → indigo.
  const grad = ctx.createLinearGradient(MARGIN, MARGIN, MARGIN + TILE, MARGIN + TILE)
  grad.addColorStop(0, '#63b8f5')
  grad.addColorStop(0.55, '#4a86ec')
  grad.addColorStop(1, '#3b4cc9')
  ctx.fillStyle = grad
  tilePath()
  ctx.fill()

  // Face crop from the idle sprite, clipped to the tile and centered near top.
  const box = faceBox(img)
  const dw = Math.round(TILE * 0.62)
  const dh = dw
  ctx.save()
  tilePath()
  ctx.clip()
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(img, box.x, box.y, box.size, box.size, (SIZE - dw) / 2, MARGIN + Math.round(TILE * 0.14), dw, dh)
  ctx.restore()
  return out.toDataURL('image/png')
}
