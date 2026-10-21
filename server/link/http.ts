import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { LinkFailure } from '../../src/link/types.ts'

// Small, careful HTTP helpers for the link pipeline: every request has a
// timeout, a size cap, and (for arbitrary pages) a check that the address is
// on the public internet. Nothing here downloads or keeps video.

export class LinkError extends Error {
  readonly reason: LinkFailure
  constructor(reason: LinkFailure, message?: string) {
    super(message ?? reason)
    this.reason = reason
  }
}

export type Fetch = typeof fetch

export type FetchTextOptions = {
  fetchImpl?: Fetch
  timeoutMs?: number
  maxBytes?: number
  headers?: Record<string, string>
  /** Resolve the host and refuse private, loopback and link-local addresses. */
  publicOnly?: boolean
  /** Hook for tests: replaces the DNS check. */
  resolveHost?: (host: string) => Promise<string[]>
}

export type TextResponse = { status: number; url: string; contentType: string; text: string }

const UA = 'Mozilla/5.0 (compatible; PactLinkReader/1.0; +reads public titles and captions only)'

/** GET a URL as text. Follows up to 3 redirects, re-checking each hop. */
export async function fetchText(url: string, opts: FetchTextOptions = {}): Promise<TextResponse> {
  const { fetchImpl = fetch, timeoutMs = 8000, maxBytes = 512 * 1024, headers = {}, publicOnly = false } = opts
  const signal = AbortSignal.timeout(timeoutMs)
  let current = url
  for (let hop = 0; hop <= 3; hop++) {
    if (publicOnly) await assertPublic(current, opts.resolveHost)
    let res: Response
    try {
      res = await fetchImpl(current, {
        headers: { 'user-agent': UA, accept: 'text/html,application/json;q=0.9,*/*;q=0.5', ...headers },
        redirect: 'manual',
        signal,
      })
    } catch (e) {
      throw toLinkError(e)
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current).toString()
      continue
    }
    if (res.status === 429) throw new LinkError('rate_limited')
    const text = await readCapped(res, maxBytes).catch((e) => {
      throw toLinkError(e)
    })
    return { status: res.status, url: current, contentType: res.headers.get('content-type') ?? '', text }
  }
  throw new LinkError('upstream', 'Too many redirects')
}

/** GET JSON; null for any non-2xx answer (a missing or private post). */
export async function fetchJson<T>(url: string, opts: FetchTextOptions = {}): Promise<T | null> {
  const res = await fetchText(url, { ...opts, headers: { accept: 'application/json', ...opts.headers } })
  if (res.status < 200 || res.status >= 300) return null
  try {
    return JSON.parse(res.text) as T
  } catch {
    return null
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < maxBytes) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
  }
  void reader.cancel().catch(() => {})
  const all = new Uint8Array(Math.min(size, maxBytes))
  let at = 0
  for (const c of chunks) {
    const part = c.subarray(0, all.length - at)
    all.set(part, at)
    at += part.length
    if (at >= all.length) break
  }
  return new TextDecoder().decode(all)
}

export function toLinkError(e: unknown): LinkError {
  if (e instanceof LinkError) return e
  const name = (e as { name?: string })?.name
  if (name === 'TimeoutError' || name === 'AbortError') return new LinkError('timeout')
  return new LinkError('upstream', (e as Error)?.message)
}

/** The platforms' own sites: known public, so no DNS check is needed (or possible behind some proxies). */
const PLATFORM_HOST = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|facebook\.com|fb\.watch|tiktok\.com)$/i

async function assertPublic(url: string, resolveHost?: (host: string) => Promise<string[]>) {
  const u = new URL(url)
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new LinkError('bad_link')
  if (u.port && u.port !== '80' && u.port !== '443') throw new LinkError('bad_link')
  if (PLATFORM_HOST.test(u.hostname)) return
  const host = u.hostname.replace(/^\[|\]$/g, '')
  let addresses: string[]
  if (isIP(host)) addresses = [host]
  else {
    try {
      addresses = resolveHost ? await resolveHost(host) : (await lookup(host, { all: true })).map((a) => a.address)
    } catch {
      throw new LinkError('bad_link')
    }
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new LinkError('bad_link')
}

export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
  }
  const s = ip.toLowerCase()
  return s === '::' || s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')
}
