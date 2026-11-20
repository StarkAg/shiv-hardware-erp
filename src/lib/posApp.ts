/**
 * The Counter inside the Shiv Counter Android app (shiv-counter/).
 *
 * The app is a frame round this website, so every deploy reaches the phone at
 * once. It says so with "ShivCounterApp/<version>" in its user agent, and
 * gives the page a `ShivCounterAndroid` object for what a web view cannot do
 * itself. Inside it the Counter wears its touch look ("POS"): a home screen of
 * big tiles, thumb-sized buttons and boxes, and a number pad of its own
 * (counter-signs.css `.pos-app`, PosHome, PosNumberPad). The PC app and the
 * website are untouched: nothing here runs outside the Android app.
 */

type AndroidBridge = {
  share(filesJson: string): void
  print(title: string): void
  version(): string
}

declare global {
  interface Window { ShivCounterAndroid?: AndroidBridge }
}

export const inPosApp = typeof navigator !== 'undefined' && (
  /ShivCounterApp\//.test(navigator.userAgent) ||
  // Trying the POS look in a phone's browser against `npm run dev`:
  // http://<pc>:5180/counter.html?pos#/pos. Never in a build.
  (import.meta.env.DEV && /[?&]pos\b/.test(location.search))
)

const bridge = () => (typeof window !== 'undefined' ? window.ShivCounterAndroid : undefined)

function toBase64(blob: Blob): Promise<string> {
  return new Promise((done, fail) => {
    const reader = new FileReader()
    reader.onload = () => done(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => fail(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function shareBlobs(files: { name: string; type: string; blob: Blob }[]) {
  const android = bridge()
  if (!android) throw new DOMException('Sharing is not available', 'NotAllowedError')
  const payload = await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type || 'application/octet-stream', data: await toBase64(f.blob) })))
  android.share(JSON.stringify(payload))
}

/**
 * Turns on the phone's own sharing and printing for the page, in the Android
 * app only. Called once, before anything is drawn.
 */
export function startPosApp() {
  if (!inPosApp) return
  document.documentElement.classList.add('pos-app')

  const android = bridge()
  if (!android) return

  // A web view has no navigator.share, so a quotation picture fell back to a
  // download it cannot do. Through the app it opens the phone's share sheet
  // (WhatsApp in it). The Counter only ever shares files, so only files go.
  const share = async (data?: ShareData) => {
    const files = data?.files ?? []
    if (!files.length) throw new TypeError('Only files can be shared from the app')
    await shareBlobs(files.map((f) => ({ name: f.name, type: f.type, blob: f })))
  }
  Object.defineProperty(navigator, 'share', { value: share, configurable: true })
  Object.defineProperty(navigator, 'canShare', { value: (data?: ShareData) => Boolean(data?.files?.length), configurable: true })

  // Print (the slip, a preview) through Android's print screen: the page as
  // its print styles lay it out, as on the PC.
  window.print = () => android.print(document.title || 'Shiv Counter')

  // "Save" links (a blob with a download name) cannot download in a web view.
  // Hand the file to the share sheet instead, where it can be saved or sent.
  document.addEventListener('click', (event) => {
    const link = (event.target as Element | null)?.closest?.('a[download]') as HTMLAnchorElement | null
    if (!link || !/^(blob|data):/.test(link.href)) return
    event.preventDefault()
    void fetch(link.href)
      .then((res) => res.blob())
      .then((blob) => shareBlobs([{ name: link.download || 'file', type: blob.type, blob }]))
      .catch(() => undefined)
  }, true)
}
