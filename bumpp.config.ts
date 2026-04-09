import { defineConfig } from 'bumpp'

export default defineConfig({
  files: ['package.json'],
  commit: 'chore: release v%s',
  tag: 'v%s',
  push: true,
  execute: 'pnpm run build',
})
