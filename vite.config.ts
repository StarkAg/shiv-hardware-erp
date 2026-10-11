import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const pkg = createRequire(import.meta.url)('./package.json') as { version: string }

function commitSha() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? ''
  if (sha) return sha
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

// Short commit + build time, shown beside the version so a web deploy can be
// told apart from the last one (the package version doesn't change per deploy).
function buildId() {
  const sha = commitSha()
  const stamp = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  return [sha.slice(0, 7), stamp].filter(Boolean).join(' · ')
}

/**
 * build.json beside the build: when it was made, from which commit, and every
 * file with its SHA-256. The desktop apps read it (electron/screens.cjs) to
 * tell which copy of their screens is the newer one, and to take a newer copy
 * from the panel website file by file, each one checked.
 */
function buildStamp(): Plugin {
  let outDir = ''
  return {
    name: 'shiv-build-stamp',
    apply: 'build',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir) },
    closeBundle() {
      const files: { path: string; size: number; sha256: string }[] = []
      const walk = (dir: string, under: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const rel = under ? `${under}/${entry.name}` : entry.name
          if (entry.isDirectory()) walk(path.join(dir, entry.name), rel)
          else if (rel !== 'build.json') {
            const data = readFileSync(path.join(dir, entry.name))
            files.push({ path: rel, size: data.length, sha256: createHash('sha256').update(data).digest('hex') })
          }
        }
      }
      walk(outDir, '')
      writeFileSync(path.join(outDir, 'build.json'), JSON.stringify({ builtAt: Date.now(), id: buildId(), commit: commitSha(), files }))
    },
  }
}

// HTTPS on the dev server so phones/tablets (which auto-upgrade http -> https)
// can open the LAN URL. The cert is self-signed: the device shows a one-time
// "not private" warning — tap Advanced > Proceed to continue.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  // HTTPS is opt-in (VITE_HTTPS=1). The self-signed cert covers localhost, not
  // the LAN IP, so on a phone the page loads after the warning but the HMR
  // websocket is refused — changes then need a manual refresh. Plain HTTP over
  // the LAN keeps hot reload working.
  plugins: [react(), buildStamp(), ...(process.env.VITE_HTTPS === '1' ? [basicSsl()] : [])],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5180, host: '0.0.0.0', open: false, hmr: { clientPort: 5180 },
    // Desktop app builds write and lock temp files in these folders; watching
    // them crashed the dev server (EBUSY on release-quotation/win-unpacked).
    // print-server/data is the print server's own working files (WhatsApp
    // login, its backups, queues): written and locked while it runs, never
    // source. Watching it crashed the dev server with EBUSY (2026-10-10).
    watch: { ignored: ['**/release/**', '**/release-quotation/**', '**/build/**', '**/backups/**', '**/print-server/data/**', '**/print-server/.wwebjs_cache/**', '**/.counter-dist/**', '**/.deploy-tree/**'] },
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false,
    cssCodeSplit: true,
    rollupOptions: {
      /**
       * Two sites, one project.
       *
       * The counter's screens and the books share every helper in src/, so they
       * are two entry points rather than two codebases — a copied one drifts,
       * which is how the sorting site ended up with its own name matching.
       * Each is deployed as its own Vercel project from this one dist.
       */
      input: {
        main: path.resolve(__dirname, 'index.html'),
        counter: path.resolve(__dirname, 'counter.html'),
      },
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'state': ['zustand'],
          'icons': ['lucide-react'],
        },
      },
    },
  },
})
