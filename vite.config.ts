import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'node:path'
import { createRequire } from 'node:module'

const pkg = createRequire(import.meta.url)('./package.json') as { version: string }

// HTTPS on the dev server so phones/tablets (which auto-upgrade http -> https)
// can open the LAN URL. The cert is self-signed: the device shows a one-time
// "not private" warning — tap Advanced > Proceed to continue.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // HTTPS is opt-in (VITE_HTTPS=1). The self-signed cert covers localhost, not
  // the LAN IP, so on a phone the page loads after the warning but the HMR
  // websocket is refused — changes then need a manual refresh. Plain HTTP over
  // the LAN keeps hot reload working.
  plugins: [react(), ...(process.env.VITE_HTTPS === '1' ? [basicSsl()] : [])],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: { port: 5180, host: '0.0.0.0', open: false, hmr: { clientPort: 5180 } },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false,
    cssCodeSplit: true,
    rollupOptions: {
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
