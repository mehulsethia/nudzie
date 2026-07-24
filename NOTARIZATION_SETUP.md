# macOS Signing & Notarization Setup

This document tracks the state of macOS code signing / notarization for Nudzie.
All the **code scaffolding is done**; the remaining work is **blocked on Apple**
(account activation → Team ID → Developer ID certificate).

Until the credentials exist, every build path degrades gracefully:
- `scripts/notarize.js` skips notarization (logs a message, never crashes).
- The existing `scripts/ad-hoc-sign-mac.cjs` still applies a free ad-hoc
  signature so the bundle is sealed and runnable locally.

---

## ✅ Done (scaffolding, committed)

- [x] `@electron/notarize` added as a dev dependency.
- [x] `build/entitlements.mac.plist` — hardened-runtime entitlements
      (`allow-jit`, `allow-unsigned-executable-memory`,
      `disable-library-validation`, `allow-dyld-environment-variables`,
      plus `network.client`), each documented inline.
- [x] `electron-builder.yml` `mac` block — `hardenedRuntime: true`,
      `gatekeeperAssess: false`, `entitlements` + `entitlementsInherit`,
      and a top-level `afterSign: scripts/notarize.js` hook.
- [x] `scripts/notarize.js` — reads `APPLE_ID`, `APPLE_TEAM_ID`,
      `APPLE_APP_SPECIFIC_PASSWORD` from env; skips if any are missing.
- [x] `.env.example` — template listing the three required variables.
- [x] `.env` added to `.gitignore`.
- [x] `.github/workflows/release.yml` — signing/notarization folded into the
      existing mac+win release workflow, with an **inactive** (commented,
      mac-only) certificate-import step. The Windows build path is unchanged.

## ⛔ Blocked on Apple (do these once the account activates)

- [ ] Get your **Team ID** (10 chars) from https://developer.apple.com/account.
- [ ] Generate a **CSR** in Keychain Access.
- [ ] Create the **Developer ID Application** certificate on developer.apple.com.
- [ ] Download and install the certificate.
- [ ] Export it as a **.p12** from Keychain Access.
- [ ] Create an **app-specific password** at https://appleid.apple.com.
- [ ] Base64-encode the .p12 and add the **GitHub repo secrets**.
- [ ] Flip CI from unsigned → signed (see "Going live" below).

---

## Manual steps once Certificates, IDs & Profiles is active

### 1. Generate a CSR (Certificate Signing Request)
1. Open **Keychain Access** (`/Applications/Utilities/`).
2. Menu: **Keychain Access → Certificate Assistant → Request a Certificate
   From a Certificate Authority…**
3. Enter your Apple ID email; leave **CA Email** blank.
4. Select **Saved to disk** (and "Let me specify key pair information" if shown;
   2048-bit RSA is fine).
5. Save `CertificateSigningRequest.certSigningRequest` to disk.

### 2. Create the Developer ID Application certificate
1. Go to https://developer.apple.com/account → **Certificates, IDs & Profiles**.
2. **Certificates → +** (Add).
3. Choose **Developer ID Application** (this is the one for apps distributed
   outside the App Store — the correct type for notarization).
4. Upload the CSR from step 1.
5. **Download** the resulting `.cer` file.

### 3. Install it
- Double-click the downloaded `.cer` — it installs into your **login** keychain.
- In Keychain Access you should now see **"Developer ID Application: <Your Name>
  (TEAMID)"** with a private key beneath it (expand the arrow to confirm the key
  is present — you need both halves to export a usable .p12).

### 4. Export as .p12 (for CI)
1. In Keychain Access, find the **Developer ID Application** certificate.
2. Right-click it → **Export "Developer ID Application: …"**.
3. Format: **Personal Information Exchange (.p12)**.
4. Set a strong password — **remember it**, it becomes the
   `APPLE_CERTIFICATE_PASSWORD` secret.
5. Save the `.p12` somewhere temporary (never commit it).

### 5. Base64-encode the .p12 for GitHub
```bash
base64 -i /path/to/DeveloperID.p12 | pbcopy   # copies the base64 to clipboard
```
Paste that as the `APPLE_CERTIFICATE_P12_BASE64` secret.

### 6. Create an app-specific password
1. https://appleid.apple.com → **Sign-In and Security → App-Specific Passwords**.
2. Generate one (label it e.g. "Nudzie notarization").
3. This is `APPLE_APP_SPECIFIC_PASSWORD` — **not** your normal Apple ID password.

---

## Where each real value gets plugged in

| Value | Local dev (`.env`) | GitHub Actions secret | Consumed by |
|-------|--------------------|-----------------------|-------------|
| Apple ID email | `APPLE_ID` | `APPLE_ID` | `scripts/notarize.js` |
| Team ID (10 chars) | `APPLE_TEAM_ID` | `APPLE_TEAM_ID` | `scripts/notarize.js` |
| App-specific password | `APPLE_APP_SPECIFIC_PASSWORD` | `APPLE_APP_SPECIFIC_PASSWORD` | `scripts/notarize.js` |
| Developer ID cert (.p12, base64) | *(installed in login keychain, no .env)* | `APPLE_CERTIFICATE_P12_BASE64` | `release.yml` cert-import step (macOS job) |
| .p12 export password | *(none — cert is already in keychain)* | `APPLE_CERTIFICATE_PASSWORD` | `release.yml` cert-import step (macOS job) |
| Temp keychain password | *(n/a)* | `KEYCHAIN_PASSWORD` (any random string) | `release.yml` cert-import step (macOS job) |

Notes:
- **Locally**, once the cert is installed in your login keychain, electron-builder
  auto-discovers it — you only need the three `.env` values for the notarize step.
- **In CI**, there is no login keychain, so the cert must be imported from the
  base64 secret (the `.p12`), hence the extra CI-only secrets.

---

## Going live (flip unsigned → signed)

When the certificate and secrets are in place:

1. In `.github/workflows/release.yml`:
   - **Uncomment** the "Import Developer ID certificate (macOS)" step (it's
     guarded by `if: matrix.platform == 'mac'`, so the Windows job skips it).
   - **Delete** the `CSC_IDENTITY_AUTO_DISCOVERY: "false"` line in the build step
     so electron-builder signs with the imported Developer ID cert. (Windows
     stays unsigned regardless.)
   - The uncommented import step already sets `NUDZIE_SKIP_ADHOC_SIGN=1`.
2. ⚠️ **Ad-hoc hook conflict:** `scripts/ad-hoc-sign-mac.cjs` (the `afterPack`
   hook) force-signs the app ad-hoc, which would overwrite a real Developer ID
   signature and break notarization. Whenever you do a **signed** build (locally
   or in CI), set `NUDZIE_SKIP_ADHOC_SIGN=1` so the ad-hoc hook is bypassed. CI
   handles this automatically in the import step; for local signed builds run:
   ```bash
   NUDZIE_SKIP_ADHOC_SIGN=1 npm run dist:mac
   ```
3. `electron-builder.yml` currently has `notarize: false` — leave it. Our
   `afterSign: scripts/notarize.js` hook is the single notarization path, and it
   activates automatically once the `APPLE_*` env vars are present.

## Quick local test (after credentials exist)

```bash
cp .env.example .env      # then fill in the three real values
set -a; source .env; set +a
NUDZIE_SKIP_ADHOC_SIGN=1 npm run dist:mac
```
You should see `[notarize] Submitting …` instead of the skip message.
