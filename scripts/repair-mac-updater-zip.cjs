const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, join } = require('node:path')
const { appBuilderPath } = require('app-builder-bin')

const distDir = join(process.cwd(), 'dist')
const appPath = join(distDir, 'mac-universal', 'Nudzie.app')
const zipPath = join(distDir, 'Nudzie.zip')
const zipBlockmapPath = join(distDir, 'Nudzie.zip.blockmap')
const dmgPath = join(distDir, 'Nudzie.dmg')
const dmgBlockmapPath = join(distDir, 'Nudzie.dmg.blockmap')
const latestMacPath = join(distDir, 'latest-mac.yml')

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: options.capture ? 'pipe' : 'inherit' })
}

function sha512(filePath) {
  return createHash('sha512').update(readFileSync(filePath)).digest('base64')
}

function size(filePath) {
  return statSync(filePath).size
}

function hasNotarizationCredentials() {
  return Boolean(
    process.env.APPLE_ID &&
      process.env.APPLE_TEAM_ID &&
      process.env.APPLE_APP_SPECIFIC_PASSWORD
  )
}

function developerIdIdentity() {
  if (process.env.CSC_NAME) return process.env.CSC_NAME

  const output = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8'
  })
  const match = output.match(/"([^"]*Developer ID Application:[^"]+)"/)
  if (!match) {
    throw new Error('Could not find a Developer ID Application signing identity in the keychain.')
  }
  return match[1]
}

function verifyApp(app, { gatekeeper = false, stapler = false } = {}) {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', app])
  run('/usr/bin/codesign', ['-d', '--entitlements', '-', join(app, 'Contents', 'MacOS', 'Nudzie')])
  if (stapler) run('/usr/bin/xcrun', ['stapler', 'validate', app])
  if (gatekeeper) run('/usr/sbin/spctl', ['-a', '-vv', '-t', 'execute', app])
}

async function signAndNotarizeApp() {
  const identity = developerIdIdentity()
  const entitlements = join(process.cwd(), 'build', 'entitlements.mac.plist')
  const signArgs = [
    '--force',
    '--deep',
    '--sign',
    identity,
    '--options',
    'runtime',
    '--generate-entitlement-der',
    '--timestamp',
  ]
  if (existsSync(entitlements)) signArgs.push('--entitlements', entitlements)
  signArgs.push(appPath)

  console.log(`[repair-mac] Re-signing repaired app with ${identity}`)
  run('/usr/bin/codesign', signArgs)
  verifyApp(appPath)

  console.log('[repair-mac] Submitting repaired app to Apple notary service')
  const { notarize } = await import('@electron/notarize')
  await notarize({
    tool: 'notarytool',
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  })

  console.log('[repair-mac] Stapling repaired app notarization ticket')
  run('/usr/bin/xcrun', ['stapler', 'staple', appPath])
}

async function repairApp() {
  const legacyCodeResources = join(appPath, 'Contents', 'CodeResources')
  rmSync(legacyCodeResources, { force: true })
  const hasCredentials = hasNotarizationCredentials()
  if (hasCredentials) await signAndNotarizeApp()
  verifyApp(appPath, { gatekeeper: hasCredentials, stapler: hasCredentials })
}

function rebuildZip() {
  const tmpZip = join(distDir, 'Nudzie.zip.tmp')
  rmSync(tmpZip, { force: true })
  run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, tmpZip])
  renameSync(tmpZip, zipPath)
  run(appBuilderPath, ['blockmap', '--input', zipPath, '--output', zipBlockmapPath])
}

function rebuildDmg() {
  if (!existsSync(dmgPath)) return

  const version = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version
  const stagingDir = mkdtempSync('/tmp/nudzie-dmg-stage-')
  const tmpDmg = join(distDir, 'Nudzie.tmp.dmg')

  try {
    run('/usr/bin/ditto', [appPath, join(stagingDir, 'Nudzie.app')])
    symlinkSync('/Applications', join(stagingDir, 'Applications'))
    rmSync(tmpDmg, { force: true })
    try {
      run('/usr/bin/hdiutil', [
        'create',
        '-volname',
        `Nudzie ${version}`,
        '-srcfolder',
        stagingDir,
        '-ov',
        '-format',
        'UDZO',
        tmpDmg,
      ])
    } catch (error) {
      if (process.env.CI === 'true') throw error
      console.warn(`[repair-mac] Warning: failed to rebuild ${dmgPath}; CI will treat this as a release-blocking error.`)
      return
    }
    renameSync(tmpDmg, dmgPath)
    run(appBuilderPath, ['blockmap', '--input', dmgPath, '--output', dmgBlockmapPath])
  } finally {
    rmSync(tmpDmg, { force: true })
    rmSync(stagingDir, { force: true, recursive: true })
  }
}

function writeLatestMac() {
  const version = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version
  const releaseDate = new Date().toISOString()
  const lines = [
    `version: ${version}`,
    'files:',
    '  - url: Nudzie.zip',
    `    sha512: ${sha512(zipPath)}`,
    `    size: ${size(zipPath)}`,
  ]

  if (existsSync(dmgPath)) {
    lines.push(
      '  - url: Nudzie.dmg',
      `    sha512: ${sha512(dmgPath)}`,
      `    size: ${size(dmgPath)}`
    )
  }

  lines.push(
    'path: Nudzie.zip',
    `sha512: ${sha512(zipPath)}`,
    `releaseDate: '${releaseDate}'`,
    ''
  )
  writeFileSync(latestMacPath, lines.join('\n'))
}

function verifyZip() {
  const extractDir = mkdtempSync(join(tmpdir(), 'nudzie-repaired-zip-'))
  run('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir])
  const hasCredentials = hasNotarizationCredentials()
  verifyApp(join(extractDir, 'Nudzie.app'), { gatekeeper: hasCredentials, stapler: hasCredentials })
}

function verifyDmg() {
  if (!existsSync(dmgPath)) return

  const mountPoint = mkdtempSync('/tmp/nudzie-dmg-verify-')
  let attached = false
  try {
    try {
      run('/usr/bin/hdiutil', ['attach', dmgPath, '-mountpoint', mountPoint, '-nobrowse', '-readonly'])
    } catch (error) {
      if (process.env.CI === 'true') throw error
      console.warn(`[repair-mac] Warning: failed to attach ${dmgPath}; CI will treat this as a release-blocking error.`)
      return
    }
    attached = true
    const hasCredentials = hasNotarizationCredentials()
    verifyApp(join(mountPoint, 'Nudzie.app'), { gatekeeper: hasCredentials, stapler: hasCredentials })
  } finally {
    if (attached) {
      try {
        run('/usr/bin/hdiutil', ['detach', mountPoint])
      } catch (error) {
        if (process.env.CI === 'true') throw error
        console.warn(`[repair-mac] Warning: failed to detach ${mountPoint}; detach it manually if macOS leaves it mounted.`)
      }
    }
    rmSync(mountPoint, { force: true, recursive: true })
  }
}

async function main() {
  console.log('[repair-mac] Removing legacy CodeResources from packaged app')
  await repairApp()
  console.log('[repair-mac] Rebuilding updater ZIP and blockmap')
  rebuildZip()
  console.log('[repair-mac] Rebuilding DMG and blockmap')
  rebuildDmg()
  writeLatestMac()
  console.log(`[repair-mac] Verifying repaired ${basename(zipPath)}`)
  verifyZip()
  console.log('[repair-mac] Verifying DMG contents')
  verifyDmg()
  console.log('[repair-mac] mac release artifacts are repaired and verified')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
