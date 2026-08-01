const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

// An ad-hoc signature is a fallback for unsigned local builds ONLY. If a real
// Developer ID identity is available, ad-hoc signing would overwrite it and
// silently produce a build that can never be notarized. Belt and braces with the
// NUDZIE_SKIP_ADHOC_SIGN env var the release workflow sets.
function hasDeveloperIdIdentity() {
  const result = spawnSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8'
  })
  return /Developer ID Application:/.test(`${result.stdout || ''}`)
}

module.exports = async function adHocSignMac(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.NUDZIE_SKIP_ADHOC_SIGN === '1') return
  if (process.env.CSC_NAME || hasDeveloperIdIdentity()) {
    console.log('Skipping ad-hoc signing: a Developer ID identity is available.')
    return
  }

  const appOutDir = context.appOutDir
  if (/-temp$/.test(appOutDir)) {
    console.log(`Skipping ad-hoc signing for temporary arch bundle: ${appOutDir}`)
    return
  }

  const productFilename = context.packager?.appInfo?.productFilename
  const preferredApp = productFilename ? path.join(appOutDir, `${productFilename}.app`) : ''
  const appPathName = fs.existsSync(preferredApp)
    ? preferredApp
    : fs.readdirSync(appOutDir).find((name) => name.endsWith('.app'))

  if (!appPathName) {
    throw new Error(`Could not find macOS .app bundle in ${appOutDir}`)
  }

  const resolvedAppPath = path.isAbsolute(appPathName) ? appPathName : path.join(appOutDir, appPathName)
  if (!fs.existsSync(resolvedAppPath)) {
    throw new Error(`Could not find macOS .app bundle in ${appOutDir}`)
  }

  const projectDir = context.packager?.projectDir || process.cwd()
  const entitlements = path.join(projectDir, 'build', 'entitlements.mac.plist')
  const args = [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--timestamp=none',
    '--options',
    'runtime'
  ]

  if (fs.existsSync(entitlements)) args.push('--entitlements', entitlements)
  args.push(resolvedAppPath)

  console.log(`Ad-hoc signing macOS app: ${resolvedAppPath}`)
  execFileSync('/usr/bin/codesign', args, { stdio: 'inherit' })
}
