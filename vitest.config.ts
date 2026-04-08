import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/gen/**', 'src/index.ts', 'src/client/index.ts'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: {
        branches: 88,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
})
