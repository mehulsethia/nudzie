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

## 2. Install it for testing — without signing

`Add-AppxPackage` on the `.appx` itself refuses an unsigned package
(`0x800B0100, No signature was present in the subject`), and **the obvious
workaround does not work**: electron-builder vendors a 2017-era
`winCodeSign-2.6.0` signtool that cannot sign an APPX on current Windows, and
fails with:

```
SignTool Error: A required function is not present.
```

Don't fight it. Unpack the package and register the loose layout instead —
Developer Mode allows that with **no signature at all**, and it doubles as the
package-validity check (see §3):

```powershell
$tools = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\windows-10\x64"
& "$tools\makeappx.exe" unpack /p .\dist\Nudzie-1.0.1.appx /d .\dist\unpacked /o

Add-AppxPackage -Register .\dist\unpacked\AppxManifest.xml
```

The app installs with its real package identity, so the startup task, tile
artwork and Store-only behavior all apply — everything in §3 is testable this
way. Adjust the version in the filename, and the `winCodeSign-2.6.0` path if a
newer one has been vendored (`ls "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"`).

Neither `makeappx.exe` nor `signtool.exe` is on `PATH`; always call them by
full path.

**The registered app runs from `dist\unpacked`** — don't delete that folder
until after you uninstall (§3).

<details>
<summary>Optional: a true end-to-end <code>.appx</code> install test</summary>

Only worth it if you specifically want to exercise the real installer path.
Install the **"Windows SDK Signing Tools for Desktop Apps"** feature from the
Windows SDK installer (~100 MB; the full SDK is not needed), then self-sign with
a cert whose subject exactly matches the manifest publisher — a mismatch means
Windows refuses the install. In **PowerShell as Administrator**:

```powershell
$cert = New-SelfSignedCertificate -Type Custom -CertStoreLocation "Cert:\CurrentUser\My" `
  -Subject "CN=6DC7C83A-BDEA-426F-B6FD-34DC5E3F7DF3" -KeyUsage DigitalSignature `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3","2.5.29.19={text}")

$pw = ConvertTo-SecureString -String "test123" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath test.pfx -Password $pw
Import-PfxCertificate -FilePath test.pfx -CertStoreLocation Cert:\LocalMachine\TrustedPeople -Password $pw

# NOT the vendored signtool — the SDK one:
& "C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64\signtool.exe" `
  sign /fd SHA256 /f test.pfx /p test123 dist\Nudzie-1.0.1.appx

Add-AppxPackage dist\Nudzie-1.0.1.appx
```

**This locally-signed copy is for testing only.** Never submit it — Partner
Center takes the unsigned artifact.

</details>

---

## 3. Verify

In priority order. Item 1 is the one that cannot be checked from macOS at all.

1. **Package validity + manifest.** The `makeappx unpack` in §2 is itself the
   validity check: `Package extraction succeeded` means the container is sound.
   Then inspect the manifest it produced:

   ```powershell
   Select-String -Path .\dist\unpacked\AppxManifest.xml `
     -Pattern 'startupTask|Square310x310Logo|Square71x71Logo|BackgroundColor|Identity Name|Publisher='
   ```

   Expect `Identity Name="MehulSethia.Nudzie"`,
   `Publisher='CN=6DC7C83A-BDEA-426F-B6FD-34DC5E3F7DF3'`,
   `BackgroundColor="#6B5FF0"`, a `<uap:DefaultTile>` carrying
   `Square310x310Logo` + `Square71x71Logo`, and a
   `<desktop:Extension Category="windows.startupTask">`. (`TaskId="SlackStartup"`
   is electron-builder's hardcoded literal — internal, never user-visible.)

   Also check the unpacked `assets\` folder holds Nudzie artwork. Anything named
   `SampleAppx` means electron-builder substituted its own placeholder art for a
   missing logo and the Store would reject it. All seven files come from
   `npm run gen:appx-assets` → `build/appx/`.

   > **Do not use `Expand-Archive` or .NET `ZipFile` to inspect the package.**
   > Windows PowerShell 5.1 runs on .NET Framework 4.8, whose Zip64 support is
   > poor, and APPX packages always carry Zip64 records. A perfectly valid
   > package extracts to an empty folder and reports `Entries.Count` of `0` —
   > pure false alarm. `makeappx unpack` is the only trustworthy reader here.
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

**Uninstall** (do this before deleting `dist\unpacked` — the registered app runs
from it):

```powershell
Get-AppxPackage *Nudzie* | Remove-AppxPackage
Remove-Item .\dist\unpacked -Recurse
```

### Result of the first full pass — 2026-08-07, v1.0.1

Run on Windows 11 (build 26200), package built locally with
`npm run build:windows`. All of the above passed: package unpacked cleanly,
manifest carried the right identity/publisher/brand colour/tiles/startup task,
tile artwork was ours (no `SampleAppx`), startup entry appeared, the in-app
"Launch at login" checkbox was correctly absent, the tray and reminder overlay
worked, and the log confirmed the updater stood down. Item 6 was not exercised —
`oauth-credentials.json` was absent from that clone, so no Google client was
bundled. That remains the one untested path in an MSIX build.

---

## 4. Submitting

1. Build via the `msix` job in `.github/workflows/release.yml` (runs on
   `windows-latest`, never signs, never publishes) and download the
   **`nudzie-msix`** workflow artifact. That unsigned package is what you upload.
2. Partner Center → Nudzie → new submission:
   - **Pricing and availability** — consider a hidden / private audience for the
     first submission so you can install from the real Store and verify the
     whole path before it goes public.
   - **Properties** — Productivity category, and the **privacy policy URL**
     `https://www.nudzie.app/privacy` (required: the app is network-connected
     and reads calendar data).
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
