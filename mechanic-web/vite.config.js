import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

export default defineConfig({
  css: { postcss: { plugins: [] } },
  plugins: [react(), {
    name: 'mechanic-offline-shell',
    writeBundle(options, bundle) {
      const assets = Object.keys(bundle).filter((name) => /\.(js|css|woff2)$/.test(name)).map((name) => `/${name}`)
      const core = ['/', '/index.html', '/icon-192.png', '/manifest.webmanifest', ...assets]
      const source = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8')
      const version = createHash('sha256').update(source + assets.join(',')).digest('hex').slice(0, 12)
      writeFileSync(resolve(options.dir, 'sw.js'), source
        .replace("'shiv-mechanic-v1'", JSON.stringify(`shiv-mechanic-${version}`))
        .replace("['/', '/index.html', '/icon-192.png', '/manifest.webmanifest']", JSON.stringify(core)))
    },
  }],
})
