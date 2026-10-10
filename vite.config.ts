import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'

const pkg = createRequire(import.meta.url)('./package.json') as { version: string }

// Short commit + build time, shown beside the version so a web deploy can be
// told apart from the last one (the package version doesn't change per deploy).
function buildId() {
  let sha = process.env.VERCEL_GIT_COMMIT_SHA ?? ''
  if (!sha) {
    try {
      sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      sha = ''
    }
  }
  const stamp = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  return [sha.slice(0, 7), stamp].filter(Boolean).join(' · ')
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
  plugins: [react(), ...(process.env.VITE_HTTPS === '1' ? [basicSsl()] : [])],
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
