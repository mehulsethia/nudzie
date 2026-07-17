const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

module.exports = async function adHocSignMac(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.NUDZIE_SKIP_ADHOC_SIGN === '1') return

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
