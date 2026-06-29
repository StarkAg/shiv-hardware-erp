// ── Single-source app updates ───────────────────────────────────────────────
// One source of truth for ALL platforms: GitHub Releases on StarkAg/shiv-panel.
//   • Windows (Electron)  → electron-updater reads `latest.yml` from the release
//                            (handled natively in electron/main.cjs).
//   • Android (Capacitor) → this module checks the latest release for a newer
//                            `.apk` asset and offers to download + install it.
// No second service (Capgo etc.) — every platform pulls from the same release.

const GITHUB_OWNER = 'StarkAg'
const GITHUB_REPO = 'shiv-panel-releases'
const LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

// Injected at build time from package.json (see vite.config.ts `define`).
declare const __APP_VERSION__: string
export const CURRENT_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

export type UpdateInfo = {
  available: boolean
  currentVersion: string
  latestVersion: string
  apkUrl: string | null
  notes: string
  releaseUrl: string
}

/** Detect the Capacitor Android runtime (the only platform this module installs for). */
export function isAndroidApp(): boolean {
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor
  return typeof cap?.getPlatform === 'function' && cap.getPlatform() === 'android'
}

/** Running inside the Electron desktop shell (self-updates natively). */
export function isDesktopApp(): boolean {
  return Boolean(window.shivDesktop?.isElectron)
}

/** Compare two dotted versions. Returns 1 if a>b, -1 if a<b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da > db) return 1
    if (da < db) return -1
  }
  return 0
}

type GithubRelease = {
  tag_name: string
  name?: string
  body?: string
  html_url: string
  assets: Array<{ name: string; browser_download_url: string }>
}

/**
 * Query the single source (GitHub Releases) for a newer build.
 * Returns null on any network/parse error so callers can fail silently.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    const release = (await res.json()) as GithubRelease
    const latestVersion = (release.tag_name || '').replace(/^v/i, '')
    if (!latestVersion) return null

    const apk = release.assets?.find((a) => a.name.toLowerCase().endsWith('.apk'))

    return {
      available: compareVersions(latestVersion, CURRENT_VERSION) > 0,
      currentVersion: CURRENT_VERSION,
      latestVersion,
      apkUrl: apk?.browser_download_url ?? null,
      notes: release.body?.trim() || '',
      releaseUrl: release.html_url,
    }
  } catch {
    return null
  }
}

/**
 * Trigger the Android update: open the APK in the system browser/download
 * manager. Android then prompts the user to install it (sideload flow).
 */
export function installAndroidUpdate(info: UpdateInfo): void {
  const target = info.apkUrl ?? info.releaseUrl
  // `_system` asks Capacitor to hand the URL to the OS browser, which downloads
  // the APK and lets Android's package installer take over.
  window.open(target, '_system')
}
