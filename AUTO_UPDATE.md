# App Auto-Update — ONE source for every platform

**Single source of truth: GitHub Releases on `StarkAg/shiv-panel-releases` (public; source stays private).**
Both the Windows desktop app and the Android app pull updates from the *same* releases.
No second service (no Capgo / no separate feed).

Each release should contain:

| Platform | Assets in the release |
|----------|-----------------------|
| Windows  | `Shiv-Hardware-Panel-Setup-<v>.exe`, `…​.exe.blockmap`, `latest.yml` |
| Android  | `shiv-hardware-panel-<v>.apk` (any `*.apk` name works — the app finds the `.apk` asset) |

- **Windows (Electron):** `electron-updater` reads `latest.yml`, downloads in the
  background, and prompts to restart. See below.
- **Android (Capacitor):** the app calls the GitHub "latest release" API on launch
  (`src/lib/appUpdate.ts`), compares the release tag to its built-in version, and if a
  newer `.apk` exists it shows an in-app banner → tapping it opens the APK so Android's
  installer can apply it. No special build service, no extra permission.
- The shared in-app banner lives in `src/components/UpdateBanner.tsx` (mounted in
  `AppLayout`). The app's own version is injected at build time from `package.json`
  via Vite (`__APP_VERSION__`).

## Windows desktop — how it's wired

- **Feed:** GitHub Releases on `StarkAg/shiv-panel-releases` (public; source stays private) (see `build.publish` in `package.json`).
- **Main process:** `electron/main.cjs` → `setupAutoUpdater()` uses `electron-updater`'s
  `autoUpdater`. `autoDownload = true`, `autoInstallOnAppQuit = true`. On
  `update-downloaded` it shows a "Restart now / Later" dialog.
- **Renderer bridge (optional UI):** `electron/preload.cjs` exposes on `window.shivDesktop`:
  - `getUpdateState()` → current `{ status, version, info, progress, error }`
  - `checkForUpdates()` → force a check
  - `installUpdate()` → quit & install a downloaded update
  - `onUpdateStatus(cb)` → subscribe to live status; returns an unsubscribe fn
- Auto-update is **disabled in dev** (`app.isPackaged === false`).

## Releasing a new version (the "auto update pull" the clients consume)

1. Bump `version` in `package.json` (e.g. `0.1.1` → `0.1.2`). It MUST be higher than
   what clients already have, or they won't update.
2. Provide a GitHub token with `repo` scope (Contents: read/write) as `GH_TOKEN`, then
   build + publish in one step:

   ```powershell
   $env:GH_TOKEN = "<your_personal_access_token>"
   npm run release:win
   ```

   This builds the installer and uploads `Shiv-Hardware-Panel-Setup-<version>.exe`,
   its `.blockmap`, and `latest.yml` to a GitHub Release. electron-updater reads
   `latest.yml` to detect and pull the update.

   - If the release should stay hidden until ready, it is created as a **draft** by
     default (`--publish always` publishes immediately; change to `--publish onTagOrDraft`
     if you prefer draft-first).

### Alternative: GitHub CLI

If you install the GitHub CLI (`winget install GitHub.cli`) and run `gh auth login`,
you can publish the already-built artifacts without a raw token:

```powershell
npm run dist:win
gh release create v$(node -p "require('./package.json').version") `
  release/Shiv-Hardware-Panel-Setup-*.exe `
  release/Shiv-Hardware-Panel-Setup-*.exe.blockmap `
  release/latest.yml `
  --title "v$(node -p "require('./package.json').version")" --notes "Update"
```

> The release **tag must be `v<version>`** (e.g. `v0.1.1`) — that's what the GitHub
> provider expects.

## Android — building & attaching the APK to the same release

The Android APK can't be built without the Android SDK (Android Studio, or the
command-line SDK + `ANDROID_HOME`). Once that's available:

```powershell
npm run android:apk
# output: android/app/build/outputs/apk/debug/app-debug.apk
```

Rename it to `shiv-hardware-panel-<version>.apk` and upload it to the **same** GitHub
release as the Windows assets:

```powershell
gh release upload v0.1.2 android/app/build/outputs/apk/debug/app-debug.apk#shiv-hardware-panel-0.1.2.apk --repo StarkAg/shiv-panel-releases
```

Notes:
- For real distribution build a **signed release APK** (`assembleRelease` with a keystore),
  not the debug APK.
- Android clients already running a build with this updater will then show the
  "Update available" banner and pull the new APK. The *first* APK containing the updater
  must be installed manually once.

