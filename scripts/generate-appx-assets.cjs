// MSIX/AppX tile assets for the Microsoft Store build.
//
// electron-builder does NOT let you choose this folder: AppxTarget reads user
// assets from `<buildResources>/appx` (build/appx here) and maps every file in
// it to `assets\<name>` inside the package. Any of the four required logos we
// don't provide are silently replaced with electron-builder's SAMPLE artwork —
// which the Store would reject — so all of them are generated here.
//
// Source art follows the same priority as generate-app-icon.cjs:
//   1. assets/app-icon.png — the finished brand icon.
//   2. build/icon-master.png — character-derived icon from prepare-assets.
//
// Square logos are inset slightly on a transparent canvas; the wide tile and
// splash screen center the logo with generous margin. Transparency is
// deliberate: Windows composites tiles over appx.backgroundColor, so the tile
// picks up the brand colour instead of baking in a background that would clash
// with the user's accent-coloured Start menu.
const fs = require('node:fs')
const path = require('node:path')
const Jimp = require('jimp')

const root = path.join(__dirname, '..')
const buildDir = path.join(root, 'build')
const outDir = path.join(buildDir, 'appx')
const brand = path.join(root, 'assets', 'app-icon.png')
const master = path.join(buildDir, 'icon-master.png')

// name -> [width, height, logo scale relative to the SHORTER side]
const TARGETS = {
  // Required by the appx manifest template. Missing => sample art is used.
  'Square44x44Logo.png': [44, 44, 0.9],
  'Square150x150Logo.png': [150, 150, 0.9],
  'Wide310x150Logo.png': [310, 150, 0.8],
  'StoreLogo.png': [50, 50, 0.9],
  // Optional, but Store listings look unfinished without them. Their presence
  // is what makes electron-builder emit Square310x310Logo / Square71x71Logo.
  'LargeTile.png': [310, 310, 0.9],
  'SmallTile.png': [71, 71, 0.9],
  'SplashScreen.png': [620, 300, 0.7],
}

async function main() {
  let sourcePath
  if (fs.existsSync(brand)) sourcePath = brand
  else if (fs.existsSync(master)) sourcePath = master
  else {
    console.error(
      'No source icon found. Run `npm run gen:icons` first (it creates build/icon-master.png).'
    )
    process.exit(1)
  }

  const src = await Jimp.read(sourcePath)
  // Normalise to a square so scaling is predictable regardless of source ratio.
  const squared =
    src.getWidth() === src.getHeight() ? src : src.clone().cover(1024, 1024)

  fs.mkdirSync(outDir, { recursive: true })

  for (const [name, [w, h, scale]] of Object.entries(TARGETS)) {
    const logo = Math.max(1, Math.round(Math.min(w, h) * scale))
    const canvas = new Jimp(w, h, 0x00000000)
    canvas.composite(
      squared.clone().resize(logo, logo),
      Math.round((w - logo) / 2),
      Math.round((h - logo) / 2)
    )
    await canvas.writeAsync(path.join(outDir, name))
  }

  console.log(
    `Wrote ${Object.keys(TARGETS).length} appx assets to build/appx from ` +
      `${path.relative(root, sourcePath)}`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
