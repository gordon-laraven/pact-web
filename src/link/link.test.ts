import { describe, expect, it } from 'vitest'
import { detectPlatform, extractTyped, runLinkPipeline } from './client'
import { parseExerciseList } from './localParse'
import { normalizeWorkout } from './normalize'
import { guessFigure, rowsFrom, toWorkout } from './toWorkout'
import type { LinkWorkout } from './types'

const workout: LinkWorkout = {
  title: 'Leg day',
  source: 'caption',
  confidence: 'high',
  exercises: [
    { name: 'Squat', sets: 3, reps: 12, duration_seconds: null, rest_seconds: 20, notes: null },
    { name: 'Wall sit', sets: null, reps: null, duration_seconds: 45, rest_seconds: null, notes: 'back flat' },
  ],
}

describe('parseExerciseList', () => {
  it('reads common caption formats', () => {
    const caption = `Full body, no gear 🔥
3 rounds:
1. Squats x 15
2️⃣ Push-ups – 10 reps
• Reverse lunges 12 each leg
- Plank 45s
Follow for more! #fitness`
    const w = parseExerciseList(caption, 'caption')!
    expect(w.exercises.map((e) => [e.name, e.sets, e.reps, e.duration_seconds, e.notes])).toEqual([
      ['Squats', 3, 15, null, null],
      ['Push-ups', 3, 10, null, null],
      ['Reverse lunges', 3, 12, null, 'each leg'],
      ['Plank', 3, null, 45, null],
    ])
    expect(w.confidence).toBe('medium')
  })

  it('reads "3x12", "12 push-ups" and comma lists', () => {
    expect(parseExerciseList('Goblet squat 4x8, 12 push-ups, plank 1 min', 'typed')!.exercises).toMatchObject([
      { name: 'Goblet squat', sets: 4, reps: 8 },
      { name: 'Push-ups', reps: 12 },
      { name: 'Plank', duration_seconds: 60 },
    ])
  })

  it('finds nothing in a caption with no exercises', () => {
    expect(parseExerciseList('10 min burn 🔥 save this for later! #homeworkout', 'caption')).toBeNull()
  })

  it('trusts short typed names even without numbers, and calls them low confidence', () => {
    const w = parseExerciseList('squats\nlunges\nglute bridge', 'typed')!
    expect(w.exercises.map((e) => e.name)).toEqual(['Squats', 'Lunges', 'Glute bridge'])
    expect(w.confidence).toBe('low')
  })
})

describe('normalizeWorkout', () => {
  it('keeps numbers in range and drops nameless rows', () => {
    const w = normalizeWorkout({ title: '  T ', confidence: 'high', exercises: [{ name: '' }, { name: 'Squat', reps: 9999, sets: '3' }] }, 'video-model')!
    expect(w).toMatchObject({ title: 'T', source: 'video-model', exercises: [{ name: 'Squat', reps: null, sets: 3 }] })
    expect(w.confidence).toBe('low') // nothing has reps or time
  })
  it('an empty list is not usable', () => {
    expect(normalizeWorkout({ title: 'x', exercises: [] }, 'caption')).toBeNull()
    expect(normalizeWorkout('nope', 'caption')).toBeNull()
  })
})

describe('toWorkout', () => {
  it('builds the same Workout shape the player already plays', () => {
    const rows = rowsFrom(workout)
    const w = toWorkout('Leg day', rows, {
      platform: 'youtube',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      post: { title: 'Leg day', author: 'Coach A', authorUrl: null },
      source: 'caption',
      confidence: 'high',
    })
    expect(w.creator).toEqual({ name: 'Coach A', attributionUrl: 'https://www.youtube.com/watch?v=abcdefghijk' })
    expect(w.source).toEqual({ platform: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk' })
    expect(w.exercises[0]).toMatchObject({ name: 'Squat', type: 'rep_based', animationId: 'squat' })
    expect(w.exercises[0].sets).toEqual([1, 2, 3].map(() => ({ reps: 12, restAfterSec: 20 })))
    expect(w.exercises[1]).toMatchObject({ type: 'time_based', notes: 'back flat', sets: [{ holdSec: 45, restAfterSec: 0 }] })
  })

  it('picks the closest stick-figure move', () => {
    expect(guessFigure('Bulgarian split squat', false)).toBe('squat')
    expect(guessFigure('Hip thrust', false)).toBe('glute-bridge')
    expect(guessFigure('Bicycle crunch', false)).toBe('glute-bridge')
    expect(guessFigure('High knees', true)).toBe('mountain-climbers')
    expect(guessFigure('Burpees', false)).toBe('jumping-jacks')
    expect(guessFigure('Lateral raise', false)).toBe('squat')
  })
})

describe('runLinkPipeline', () => {
  const respond = (routes: Record<string, unknown>) => {
    const asked: string[] = []
    const impl = (async (url: string) => {
      asked.push(url)
      if (!(url in routes)) return new Response('', { status: 404 })
      return new Response(JSON.stringify(routes[url]), { headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    return { impl, asked }
  }

  it('stops after the caption when it gives a list', async () => {
    const { impl, asked } = respond({ '/api/link/read': { ok: true, platform: 'youtube', url: 'u', post: null, workout } })
    const steps: string[] = []
    const r = await runLinkPipeline('u', { fetchImpl: impl, onStep: (s) => steps.push(s) })
    expect(r.kind).toBe('ok')
    expect(steps).toEqual(['reading'])
    expect(asked).toEqual(['/api/link/read'])
  })

  it('watches the YouTube video when the caption has no list', async () => {
    const { impl } = respond({
      '/api/link/read': { ok: false, platform: 'youtube', url: 'u', post: null, reason: 'no_exercises', canWatch: true },
      '/api/link/watch': { ok: true, workout: { ...workout, source: 'video-model' } },
    })
    const steps: string[] = []
    const r = await runLinkPipeline('u', { fetchImpl: impl, onStep: (s) => steps.push(s) })
    expect(steps).toEqual(['reading', 'watching'])
    expect(r.kind === 'ok' && r.workout.source).toBe('video-model')
  })

  it('falls back when nothing works, and when the API is missing', async () => {
    const { impl } = respond({ '/api/link/read': { ok: false, platform: 'instagram', url: 'u', post: null, reason: 'no_text', canWatch: false } })
    expect(await runLinkPipeline('u', { fetchImpl: impl })).toMatchObject({ kind: 'fallback', reason: 'no_text', platform: 'instagram' })
    expect(await runLinkPipeline('u', { fetchImpl: respond({}).impl })).toMatchObject({ kind: 'fallback', reason: 'not_configured' })
  })

  it('typed lists still work when the server is missing', async () => {
    const r = await extractTyped('squats 3x10', respond({}).impl)
    expect(r.ok && r.workout.exercises[0]).toMatchObject({ name: 'Squats', sets: 3, reps: 10 })
  })

  it('detects platforms for the chip', () => {
    expect(detectPlatform('youtube.com/shorts/x')).toBe('youtube')
    expect(detectPlatform('https://www.instagram.com/reel/x')).toBe('instagram')
    expect(detectPlatform('nope')).toBeNull()
  })
})
