import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

export default defineConfig({
  css: { postcss: { plugins: [] } },
  plugins: [react(), {
    // On the computer (npm run dev) the phone copy only gets in the way: it
    // keeps changed files and serves them back half old, half new. The worker
    // the dev server hands out instead throws away what an earlier one kept,
    // takes itself off, and reloads the open pages from the server.
    name: 'workshop-no-worker-in-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/sw.js', (req, res) => {
        res.setHeader('Content-Type', 'text/javascript')
        res.setHeader('Cache-Control', 'no-store')
        res.end(`self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const keys = await caches.keys()
  await Promise.all(keys.filter((k) => k.startsWith('workshop-shell-')).map((k) => caches.delete(k)))
  await self.registration.unregister()
  for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url)
})()))`)
      })
    },
  }, {
    name: 'mechanic-offline-shell',
    writeBundle(options, bundle) {
      const assets = Object.keys(bundle).filter((name) => /\.(js|css)$/.test(name)).map((name) => `/${name}`)
      const core = ['/', '/index.html', '/icon-192.png', '/manifest.webmanifest', ...assets]
      const source = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8')
      const version = createHash('sha256').update(source + assets.join(',')).digest('hex').slice(0, 12)
      writeFileSync(resolve(options.dir, 'sw.js'), source
        .replace("'shiv-mechanic-v1'", JSON.stringify(`shiv-mechanic-${version}`))
        .replace("['/', '/index.html', '/icon-192.png', '/manifest.webmanifest']", JSON.stringify(core)))
    },
  }],
})
