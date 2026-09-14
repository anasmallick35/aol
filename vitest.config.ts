import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    // Detector failures are deliberately logged loudly; silence them here so a
    // green run is readable.
    env: { AOL_LOG_LEVEL: 'silent', AOL_LOG_STDERR: '0' },
  },
})
