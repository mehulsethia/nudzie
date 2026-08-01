const { execFileSync } = require('node:child_process')
const { existsSync, mkdtempSync } = require('node:fs')
const { readdir } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { basename, dirname, join } = require('node:path')

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: options.capture ? 'pipe' : 'inherit' })
}

async function findApp(root) {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(root, entry.name)
    if (entry.isDirectory() && entry.name.endsWith('.app')) return fullPath
  }
  return null
}

function verifyApp(appPath, { gatekeeper = false } = {}) {
  console.log(`[verify-mac] Verifying ${appPath}`)
  const legacyCodeResources = join(appPath, 'Contents', 'CodeResources')
  if (existsSync(legacyCodeResources)) {
    throw new Error(`Unexpected legacy CodeResources file: ${legacyCodeResources}`)
  }
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath])
  const entitlements = run(
    '/usr/bin/codesign',
    ['-d', '--entitlements', '-', join(appPath, 'Contents', 'MacOS', 'Nudzie')],
    { capture: true }
  )
  if (/invalid entitlements blob/i.test(entitlements)) {
    throw new Error(`Invalid entitlements blob in ${appPath}`)
  }
  if (gatekeeper) run('/usr/sbin/spctl', ['-a', '-vv', '-t', 'execute', appPath])
}

async function verifyZip(zipPath) {
  const extractDir = mkdtempSync(join(tmpdir(), 'nudzie-zip-verify-'))
  console.log(`[verify-mac] Extracting ${basename(zipPath)} for signature verification`)
  run('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir])

  const appPath = await findApp(extractDir)
  if (!appPath) throw new Error(`No .app bundle found in ${zipPath}`)
  verifyApp(appPath)
}

exports.default = async function verifyMacReleaseArtifacts(context) {
  const artifactPaths = context.artifactPaths || []
  const macZipPaths = artifactPaths.filter((artifactPath) => artifactPath.endsWith('.zip'))
  if (macZipPaths.length === 0) return

  const hasNotarizationCredentials = Boolean(
    process.env.APPLE_ID &&
      process.env.APPLE_TEAM_ID &&
      process.env.APPLE_APP_SPECIFIC_PASSWORD
  )
  const outDir = dirname(macZipPaths[0])
  const appPath = join(outDir, 'mac-universal', 'Nudzie.app')
  if (existsSync(appPath)) verifyApp(appPath, { gatekeeper: hasNotarizationCredentials })

  for (const zipPath of macZipPaths) {
    await verifyZip(zipPath)
  }
}
