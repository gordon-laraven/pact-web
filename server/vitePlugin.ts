import { loadEnv, type Plugin } from 'vite'
import { ENABLE_LINK_IMPORT } from '../src/features.ts'
import { createLinkApi } from './link/api.ts'
import { pickLinkEnv } from './link/env.ts'

// Mounts the link API on the Vite dev server (npm run dev) and preview server
// (npm run preview). Keys come from the shell or .env/.env.local, server side only.

export function pactLinkApi({ enabled = ENABLE_LINK_IMPORT }: { enabled?: boolean } = {}): Plugin {
  let api: ReturnType<typeof createLinkApi>
  return {
    name: 'pact-link-api',
    configResolved(config) {
      const env = pickLinkEnv({ ...loadEnv(config.mode, config.envDir || process.cwd(), ''), ...process.env })
      // Off (src/features.ts): nothing is mounted, so /api/link/* doesn't exist.
      api = enabled ? createLinkApi(env) : (_req, _res, next) => next()
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => api(req, res, next))
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => api(req, res, next))
    },
  }
}
