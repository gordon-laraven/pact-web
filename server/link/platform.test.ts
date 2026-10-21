import { describe, expect, it } from 'vitest'
import { parseLink } from './platform'

describe('parseLink', () => {
  it('recognises YouTube watch, Shorts and youtu.be links, and normalises them', () => {
    for (const u of [
      'https://www.youtube.com/shorts/abcdefghijk',
      'youtube.com/watch?v=abcdefghijk&t=10',
      'https://youtu.be/abcdefghijk?si=xyz',
      'https://m.youtube.com/watch?v=abcdefghijk',
    ]) {
      expect(parseLink(u)).toEqual({ url: 'https://www.youtube.com/watch?v=abcdefghijk', platform: 'youtube', youtubeId: 'abcdefghijk' })
    }
  })

  it('refuses YouTube links without a video id', () => {
    expect(parseLink('https://www.youtube.com/@somechannel')).toBeNull()
  })

  it('detects Instagram, Facebook and TikTok', () => {
    expect(parseLink('https://www.instagram.com/reel/C1234/')?.platform).toBe('instagram')
    expect(parseLink('https://www.facebook.com/reel/1284724616416546')?.platform).toBe('facebook')
    expect(parseLink('https://fb.watch/abc/')?.platform).toBe('facebook')
    expect(parseLink('https://www.tiktok.com/@coach/video/123')?.platform).toBe('tiktok')
    expect(parseLink('https://vm.tiktok.com/ZM123/')?.platform).toBe('tiktok')
    expect(parseLink('https://example.com/my-workout')?.platform).toBe('other')
  })

  it('rejects things that are not web links', () => {
    for (const bad of ['', 'hello world', 'javascript:alert(1)', 'ftp://example.com/x', 'https://localhost/x', 'https://user:pw@example.com/']) {
      expect(parseLink(bad)).toBeNull()
    }
  })
})
