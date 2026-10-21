import { describe, expect, it } from 'vitest'
import { isPrivateAddress } from './http'
import { parseMetaTags, readPostText } from './metadata'
import { parseLink } from './platform'
import { fakeFetch, publicHost } from './testFetch'

describe('parseMetaTags', () => {
  it('reads og tags first, decodes entities, and falls back to <title>', () => {
    const html = `<html><head><title>Ignored</title>
      <meta property="og:title" content="Leg day &amp; more">
      <meta name='description' content='plain'>
      <meta content="Squats 3x12&#10;Lunges x10" property="og:description" /></head></html>`
    expect(parseMetaTags(html)).toEqual({ title: 'Leg day & more', description: 'Squats 3x12\nLunges x10' })
    expect(parseMetaTags('<title>Just a title</title>')).toEqual({ title: 'Just a title', description: null })
  })
})

describe('readPostText', () => {
  it('YouTube: title from oEmbed, description from the public page tags', async () => {
    const { impl } = fakeFetch([
      [/youtube\.com\/oembed/, { json: { title: 'Quick legs', author_name: 'Coach A', author_url: 'https://youtube.com/@a' } }],
      [/youtube\.com\/watch/, { html: '<meta property="og:description" content="Squats 3x12. Lunges 3x10.">' }],
    ])
    const link = parseLink('https://youtube.com/shorts/abcdefghijk')!
    const post = await readPostText(link, {}, { fetchImpl: impl, resolveHost: publicHost })
    expect(post).toMatchObject({ title: 'Quick legs', author: 'Coach A', authorUrl: 'https://youtube.com/@a' })
    expect(post?.text).toContain('Quick legs')
    expect(post?.text).toContain('Squats 3x12')
  })

  it('YouTube with a Data API key uses the full description instead of the page', async () => {
    const { impl, calls } = fakeFetch([
      [/youtube\.com\/oembed/, { json: { title: 'Quick legs' } }],
      [/googleapis\.com\/youtube\/v3\/videos/, { json: { items: [{ snippet: { description: 'Full: squats 3x12' } }] } }],
    ])
    const post = await readPostText(parseLink('youtu.be/abcdefghijk')!, { YOUTUBE_API_KEY: 'k' }, { fetchImpl: impl, resolveHost: publicHost })
    expect(post?.text).toContain('Full: squats 3x12')
    expect(calls.some((c) => c.url.includes('/watch'))).toBe(false)
  })

  it('TikTok: the oEmbed title is the caption', async () => {
    const { impl } = fakeFetch([[/tiktok\.com\/oembed/, { json: { title: 'Plank 30s, push-ups x10', author_name: 'coachb' } }]])
    const post = await readPostText(parseLink('https://www.tiktok.com/@coachb/video/1')!, {}, { fetchImpl: impl })
    expect(post).toMatchObject({ author: 'coachb', text: 'Plank 30s, push-ups x10' })
  })

  it('Instagram without a token: a login wall gives nothing', async () => {
    const { impl } = fakeFetch([
      [/instagram\.com\/reel/, { status: 302, headers: { location: 'https://www.instagram.com/accounts/login/' } }],
      [/instagram\.com\/accounts\/login/, { html: '<meta property="og:title" content="Login • Instagram">' }],
    ])
    const post = await readPostText(parseLink('https://www.instagram.com/reel/C1/')!, {}, { fetchImpl: impl, resolveHost: publicHost })
    expect(post).toBeNull()
  })

  it('ignores generic platform titles and Facebook view counts', async () => {
    const ig = fakeFetch([[/instagram/, { html: '<meta property="og:title" content="Instagram">' }]])
    expect(await readPostText(parseLink('https://www.instagram.com/reel/C1/')!, {}, { fetchImpl: ig.impl })).toBeNull()
    const fb = fakeFetch([[/facebook/, { html: '<meta property="og:title" content="410K views · 5.4K reactions | Simple home moves">' }]])
    const post = await readPostText(parseLink('https://www.facebook.com/reel/1/')!, {}, { fetchImpl: fb.impl })
    expect(post?.title).toBe('Simple home moves')
  })

  it('refuses to fetch pages on private addresses', async () => {
    const { impl, calls } = fakeFetch([[/./, { html: '<title>secret</title>' }]])
    const post = await readPostText(parseLink('https://intranet.example.com/x')!, {}, { fetchImpl: impl, resolveHost: async () => ['10.0.0.5'] })
    expect(post).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('knows private address ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip)).toBe(true)
    }
    expect(isPrivateAddress('93.184.216.34')).toBe(false)
  })
})
