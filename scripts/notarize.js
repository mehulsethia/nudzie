// afterSign hook: submits the signed macOS .app to Apple's notary service.
//
// electron-builder calls this after it code-signs the app. Notarization ONLY
// works on an app signed with a real "Developer ID Application" certificate — an
// ad-hoc signature will be rejected. Because the Apple Developer account is still
// activating (no cert / Team ID yet), this script SKIPS gracefully whenever the
// required credentials are absent, so `npm run dist:mac` still produces a build.
//
// Credentials are read from environment variables only — nothing is hardcoded:
//   APPLE_ID                    -> your Apple Developer account email
//   APPLE_TEAM_ID               -> your 10-char Team ID (from developer.apple.com)
//   APPLE_APP_SPECIFIC_PASSWORD -> app-specific password from appleid.apple.com
// See .env.example and NOTARIZATION_SETUP.md for where to get each value.

// electron-builder v25 ships as ESM for hooks; use a dynamic import so this file
// works whether it's loaded as CJS or ESM.
exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context

  // Only notarize macOS builds.
  if (electronPlatformName !== 'darwin') {
    return
  }

  const appleId = process.env.APPLE_ID
  const teamId = process.env.APPLE_TEAM_ID
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD

  // Skip (don't crash) if any credential is missing. This is the expected path
  // until the Apple Developer certificate + Team ID exist.
  if (!appleId || !teamId || !appleIdPassword) {
    const missing = [
      !appleId && 'APPLE_ID',
      !teamId && 'APPLE_TEAM_ID',
      !appleIdPassword && 'APPLE_APP_SPECIFIC_PASSWORD',
    ].filter(Boolean)
    console.log(
      `\n[notarize] Skipping notarization — missing env var(s): ${missing.join(
        ', '
      )}.\n[notarize] Set them (see .env.example / NOTARIZATION_SETUP.md) once your ` +
        `Developer ID certificate is ready.\n`
    )
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = `${appOutDir}/${appName}.app`

  console.log(`\n[notarize] Submitting ${appPath} to Apple notary service…`)
  console.log('[notarize] This can take several minutes.')

  // Imported lazily so a build that skips notarization doesn't require the
  // package to be resolvable at module-load time.
  const { notarize } = await import('@electron/notarize')

  await notarize({
    // `tool: 'notarytool'` is the modern notarization path (altool is deprecated).
    tool: 'notarytool',
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  })

  console.log(`[notarize] Done — ${appName}.app is notarized.\n`)
}
