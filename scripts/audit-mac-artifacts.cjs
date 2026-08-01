// Post-build audit of the macOS artifacts that actually ship.
//
// This inspects the packaged DMG and the updater ZIP — not the staging .app —
// because every past release failure was introduced *after* signing, while the
// staging app still looked fine. v0.1.7-v0.1.19 all shipped an app whose stapled
// notarization ticket had been deleted during post-processing: Gatekeeper then
// needs a live network round-trip to Apple on first launch, and an offline or
// rate-limited user gets "Nudzie is damaged and can't be opened."
//
// Read-only. It never mutates an artifact — that is the mistake it exists to catch.

const { execFileSync, spawnSync } = require('node:child_process')
const { existsSync, mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, join } = require('node:path')

const distDir = join(process.cwd(), 'dist')
const zipPath = join(distDir, 'Nudzie.zip')
const dmgPath = join(distDir, 'Nudzie.dmg')
const latestMacPath = join(distDir, 'latest-mac.yml')

const failures = []

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return {
    ok: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim()
  }
}

function check(label, fn) {
  try {
    fn()
    console.log(`  ok    ${label}`)
  } catch (error) {
    console.log(`  FAIL  ${label}: ${error.message}`)
    failures.push(`${label}: ${error.message}`)
  }
}

function auditApp(appPath, context) {
  console.log(`\n[audit] ${context} -> ${appPath}`)

  check('code signature is valid and satisfies its Designated Requirement', () => {
    const { ok, output } = capture('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', appPath])
    if (!ok) throw new Error(output)
  })

  check('hardened runtime is enabled', () => {
    const { output } = capture('/usr/bin/codesign', ['-dvv', appPath])
    if (!/flags=.*runtime/.test(output)) throw new Error('CodeDirectory is missing the runtime flag')
  })

  // Derived from the artifact, never from ambient env vars. Gating the Apple-side
  // assertions on APPLE_* being present meant a missing or misplaced secret
  // silently downgraded this audit to almost nothing — which is exactly how the
  // stapling regression shipped 13 times. A Developer ID signature is proof the
  // build intended to be a release build, so demand the rest of the chain.
  const isDeveloperIdSigned = /Authority=Developer ID Application:/.test(
    capture('/usr/bin/codesign', ['-dvv', appPath]).output
  )

  if (!isDeveloperIdSigned) {
    if (process.env.CI === 'true') {
      failures.push(`${context}: CI build is not signed with a Developer ID Application identity`)
      console.log('  FAIL  signed by a Developer ID Application certificate: ad-hoc/unsigned build in CI')
      return
    }
    console.log('  skip  Developer ID / notarization checks (local unsigned build)')
    return
  }
  console.log('  ok    signed by a Developer ID Application certificate')

  check('carries a secure timestamp', () => {
    const { output } = capture('/usr/bin/codesign', ['-dvv', appPath])
    if (!/^Timestamp=/m.test(output)) throw new Error('signature has no secure timestamp')
  })

  // The regression that broke v0.1.7-v0.1.19. Without the stapled ticket the app
  // is still notarized, but only verifiable online.
  check('notarization ticket is stapled (works offline)', () => {
    const { ok, output } = capture('/usr/bin/xcrun', ['stapler', 'validate', appPath])
    if (!ok) throw new Error(output)
  })

  check('Gatekeeper accepts it as a notarized Developer ID app', () => {
    const { ok, output } = capture('/usr/sbin/spctl', ['-a', '-vv', '-t', 'execute', appPath])
    if (!ok) throw new Error(output)
    if (!/source=Notarized Developer ID/.test(output)) {
      throw new Error(`unexpected Gatekeeper source: ${output}`)
    }
  })
}

function auditZip() {
  if (!existsSync(zipPath)) {
    failures.push(`missing updater ZIP: ${zipPath}`)
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'nudzie-audit-zip-'))
  try {
    execFileSync('/usr/bin/ditto', ['-x', '-k', zipPath, dir], { stdio: 'inherit' })
    auditApp(join(dir, 'Nudzie.app'), `updater ZIP (${basename(zipPath)})`)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}

function auditDmg() {
  if (!existsSync(dmgPath)) {
    failures.push(`missing DMG: ${dmgPath}`)
    return
  }
  const mountPoint = mkdtempSync(join(tmpdir(), 'nudzie-audit-dmg-'))
  let attached = false
  try {
    execFileSync('/usr/bin/hdiutil', ['attach', dmgPath, '-mountpoint', mountPoint, '-nobrowse', '-readonly'], {
      stdio: 'inherit'
    })
    attached = true
    auditApp(join(mountPoint, 'Nudzie.app'), `DMG (${basename(dmgPath)})`)
  } finally {
    if (attached) {
      try {
        execFileSync('/usr/bin/hdiutil', ['detach', mountPoint], { stdio: 'inherit' })
      } catch {
        execFileSync('/usr/bin/hdiutil', ['detach', mountPoint, '-force'], { stdio: 'inherit' })
      }
    }
    rmSync(mountPoint, { force: true, recursive: true })
  }
}

// The auto-update feed must name the ZIP and match the version being shipped, or
// installed copies either never see the update or download the wrong artifact.
function auditUpdateFeed() {
  console.log('\n[audit] update feed -> latest-mac.yml')
  check('latest-mac.yml exists', () => {
    if (!existsSync(latestMacPath)) throw new Error(`missing ${latestMacPath}`)
  })
  if (!existsSync(latestMacPath)) return

  const feed = require('node:fs').readFileSync(latestMacPath, 'utf8')
  const version = require(join(process.cwd(), 'package.json')).version

  check(`declares version ${version}`, () => {
    if (!new RegExp(`^version: ${version.replace(/\./g, '\\.')}\\s*$`, 'm').test(feed)) {
      throw new Error(`feed does not declare version ${version}:\n${feed}`)
    }
  })

  check('points the updater at Nudzie.zip', () => {
    if (!/^path: Nudzie\.zip\s*$/m.test(feed)) {
      throw new Error(`feed "path" is not Nudzie.zip:\n${feed}`)
    }
  })
}

console.log(`[audit] auditing macOS artifacts in ${distDir}`)


auditZip()
auditDmg()
auditUpdateFeed()

if (failures.length > 0) {
  console.error(`\n[audit] ${failures.length} check(s) failed — refusing to ship:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('\n[audit] all macOS artifact checks passed.')
