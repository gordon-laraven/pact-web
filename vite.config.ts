/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pactLinkApi } from './server/vitePlugin.ts'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [react(), pactLinkApi()],
  // Shown in problem reports.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
  },
})
