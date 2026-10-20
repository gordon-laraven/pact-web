import { describe, expect, it } from 'vitest'
import type { Workout } from '../types'
import { buildCues, cuesBetween } from './cues'
import { buildTimeline } from './timeline'

const workout: Workout = {
  id: 'w',
  title: 'Test',
  exercises: [
    {
      id: 'squat',
      name: 'Squat',
      type: 'rep_based',
      animationId: 'a',
      sets: [
        { reps: 5, restAfterSec: 15 },
        { reps: 5, restAfterSec: 15 },
      ],
    },
    { id: 'plank', name: 'Plank', type: 'time_based', animationId: 'a', sets: [{ holdSec: 30, restAfterSec: 10 }] },
    { id: 'jj', name: 'Jacks', type: 'time_based', animationId: 'a', sets: [{ holdSec: 20, restAfterSec: 10 }] },
  ],
}
// prep 0-5, squat 5-15, rest 15-30, squat 30-40, rest 40-55, plank 55-85, rest 85-95, jacks 95-115
const tl = buildTimeline(workout, { loopSecFor: () => 2 })
const cues = buildCues(tl)
const at = (t: number) => cues.filter((c) => Math.abs(c.at - t) < 1e-9)

describe('buildCues', () => {
  it('announces get ready, then 3-2-1 with beeps, then the exercise name with a go beep', () => {
    expect(at(0)).toEqual([{ at: 0, say: 'Get ready' }])
    expect(at(2)).toEqual([{ at: 2, say: '3', beep: 'tick' }])
    expect(at(3)).toEqual([{ at: 3, say: '2', beep: 'tick' }])
    expect(at(4)).toEqual([{ at: 4, say: '1', beep: 'tick' }])
    expect(at(5)).toEqual([{ at: 5, say: 'Squat', beep: 'go' }])
  })

  it('says Rest at the start of rest and only beeps (no name) on later sets', () => {
    expect(at(15)).toEqual([{ at: 15, say: 'Rest' }])
    expect(at(30)).toEqual([{ at: 30, beep: 'go', say: undefined }])
    expect(at(27).map((c) => c.say)).toEqual(['3'])
  })

  it('says Halfway only on long time-based holds', () => {
    expect(cues.filter((c) => c.say === 'Halfway').map((c) => c.at)).toEqual([70])
  })

  it('ends with Done at the very end', () => {
    expect(cues.at(-1)).toEqual({ at: 115, say: 'Done. Workout complete.' })
  })

  it('is sorted by time', () => {
    const times = cues.map((c) => c.at)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('skips countdown numbers that would fall before a short rest begins', () => {
    const w: Workout = {
      ...workout,
      exercises: [{ ...workout.exercises[0], sets: [{ reps: 1, restAfterSec: 2 }, { reps: 1, restAfterSec: 0 }] }],
    }
    const c = buildCues(buildTimeline(w, { loopSecFor: () => 2, prepSec: 0 }))
    // work 0-2, rest 2-4, work 4-6: only "2" (at 2) and "1" (at 3) fit in the rest.
    expect(c.filter((x) => x.beep === 'tick').map((x) => x.say)).toEqual(['2', '1'])
  })
})

describe('cuesBetween', () => {
  it('returns cues in the half-open window (from, to]', () => {
    expect(cuesBetween(cues, 4, 5).map((c) => c.say)).toEqual(['Squat'])
    expect(cuesBetween(cues, 5, 5.5)).toEqual([])
    expect(cuesBetween(cues, -1e-6, 0.016).map((c) => c.say)).toEqual(['Get ready'])
  })

  it('returns nothing when paused (no time passed) or after a backwards seek', () => {
    expect(cuesBetween(cues, 10, 10)).toEqual([])
    expect(cuesBetween(cues, 50, 10)).toEqual([])
  })

  it('drops stale cues after a long gap (tab was hidden)', () => {
    expect(cuesBetween(cues, 0, 14.5)).toEqual([])
    expect(cuesBetween(cues, 0, 15.5).map((c) => c.say)).toEqual(['Rest'])
  })
})
