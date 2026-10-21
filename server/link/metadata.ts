import type { LinkPost } from '../../src/link/types.ts'
import type { LinkEnv } from './env.ts'
import { fetchJson, fetchText, LinkError, type Fetch } from './http.ts'
import type { ParsedLink } from './platform.ts'

// Step 2a: get the public title, caption and description of a post. Only
// official oEmbed endpoints and the public metadata tags a page shows anyone
// (no logins, no cookies, nothing behind a wall). Video is never fetched.

export type PostText = LinkPost & { /** Everything readable, joined: title, caption, description. */ text: string }

export type MetadataDeps = { fetchImpl?: Fetch; resolveHost?: (host: string) => Promise<string[]> }

type OEmbed = { title?: string; author_name?: string; author_url?: string; html?: string }

// Meta's Graph API version for oEmbed. Check it's still supported before launch.
const META_GRAPH = 'https://graph.facebook.com/v23.0'

export async function readPostText(link: ParsedLink, env: LinkEnv, deps: MetadataDeps = {}): Promise<PostText | null> {
  const opts = { fetchImpl: deps.fetchImpl, resolveHost: deps.resolveHost }
  const pieces: (string | null | undefined)[] = []
  let post: LinkPost = { title: null, author: null, authorUrl: null }
  const take = (o: OEmbed | null) => {
    if (!o) return
    post = { title: post.title ?? clean(o.title), author: post.author ?? clean(o.author_name), authorUrl: post.authorUrl ?? o.author_url ?? null }
    pieces.push(o.title, o.html ? htmlToText(o.html) : null)
  }
  // A single failed source (a 404, a timeout) shouldn't sink the others.
  const tryRead = async <T>(f: () => Promise<T>): Promise<T | null> => {
    try {
      return await f()
    } catch (e) {
      if (e instanceof LinkError && e.reason === 'rate_limited') throw e
      return null
    }
  }

  switch (link.platform) {
    case 'youtube': {
      take(await tryRead(() => fetchJson<OEmbed>(`https://www.youtube.com/oembed?format=json&url=${enc(link.url)}`, opts)))
      if (env.YOUTUBE_API_KEY && link.youtubeId) {
        const data = await tryRead(() =>
          fetchJson<{ items?: { snippet?: { title?: string; description?: string; channelTitle?: string } }[] }>(
            `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${link.youtubeId}&key=${enc(env.YOUTUBE_API_KEY!)}`,
            opts,
          ),
        )
        const s = data?.items?.[0]?.snippet
        if (s) {
          post = { ...post, title: post.title ?? clean(s.title), author: post.author ?? clean(s.channelTitle) }
          pieces.push(s.description)
        }
      } else {
        pieces.push(...(await tryRead(() => pageMeta(link.url, deps))) ?? [])
      }
      break
    }
    case 'tiktok':
      // TikTok's oEmbed title is the caption itself.
      take(await tryRead(() => fetchJson<OEmbed>(`https://www.tiktok.com/oembed?url=${enc(link.url)}`, opts)))
      break
    case 'instagram':
    case 'facebook': {
      if (env.META_OEMBED_TOKEN) {
        const endpoint = link.platform === 'instagram' ? 'instagram_oembed' : /\/(videos|reel|watch)\b|fb\.watch/.test(link.url) ? 'oembed_video' : 'oembed_post'
        take(await tryRead(() => fetchJson<OEmbed>(`${META_GRAPH}/${endpoint}?url=${enc(link.url)}&access_token=${enc(env.META_OEMBED_TOKEN!)}`, opts)))
      }
      if (pieces.filter(Boolean).length === 0) pieces.push(...(await tryRead(() => pageMeta(link.url, deps))) ?? [])
      break
    }
    case 'other':
      pieces.push(...(await tryRead(() => pageMeta(link.url, deps))) ?? [])
      break
  }

  const text = dedupe(pieces.map(clean).filter((p): p is string => !!p)).join('\n\n')
  if (text.replace(/\W/g, '').length < 3) return null
  return { ...post, title: post.title ?? clean(text.split('\n')[0]), text }
}

/** The public title/description tags of a page (what link previews show). */
async function pageMeta(url: string, deps: MetadataDeps): Promise<(string | null)[]> {
  const res = await fetchText(url, { fetchImpl: deps.fetchImpl, resolveHost: deps.resolveHost, publicOnly: true, maxBytes: 768 * 1024 })
  if (res.status < 200 || res.status >= 300 || !/html/i.test(res.contentType)) return []
  // A login wall is not the post: its tags describe the login page.
  if (/\/(accounts\/)?login\b/.test(new URL(res.url).pathname)) return []
  const m = parseMetaTags(res.text)
  return [m.title, m.description].map((v) => (v && !GENERIC.test(v.trim()) ? v.replace(STATS, '') : null))
}

/** Titles a platform shows when it won't show the post. */
const GENERIC = /^(instagram|facebook|tiktok( - make your day)?|youtube|log ?in\b.*|sign up\b.*|watch\b.*on facebook|error)$/i
/** "410K views · 5.4K reactions | " in front of Facebook titles. */
const STATS = /^\s*[\d.,]+[KMB]?\s+views?\s*·\s*[\d.,]+[KMB]?\s+reactions?\s*\|\s*/i

/** og:/twitter:/plain meta tags and <title>, decoded. Pure, for tests. */
export function parseMetaTags(html: string): { title: string | null; description: string | null } {
  const head = html.slice(0, 200_000)
  const metas = new Map<string, string>()
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = attr(tag, 'property') ?? attr(tag, 'name')
    const content = attr(tag, 'content')
    if (key && content != null && !metas.has(key.toLowerCase())) metas.set(key.toLowerCase(), decodeEntities(content))
  }
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const pick = (...keys: string[]) => keys.map((k) => metas.get(k)).find((v) => v && v.trim()) ?? null
  return {
    title: pick('og:title', 'twitter:title') ?? (titleTag ? decodeEntities(titleTag).trim() || null : null),
    description: pick('og:description', 'twitter:description', 'description'),
  }
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null
}

export function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, code: string) => {
    const c = code.toLowerCase()
    if (c in named) return named[c]
    if (c.startsWith('#x')) return safeChar(parseInt(c.slice(2), 16)) ?? m
    if (c.startsWith('#')) return safeChar(parseInt(c.slice(1), 10)) ?? m
    return m
  })
}
const safeChar = (n: number) => (Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : null)

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
}

function clean(s: string | null | undefined): string | null {
  if (!s) return null
  const t = s
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return t ? t.slice(0, 6000) : null
}

function dedupe(parts: string[]): string[] {
  const out: string[] = []
  for (const p of parts) if (!out.includes(p)) out.push(p)
  // Drop pieces that a longer one already contains (a title inside its description).
  return out.filter((p, i) => !out.some((o, j) => j !== i && o.length > p.length && o.includes(p)))
}

const enc = encodeURIComponent
