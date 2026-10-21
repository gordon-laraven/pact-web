import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ExtractResponse, LinkFailure, ReadResponse } from '../../src/link/types.ts'
import type { LinkEnv } from './env.ts'
import { extractFromText, extractFromYouTube } from './extract.ts'
import { LinkError, type Fetch } from './http.ts'
import { readPostText } from './metadata.ts'
import { parseLink } from './platform.ts'

// The link pipeline's HTTP API. One route per step, so the browser can show
// what's happening ("Reading the post…", "Watching the video…"):
//
//   POST /api/link/read   { url }   step 1 + 2: check the link, read its public text, extract
//   POST /api/link/watch  { url }   step 3: YouTube only, the video model
//   POST /api/link/typed  { text }  fallback: a pasted or typed list
//
// Nothing is stored. Video is never downloaded, cached or re-hosted.

export type LinkApiDeps = {
  fetchImpl?: Fetch
  resolveHost?: (host: string) => Promise<string[]>
  /** Requests allowed per visitor per window (default 30 per 10 minutes). */
  rateLimit?: { max: number; windowMs: number }
  now?: () => number
}

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void

export function createLinkApi(env: LinkEnv, deps: LinkApiDeps = {}): Middleware {
  const limit = rateLimiter(deps.rateLimit ?? { max: 30, windowMs: 10 * 60_000 }, deps.now ?? Date.now)

  const routes: Record<string, (body: Record<string, unknown>) => Promise<unknown>> = {
    read: (body) => readStep(String(body.url ?? ''), env, deps),
    watch: (body) => watchStep(String(body.url ?? ''), env, deps),
    typed: (body) => typedStep(String(body.text ?? ''), env, deps),
  }

  return (req, res, next) => {
    const path = (req.url ?? '').split('?')[0]
    const m = path.match(/^\/api\/link\/(read|watch|typed)\/?$/)
    if (!m) return next()
    if (req.method !== 'POST') return send(res, 405, { ok: false, reason: 'bad_link' })
    if (!limit(clientKey(req))) return send(res, 429, { ok: false, reason: 'too_many_requests' })
    readBody(req)
      .then((body) => routes[m[1]](body))
      .then((out) => send(res, 200, out))
      .catch((e) => {
        if (e instanceof BodyError) return send(res, 400, { ok: false, reason: 'bad_link' })
        console.error('[link]', e)
        send(res, 500, { ok: false, reason: 'upstream' })
      })
  }
}

export async function readStep(input: string, env: LinkEnv, deps: LinkApiDeps = {}): Promise<ReadResponse> {
  const link = parseLink(input)
  if (!link) return { ok: false, platform: null, url: null, post: null, reason: 'bad_link', canWatch: false }
  const canWatch = link.platform === 'youtube' && !!env.GEMINI_API_KEY
  const fail = (reason: LinkFailure, post: ReadResponse['post'] = null): ReadResponse => ({
    ok: false,
    platform: link.platform,
    url: link.url,
    post,
    reason,
    canWatch,
  })
  try {
    const post = await readPostText(link, env, deps)
    if (!post) return fail('no_text')
    const workout = await extractFromText(post.text, 'caption', env, deps)
    const meta = { title: post.title, author: post.author, authorUrl: post.authorUrl }
    if (!workout) return fail('no_exercises', meta)
    if (post.title && workout.title === 'Workout from a link') workout.title = post.title.slice(0, 80)
    return { ok: true, platform: link.platform, url: link.url, post: meta, workout }
  } catch (e) {
    return fail(e instanceof LinkError ? e.reason : 'upstream')
  }
}

export async function watchStep(input: string, env: LinkEnv, deps: LinkApiDeps = {}): Promise<ExtractResponse> {
  const link = parseLink(input)
  if (!link) return { ok: false, reason: 'bad_link' }
  if (link.platform !== 'youtube') return { ok: false, reason: 'not_youtube' }
  try {
    const workout = await extractFromYouTube(link, env, deps)
    return workout ? { ok: true, workout } : { ok: false, reason: 'no_exercises' }
  } catch (e) {
    return { ok: false, reason: e instanceof LinkError ? e.reason : 'upstream' }
  }
}

export async function typedStep(text: string, env: LinkEnv, deps: LinkApiDeps = {}): Promise<ExtractResponse> {
  if (!text.trim()) return { ok: false, reason: 'no_exercises' }
  try {
    const workout = await extractFromText(text, 'typed', env, deps)
    return workout ? { ok: true, workout } : { ok: false, reason: 'no_exercises' }
  } catch (e) {
    return { ok: false, reason: e instanceof LinkError ? e.reason : 'upstream' }
  }
}

class BodyError extends Error {}

function readBody(req: IncomingMessage, max = 32 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > max) {
        reject(new BodyError('too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        resolve(v && typeof v === 'object' ? v : {})
      } catch {
        reject(new BodyError('not JSON'))
      }
    })
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

const clientKey = (req: IncomingMessage) => req.socket.remoteAddress ?? 'unknown'

function rateLimiter({ max, windowMs }: { max: number; windowMs: number }, now: () => number) {
  const hits = new Map<string, number[]>()
  return (key: string) => {
    const t = now()
    const recent = (hits.get(key) ?? []).filter((h) => t - h < windowMs)
    if (recent.length >= max) {
      hits.set(key, recent)
      return false
    }
    recent.push(t)
    hits.set(key, recent)
    if (hits.size > 5000) for (const [k, v] of hits) if (v.every((h) => t - h >= windowMs)) hits.delete(k)
    return true
  }
}
