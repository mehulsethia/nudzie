# Windows MSIX — Build & Test Before Store Submission

How to build the Microsoft Store package on a Windows machine, install it, and
verify it behaves before the first Partner Center submission.

The Store build differs from the NSIS installer in ways that **cannot be tested
on macOS or through the NSIS build**, so this pass is not optional before
submitting:

- MSIX installs read-only and the Store owns updates → the auto-updater is
  disabled (`isWindowsStore` in `src/main/platform.ts`).
- `app.setLoginItemSettings` is a no-op inside the package → launch-at-login
  comes from the `windows.startupTask` manifest extension instead, and the
  in-app checkbox is hidden.

Product identity (reserved in Partner Center, mirrored in the `appx:` block of
`electron-builder.yml`):

| | |
|---|---|
| Identity Name | `MehulSethia.Nudzie` |
| Publisher | `CN=6DC7C83A-BDEA-426F-B6FD-34DC5E3F7DF3` |
| Publisher display name | Mehul Sethia |
| Package Family Name | `MehulSethia.Nudzie_sj9jbtkexfsya` |

---

## Prerequisites

On the Windows machine (Windows 10 1809+ or Windows 11, x64):

- [Node 24](https://nodejs.org) and [Git](https://git-scm.com/download/win).
- **Developer Mode** on: Settings → System → For developers.
- ~2 GB free — `npm ci` pulls the Electron binary (~120 MB).

No Windows SDK needed. electron-builder vendors both `makeappx.exe` and
`signtool.exe`.

---

## 1. Build

```powershell
git clone <repo-url> nudzie
cd nudzie
npm ci
npm run build:windows
```

Output: **`dist\Nudzie-<version>.appx`**

`.appx` and `.msix` are the same container format; Partner Center accepts the
`.appx`. The package is **unsigned on purpose** — Microsoft re-signs it
server-side on submission. `AppX is not signed / Windows Store only build` in
the log is the expected path, not an error.

`npm run build:windows` is the only script that produces it: `appx` is
deliberately absent from `win.target` in `electron-builder.yml`, so
`npm run dist:win` builds only the NSIS installer and can never publish a Store
package to the update feed by accident.

> **Google sign-in:** `oauth-credentials.json` is gitignored, so a fresh clone
> won't have it. Copy it across by hand if you want to exercise the Google
> Calendar flow; everything else builds and runs without it.

---

## 2. Sign it for local testing

An unsigned MSIX **cannot be installed**, even with Developer Mode on. Sign it
with a self-signed cert whose subject exactly matches the manifest publisher —
a mismatch means Windows refuses the install.

In **PowerShell as Administrator**, from the repo root:

```powershell
$cert = New-SelfSignedCertificate -Type Custom -CertStoreLocation "Cert:\CurrentUser\My" `
  -Subject "CN=6DC7C83A-BDEA-426F-B6FD-34DC5E3F7DF3" -KeyUsage DigitalSignature `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3","2.5.29.19={text}")

$pw = ConvertTo-SecureString -String "test123" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath test.pfx -Password $pw
Import-PfxCertificate -FilePath test.pfx -CertStoreLocation Cert:\LocalMachine\TrustedPeople -Password $pw

$signtool = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\windows-10\x64\signtool.exe"
& $signtool sign /fd SHA256 /f test.pfx /p test123 dist\Nudzie-1.0.1.appx

Add-AppxPackage dist\Nudzie-1.0.1.appx
```

Adjust the version in the filename, and the `winCodeSign-2.6.0` path if
electron-builder has since vendored a newer version (`ls
"$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"`).

**This locally-signed copy is for testing only.** Never submit it — Partner
Center takes the unsigned artifact.

---

## 3. Verify

In priority order. Item 1 is the one that cannot be checked from macOS at all.

1. **Inspect the generated manifest.** Copy the `.appx`, rename to `.zip`,
   extract, open `AppxManifest.xml`. Confirm:
   - a `<desktop:Extension Category="windows.startupTask">` element exists;
   - `assets\` contains Nudzie artwork — if you see anything named
     `SampleAppx`, electron-builder substituted its own placeholder art for a
     missing logo and the Store would reject it. All seven files come from
     `npm run gen:appx-assets` → `build/appx/`.
2. **Startup entry.** Settings → Apps → Startup lists Nudzie. Toggle it there —
   in MSIX that is the only place it can be changed.
3. **In-app checkbox is gone.** Open Nudzie's settings → General → App section.
   "Launch at login" must be **absent** (Show in Dock / Stay signed in remain).
   If it's visible, the Store detection didn't fire.
4. **Core flow.** Tray icon appears; "Trigger a test reminder" walks the
   character in; accept and snooze both work.
5. **No updater activity.** No update prompts. The log should contain
   `[autoUpdater] Microsoft Store build; the Store handles updates`. MSIX
   redirects `%APPDATA%`, so look under the package's local cache —
   `%LOCALAPPDATA%\Packages\MehulSethia.Nudzie_sj9jbtkexfsya\LocalCache\Roaming\Nudzie\logs\main.log`
   — falling back to `%APPDATA%\Nudzie\logs\main.log`.
6. **Google Calendar connect** (only if you copied `oauth-credentials.json`).
   Proves the loopback OAuth redirect survives packaging. It should: the
   manifest declares `runFullTrust` with `Windows.FullTrustApplication`, so the
   app is not in an AppContainer and loopback isn't blocked.

Optional: run the **Windows App Certification Kit** (part of the Windows SDK)
→ "Validate Store App" against the installed package. It catches most
certification failures before submission.

**Uninstall:**

```powershell
Get-AppxPackage *Nudzie* | Remove-AppxPackage
```

---

## 4. Submitting

1. Build via the `msix` job in `.github/workflows/release.yml` (runs on
   `windows-latest`, never signs, never publishes) and download the
   **`nudzie-msix`** workflow artifact. That unsigned package is what you upload.
2. Partner Center → Nudzie → new submission:
   - **Pricing and availability** — consider a hidden / private audience for the
     first submission so you can install from the real Store and verify the
     whole path before it goes public.
   - **Properties** — Productivity category, and a **privacy policy URL**
     (required: the app is network-connected and reads calendar data).
   - **Age ratings** — IARC questionnaire.
   - **Store listing** — description, at least one screenshot (1366×768 or
     1920×1080), store logo.
   - **Packages** — upload the `.appx`.
3. Submit. Microsoft signs it and runs certification (hours to a few days).

Version notes: the manifest version is derived from `package.json` as
`<version>.0`. The fourth part must be `0`, and every submission must have a
higher version than the last.

If Partner Center flags the `runFullTrust` capability, that is the expected
declaration for a packaged Win32 desktop app — request the desktop-bridge
exception.
