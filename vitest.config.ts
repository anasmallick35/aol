import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      // Test against source, not the built bundle, so a stale dist can never
      // make a red suite look green.
      '@aol/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@aol/hooks': fileURLToPath(new URL('./packages/adapter-agent-hooks/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    // Detector failures are deliberately logged loudly; silence them here so a
    // green run is readable.
    env: { AOL_LOG_LEVEL: 'silent', AOL_LOG_STDERR: '0' },
  },
})
