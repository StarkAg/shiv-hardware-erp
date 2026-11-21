import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// No offline copy (public/sw.js only takes away one left from before).
export default defineConfig({
  css: { postcss: { plugins: [] } },
  plugins: [react()],
})
