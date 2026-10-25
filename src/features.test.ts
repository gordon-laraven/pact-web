import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import type { Connect, PreviewServer, ResolvedConfig } from 'vite'
import { pactLinkApi } from '../server/vitePlugin'
import { ENABLE_LINK_IMPORT } from './features'

describe('ENABLE_LINK_IMPORT', () => {
  it('is off by default', () => {
    expect(ENABLE_LINK_IMPORT).toBe(false)
  })

  /** Runs the plugin's middleware on a real server and asks it for a link route. */
  async function statusOfLinkRoute(enabled?: boolean) {
    const plugin = pactLinkApi(enabled === undefined ? {} : { enabled })
    ;(plugin.configResolved as (c: Partial<ResolvedConfig>) => void)({ mode: 'test', envDir: '/nonexistent' })
    let mw: Connect.NextHandleFunction = () => {}
    const fake = { middlewares: { use: (f: Connect.NextHandleFunction) => (mw = f) } } as unknown as PreviewServer
    ;(plugin.configurePreviewServer as (s: PreviewServer) => void)(fake)
    const server = createServer((req, res) => mw(req as Connect.IncomingMessage, res, () => res.writeHead(404).end()))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    const res = await fetch(`http://127.0.0.1:${port}/api/link/typed`, { method: 'POST', body: JSON.stringify({ text: 'squats 3x10' }) })
    server.close()
    return res.status
  }

  it('when off, the server has no link API (nothing is mounted)', async () => {
    expect(await statusOfLinkRoute()).toBe(404)
  })

  it('when switched on, the link API answers again', async () => {
    expect(await statusOfLinkRoute(true)).toBe(200)
  })
})
