import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['reports/erp-audit-2026-10-08.repro.test.ts'],
    environment: 'edge-runtime',
    server: { deps: { inline: ['convex-test'] } },
  },
})
