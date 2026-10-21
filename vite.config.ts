/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pactLinkApi } from './server/vitePlugin.ts'

export default defineConfig({
  plugins: [react(), pactLinkApi()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
})
