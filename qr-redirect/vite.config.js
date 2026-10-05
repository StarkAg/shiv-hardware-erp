import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Its own PostCSS config (none), not the panel's Tailwind one in the folder above.
export default defineConfig({ plugins: [react()], css: { postcss: {} } })
