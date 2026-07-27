import { app, nativeImage, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// build/ asset resolution.
//
// build/ is electron-builder's `directories.buildResources`, which means it is
// deliberately NOT packed into app.asar. So `join(app.getAppPath(), 'build', …)`
// resolves in dev but is missing in a packaged build - which silently produced
// an EMPTY tray image, i.e. an invisible menu-bar icon. electron-builder.yml now
// also copies build/ to Contents/Resources/build via `extraResources`, so the
// packaged path is `process.resourcesPath/build`.
//
// Order matters: check resourcesPath first (packaged), then the app path (dev).
// ---------------------------------------------------------------------------
export function buildAssetPath(name: string): string | null {
  const roots = [
    process.resourcesPath ? join(process.resourcesPath, 'build') : null,
    join(app.getAppPath(), 'build')
  ]
  for (const root of roots) {
    if (!root) continue
    const candidate = join(root, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Loads a build/ image, or null when it's missing or unreadable. */
export function buildAssetImage(name: string): NativeImage | null {
  const path = buildAssetPath(name)
  if (!path) return null
  const img = nativeImage.createFromPath(path)
  return img.isEmpty() ? null : img
}

// The bell template icon, inlined as base64 so the menu-bar icon can NEVER be
// empty no matter how the app is packaged. An empty Tray image renders as a
// zero-width, invisible menu-bar item - and with "Show in Dock" off that leaves
// the app running with no way to reach it. This is the last-resort floor.
const BELL_1X =
  'iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAALUlEQVR42mNgGJHgPw5MFUNIMuw/kZg+Bv0nEQ8hg4ZxGOEznGpZZfAYRF8AAFCmbZP+OmB4AAAAAElFTkSuQmCC'
const BELL_2X =
  'iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAAV0lEQVR42u3XMQoAIAxD0d7/0nF2cFBajPUHsj8qFhpBCJmiRS0QV3A6rBWmBKWkWmHSUFYgFRXQHyAVlycD1GY5RptfBujJxbiLt7w8OIOsJ2QJIsQqA4Q2uFagEOEJAAAAAElFTkSuQmCC'

/** The built-in monochrome bell, guaranteed non-empty. */
export function fallbackTrayImage(): NativeImage {
  const img = nativeImage.createFromDataURL(`data:image/png;base64,${BELL_1X}`)
  img.addRepresentation({ scaleFactor: 2, dataURL: `data:image/png;base64,${BELL_2X}` })
  if (process.platform === 'darwin') img.setTemplateImage(true)
  return img
}
