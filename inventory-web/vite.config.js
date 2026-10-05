import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// A new shell gets a new worker automatically; no manual version bump needed.
function inventoryOfflineShell() {
  let config
  return {
    name: 'inventory-offline-shell',
    apply: 'build',
    configResolved(value) { config = value },
    writeBundle(_options, bundle) {
      const publicFiles = ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png']
      const template = readFileSync(resolve(config.publicDir, 'sw.js'), 'utf8')
      const hash = createHash('sha256').update(template)
      for (const name of Object.keys(bundle).sort()) {
        const file = bundle[name]
        hash.update(name).update(file.type === 'chunk' ? file.code : file.source)
      }
      for (const name of publicFiles) hash.update(readFileSync(resolve(config.publicDir, name)))
      const assets = [...new Set(['/index.html', ...Object.keys(bundle).map(name => `/${name}`), ...publicFiles.map(name => `/${name}`)])]
      writeFileSync(resolve(config.root, config.build.outDir, 'sw.js'), template
        .replace('__BUILD_VERSION__', hash.digest('hex').slice(0, 16))
        .replace('/* __BUILD_ASSETS__ */', assets.map(name => JSON.stringify(name)).join(',')))
    },
  }
}

export default defineConfig({
  plugins: [react(), inventoryOfflineShell()],
})
