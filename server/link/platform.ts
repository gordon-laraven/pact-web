import type { LinkPlatform } from '../../src/link/types.ts'

// Step 1: check the pasted text is a web link and work out where it's from.

export type ParsedLink = {
  /** Normalised https URL. */
  url: string
  platform: LinkPlatform
  /** YouTube video id, for oEmbed, the Data API and the video model. */
  youtubeId?: string
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/

export function parseLink(input: string): ParsedLink | null {
  const raw = input.trim()
  if (!raw || raw.length > 2048 || /\s/.test(raw)) return null
  let u: URL
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (u.username || u.password) return null
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '')
  if (!host.includes('.')) return null
  u.hash = ''
  u.protocol = 'https:'

  if (host === 'youtu.be' || host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    const id = youtubeId(u, host)
    return id ? { url: `https://www.youtube.com/watch?v=${id}`, platform: 'youtube', youtubeId: id } : null
  }
  if (host === 'instagram.com' || host === 'instagr.am') return { url: u.toString(), platform: 'instagram' }
  if (host === 'facebook.com' || host === 'fb.watch' || host === 'fb.com' || host.endsWith('.facebook.com')) {
    return { url: u.toString(), platform: 'facebook' }
  }
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return { url: u.toString(), platform: 'tiktok' }
  return { url: u.toString(), platform: 'other' }
}

function youtubeId(u: URL, host: string): string | null {
  const parts = u.pathname.split('/').filter(Boolean)
  const candidate =
    host === 'youtu.be'
      ? parts[0]
      : parts[0] === 'watch'
        ? u.searchParams.get('v')
        : ['shorts', 'embed', 'live', 'v'].includes(parts[0] ?? '')
          ? parts[1]
          : null
  return candidate && YT_ID.test(candidate) ? candidate : null
}
