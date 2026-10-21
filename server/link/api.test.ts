import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createLinkApi, readStep, typedStep, watchStep } from './api'
import { fakeFetch, geminiAnswer, publicHost } from './testFetch'

const SHORT = 'https://www.youtube.com/shorts/abcdefghijk'
const gemini = /generativelanguage\.googleapis\.com/
const listed = { title: 'Leg day', confidence: 'high', exercises: [{ name: 'Squat', sets: 3, reps: 12 }, { name: 'Plank', duration_seconds: 30 }] }

describe('read step (caption first)', () => {
  it('sends the caption to the model and returns its list', async () => {
    const { impl, calls } = fakeFetch([
      [/youtube\.com\/oembed/, { json: { title: 'Leg day', author_name: 'Coach A' } }],
      [/youtube\.com\/watch/, { html: '<meta name="description" content="Squats 3x12 then a 30s plank">' }],
      [gemini, geminiAnswer(listed)],
    ])
    const out = await readStep(SHORT, { GEMINI_API_KEY: 'k' }, { fetchImpl: impl, resolveHost: publicHost })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.workout.source).toBe('caption')
    expect(out.workout.exercises.map((e) => e.name)).toEqual(['Squat', 'Plank'])
    expect(out.post.author).toBe('Coach A')
    const req = calls.find((c) => gemini.test(c.url))!
    expect((req.init!.headers as Record<string, string>)['x-goog-api-key']).toBe('k')
    expect(String(req.init!.body)).toContain('Squats 3x12 then a 30s plank')
  })

  it('without an AI key, reads clear lists with the local parser', async () => {
    const { impl } = fakeFetch([[/tiktok\.com\/oembed/, { json: { title: 'Squats 3x12\nPush-ups x10\nPlank 30s' } }]])
    const out = await readStep('https://www.tiktok.com/@a/video/1', {}, { fetchImpl: impl })
    expect(out.ok && out.workout.exercises.map((e) => [e.name, e.reps, e.duration_seconds])).toEqual([
      ['Squats', 12, null],
      ['Push-ups', 10, null],
      ['Plank', null, 30],
    ])
  })

  it('a YouTube caption with no exercises offers the video model next', async () => {
    const { impl } = fakeFetch([
      [/youtube\.com\/oembed/, { json: { title: '10 min burn 🔥' } }],
      [gemini, geminiAnswer({ title: 'x', confidence: 'low', exercises: [] })],
    ])
    const out = await readStep(SHORT, { GEMINI_API_KEY: 'k' }, { fetchImpl: impl, resolveHost: publicHost })
    expect(out).toMatchObject({ ok: false, reason: 'no_exercises', canWatch: true, platform: 'youtube' })
  })

  it('Instagram that shares nothing falls back (no video model)', async () => {
    const { impl } = fakeFetch([])
    const out = await readStep('https://www.instagram.com/reel/C1/', { GEMINI_API_KEY: 'k' }, { fetchImpl: impl, resolveHost: publicHost })
    expect(out).toMatchObject({ ok: false, reason: 'no_text', canWatch: false, platform: 'instagram' })
  })

  it('bad links and model rate limits come back as reasons, not crashes', async () => {
    expect(await readStep('not a link', {})).toMatchObject({ ok: false, reason: 'bad_link' })
    const { impl } = fakeFetch([
      [/tiktok\.com\/oembed/, { json: { title: 'Squats 3x12' } }],
      [gemini, { status: 429, json: { error: { message: 'quota' } } }],
    ])
    expect(await readStep('https://www.tiktok.com/@a/video/1', { GEMINI_API_KEY: 'k' }, { fetchImpl: impl })).toMatchObject({
      ok: false,
      reason: 'rate_limited',
    })
  })
})

describe('watch step (YouTube video model)', () => {
  it('passes the YouTube URL to Gemini as file_data and never fetches the video itself', async () => {
    const { impl, calls } = fakeFetch([[gemini, geminiAnswer(listed)]])
    const out = await watchStep(SHORT, { GEMINI_API_KEY: 'k' }, { fetchImpl: impl })
    expect(out).toMatchObject({ ok: true, workout: { source: 'video-model' } })
    expect(calls).toHaveLength(1)
    const body = JSON.parse(String(calls[0].init!.body))
    expect(body.contents[0].parts[0]).toEqual({ file_data: { file_uri: 'https://www.youtube.com/watch?v=abcdefghijk' } })
  })

  it('is YouTube only and needs a key', async () => {
    expect(await watchStep('https://www.instagram.com/reel/C1/', { GEMINI_API_KEY: 'k' })).toEqual({ ok: false, reason: 'not_youtube' })
    expect(await watchStep(SHORT, {})).toEqual({ ok: false, reason: 'not_configured' })
  })
})

describe('typed step', () => {
  it('reads a typed list without a key', async () => {
    const out = await typedStep('squats 3x10\nlunges 12 each leg\nwall sit 45 sec', {})
    expect(out.ok && out.workout).toMatchObject({ source: 'typed', exercises: [{ name: 'Squats' }, { name: 'Lunges', notes: 'each leg' }, { name: 'Wall sit', duration_seconds: 45 }] })
  })
})

describe('HTTP routes', () => {
  let server: Server | null = null
  afterEach(() => server?.close())

  async function start(rateLimit = { max: 30, windowMs: 60_000 }) {
    const api = createLinkApi({}, { rateLimit })
    server = createServer((req, res) => api(req, res, () => res.writeHead(404).end()))
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
  }

  it('answers POSTs, passes other paths on, and limits each visitor', async () => {
    const base = await start({ max: 2, windowMs: 60_000 })
    const typed = () => fetch(`${base}/api/link/typed`, { method: 'POST', body: JSON.stringify({ text: 'squats 3x10' }) })
    expect(((await (await typed()).json()) as { ok: boolean }).ok).toBe(true)
    expect((await fetch(`${base}/somewhere-else`)).status).toBe(404)
    expect((await typed()).status).toBe(200)
    const limited = await typed()
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ ok: false, reason: 'too_many_requests' })
  })

  it('rejects bad JSON', async () => {
    const base = await start()
    const res = await fetch(`${base}/api/link/read`, { method: 'POST', body: '{nope' })
    expect(res.status).toBe(400)
  })
})
