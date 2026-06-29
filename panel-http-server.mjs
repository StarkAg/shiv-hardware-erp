import { createServer as createHttpsServer } from 'node:https'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getCertificate } from '@vitejs/plugin-basic-ssl'

const rootDir = resolve(fileURLToPath(new URL('.', import.meta.url)))
const publicDir = resolve(rootDir, 'dist')
const host = process.env.PANEL_HOST || '0.0.0.0'
const port = Number(process.env.PANEL_PORT || 5181)

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

function resolveAsset(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split('?')[0] || '/')
  const normalizedPath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, '')
  const candidate = resolve(join(publicDir, normalizedPath))

  if (!candidate.startsWith(publicDir + sep) && candidate !== publicDir) {
    return join(publicDir, 'index.html')
  }

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate
  }

  return join(publicDir, 'index.html')
}

function handleRequest(req, res) {
  try {
    const filePath = resolveAsset(req.url || '/')
    const contentType = mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream'

    res.writeHead(200, {
      'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
      'Content-Type': contentType,
    })

    createReadStream(filePath).pipe(res)
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`Panel server error: ${error.message}`)
  }
}

const certificate = await getCertificate(
  join(rootDir, 'node_modules/.vite/panel-basic-ssl'),
  'shiv-panel',
  ['localhost', '127.0.0.1', '192.168.29.55'],
)

const server = createHttpsServer({ cert: certificate, key: certificate }, handleRequest)

server.listen(port, host, () => {
  console.log(`Shiv Panel running at https://${host}:${port}/`)
})
