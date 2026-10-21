import { loadEnv, type Plugin } from 'vite'
import { createLinkApi } from './link/api.ts'
import { pickLinkEnv } from './link/env.ts'

// Mounts the link API on the Vite dev server (npm run dev) and preview server
// (npm run preview). Keys come from the shell or .env/.env.local, server side only.

export function pactLinkApi(): Plugin {
  let api: ReturnType<typeof createLinkApi>
  return {
    name: 'pact-link-api',
    configResolved(config) {
      const env = pickLinkEnv({ ...loadEnv(config.mode, config.envDir || process.cwd(), ''), ...process.env })
      api = createLinkApi(env)
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => api(req, res, next))
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => api(req, res, next))
    },
  }
}
