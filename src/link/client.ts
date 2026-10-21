import { parseExerciseList } from './localParse'
import type { ExtractResponse, LinkFailure, LinkPlatform, LinkPost, LinkWorkout, ReadResponse } from './types'

// The browser side of "paste a link". Each step is its own call so the screen
// can say what's happening; runLinkPipeline stops at the first step that
// gives a usable list.

export type PipelineStep = 'reading' | 'watching'

export type PipelineResult =
  | { kind: 'ok'; platform: LinkPlatform | null; url: string; post: LinkPost | null; workout: LinkWorkout }
  | { kind: 'fallback'; platform: LinkPlatform | null; url: string | null; post: LinkPost | null; reason: LinkFailure }

type Fetch = typeof fetch

async function post<T>(path: string, body: unknown, fetchImpl: Fetch, signal?: AbortSignal, timeoutMs = 40_000): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const res = await fetchImpl(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (res.status === 404) throw new ApiMissing()
  const data = (await res.json().catch(() => null)) as T | null
  if (!data) throw new Error(`Bad response (${res.status})`)
  return data
}

/** The API isn't there (a static host without the server part). */
class ApiMissing extends Error {}

const failureFrom = (e: unknown): LinkFailure => {
  const name = (e as { name?: string })?.name
  if (name === 'TimeoutError') return 'timeout'
  return 'upstream'
}

export function readPost(url: string, fetchImpl: Fetch = fetch, signal?: AbortSignal) {
  return post<ReadResponse>('/api/link/read', { url }, fetchImpl, signal)
}

export function watchVideo(url: string, fetchImpl: Fetch = fetch, signal?: AbortSignal) {
  return post<ExtractResponse>('/api/link/watch', { url }, fetchImpl, signal, 150_000)
}

/** A typed or pasted list. Falls back to the in-browser parser if the server isn't reachable. */
export async function extractTyped(text: string, fetchImpl: Fetch = fetch, signal?: AbortSignal): Promise<ExtractResponse> {
  try {
    const res = await post<ExtractResponse>('/api/link/typed', { text }, fetchImpl, signal)
    if (res.ok || (res.reason !== 'upstream' && res.reason !== 'rate_limited' && res.reason !== 'timeout' && res.reason !== 'too_many_requests')) return res
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
  }
  const local = parseExerciseList(text, 'typed')
  return local ? { ok: true, workout: local } : { ok: false, reason: 'no_exercises' }
}

export async function runLinkPipeline(
  url: string,
  opts: { onStep?: (step: PipelineStep) => void; fetchImpl?: Fetch; signal?: AbortSignal } = {},
): Promise<PipelineResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  opts.onStep?.('reading')
  let read: ReadResponse
  try {
    read = await readPost(url, fetchImpl, opts.signal)
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    return { kind: 'fallback', platform: null, url: null, post: null, reason: e instanceof ApiMissing ? 'not_configured' : failureFrom(e) }
  }
  if (read.ok) return { kind: 'ok', platform: read.platform, url: read.url, post: read.post, workout: read.workout }
  if (!read.canWatch || !read.url || read.reason === 'too_many_requests' || read.reason === 'bad_link') {
    return { kind: 'fallback', platform: read.platform, url: read.url, post: read.post, reason: read.reason }
  }

  opts.onStep?.('watching')
  try {
    const watched = await watchVideo(read.url, fetchImpl, opts.signal)
    if (watched.ok) return { kind: 'ok', platform: read.platform, url: read.url, post: read.post, workout: watched.workout }
    return { kind: 'fallback', platform: read.platform, url: read.url, post: read.post, reason: watched.reason }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    return { kind: 'fallback', platform: read.platform, url: read.url, post: read.post, reason: failureFrom(e) }
  }
}

/** Platform from a pasted link, for the little chip under the input (no network). */
export function detectPlatform(input: string): LinkPlatform | null {
  const s = input.trim().toLowerCase()
  if (!/^(https?:\/\/)?[^\s/]+\.[^\s/]+/.test(s)) return null
  if (/(^|\/\/|\.)(youtube\.com|youtu\.be)\b/.test(s)) return 'youtube'
  if (/(^|\/\/|\.)(instagram\.com|instagr\.am)\b/.test(s)) return 'instagram'
  if (/(^|\/\/|\.)(facebook\.com|fb\.watch|fb\.com)\b/.test(s)) return 'facebook'
  if (/(^|\/\/|\.)tiktok\.com\b/.test(s)) return 'tiktok'
  return 'other'
}

export const PLATFORM_NAME: Record<LinkPlatform, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  other: 'Web page',
}
