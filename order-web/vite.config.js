import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Two apps, one origin. The counter and the workshop are separate screens for
// separate people, but they read the same jobs out of the same storage — and
// browser storage does not cross origins, so they have to ship together.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        workshop: resolve(__dirname, 'workshop.html'),
      },
    },
  },
})
