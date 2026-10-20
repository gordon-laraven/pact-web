import { describe, expect, it } from 'vitest'
import type { Exercise, Workout } from '../types'
import {
  buildTimeline,
  getSegmentFills,
  getStateAt,
  nextExerciseTime,
  prevExerciseTime,
  PREVIEW_SLOWDOWN,
  type Timeline,
} from './timeline'

const loopSecFor = (id: string) => ({ squatAnim: 2, holdAnim: 1, pushAnim: 3 })[id] ?? 1

const squat: Exercise = {
  id: 'squat',
  name: 'Squat',
  type: 'rep_based',
  animationId: 'squatAnim',
  sets: [
    { reps: 10, restAfterSec: 15 },
    { reps: 8, restAfterSec: 20 },
  ],
}
const plank: Exercise = {
  id: 'plank',
  name: 'Plank',
  type: 'time_based',
  animationId: 'holdAnim',
  sets: [{ holdSec: 30, restAfterSec: 15 }],
}
const pushup: Exercise = {
  id: 'pushup',
  name: 'Push-up',
  type: 'rep_based',
  animationId: 'pushAnim',
  tempoSec: 2.5,
  sets: [{ reps: 4, restAfterSec: 10 }],
}

const workout = (exercises: Exercise[]): Workout => ({ id: 'w', title: 'Test', exercises })
const build = (exercises: Exercise[], prepSec = 5): Timeline =>
  buildTimeline(workout(exercises), { loopSecFor, prepSec })

describe('buildTimeline', () => {
  it('orders phases prep -> work -> rest -> work ... and skips the final rest', () => {
    const tl = build([squat, plank])
    expect(tl.phases.map((p) => `${p.kind}:${p.exerciseIndex}:${p.setIndex}`)).toEqual([
      'prep:0:0',
      'work:0:0',
      'rest:0:0',
      'work:0:1',
      'rest:0:1',
      'work:1:0',
    ])
  })

  it('uses reps x tempo for rep-based work and holdSec for time-based work', () => {
    const tl = build([squat, plank])
    const d = tl.phases.map((p) => p.duration)
    expect(d).toEqual([5, 20, 15, 16, 20, 30])
    expect(tl.duration).toBe(106)
  })

  it('prefers exercise tempoSec over the animation default', () => {
    const tl = build([pushup])
    const work = tl.phases.find((p) => p.kind === 'work')!
    expect(work.loopSec).toBe(2.5)
    expect(work.duration).toBe(10)
  })

  it('makes phases contiguous with start/end/index', () => {
    const tl = build([squat, plank, pushup])
    tl.phases.forEach((p, i) => {
      expect(p.index).toBe(i)
      expect(p.end).toBeCloseTo(p.start + p.duration)
      if (i > 0) expect(p.start).toBeCloseTo(tl.phases[i - 1].end)
    })
    expect(tl.phases.at(-1)!.end).toBeCloseTo(tl.duration)
  })

  it('records the start of each exercise', () => {
    const tl = build([squat, plank, pushup])
    expect(tl.exerciseStarts).toEqual([5, 76, 121])
  })

  it('handles a single exercise with a single set (no rest at all)', () => {
    const tl = build([{ ...plank, sets: [{ holdSec: 30, restAfterSec: 15 }] }])
    expect(tl.phases.map((p) => p.kind)).toEqual(['prep', 'work'])
    expect(tl.duration).toBe(35)
  })

  it('drops zero-length rests and supports disabling prep', () => {
    const ex = { ...squat, sets: [{ reps: 2, restAfterSec: 0 }, { reps: 2, restAfterSec: 0 }] }
    const tl = build([ex, plank], 0)
    expect(tl.phases.map((p) => p.kind)).toEqual(['work', 'work', 'work'])
  })

  it('rejects malformed sets', () => {
    expect(() => build([{ ...squat, sets: [{ restAfterSec: 10 }] }])).toThrow(/reps/)
    expect(() => build([{ ...plank, sets: [{ reps: 3, restAfterSec: 10 }] }])).toThrow(/holdSec/)
    expect(() => build([{ ...squat, sets: [] }])).toThrow(/no sets/)
  })

  it('handles an empty workout', () => {
    const tl = build([])
    expect(tl.phases).toEqual([])
    expect(getStateAt(tl, 0).finished).toBe(true)
  })
})

describe('getStateAt', () => {
  const tl = build([squat, plank]) // prep 0-5, work 5-25, rest 25-40, work 40-56, rest 56-76, plank 76-106

  it('starts in prep with a countdown and previews the first exercise', () => {
    const s = getStateAt(tl, 0)
    expect(s.phase!.kind).toBe('prep')
    expect(s.phaseRemaining).toBe(5)
    expect(s.nextUp!.exercise.id).toBe('squat')
    expect(s.figure).toMatchObject({ animationId: 'squatAnim', mode: 'preview' })
    expect(s.repsDone).toBeNull()
  })

  it('treats phase boundaries as half-open [start, end)', () => {
    expect(getStateAt(tl, 4.999).phase!.kind).toBe('prep')
    expect(getStateAt(tl, 5).phase!.kind).toBe('work')
    expect(getStateAt(tl, 25).phase!.kind).toBe('rest')
  })

  it('derives the rep count from elapsed time and tempo', () => {
    expect(getStateAt(tl, 5).repsDone).toBe(0)
    expect(getStateAt(tl, 6.99).repsDone).toBe(0)
    expect(getStateAt(tl, 7).repsDone).toBe(1)
    expect(getStateAt(tl, 5 + 2 * 7 + 0.5).repsDone).toBe(7)
    expect(getStateAt(tl, 24.999).repsDone).toBe(9)
    expect(getStateAt(tl, 5).targetReps).toBe(10)
  })

  it('increments the rep counter exactly when the animation loop wraps', () => {
    for (let k = 1; k < 10; k++) {
      const before = getStateAt(tl, 5 + k * 2 - 1e-4)
      const at = getStateAt(tl, 5 + k * 2)
      expect(before.repsDone).toBe(k - 1)
      expect(before.figure!.t).toBeGreaterThan(0.99)
      expect(at.repsDone).toBe(k)
      expect(at.figure!.t).toBeCloseTo(0, 6)
    }
  })

  it('animation phase is the fraction of the current rep', () => {
    const s = getStateAt(tl, 5 + 2 * 3 + 1) // halfway through rep 4
    expect(s.figure).toMatchObject({ animationId: 'squatAnim', mode: 'live' })
    expect(s.figure!.t).toBeCloseTo(0.5)
  })

  it('reports set numbers and totals', () => {
    expect(getStateAt(tl, 10)).toMatchObject({ setNumber: 1, totalSets: 2 })
    expect(getStateAt(tl, 45)).toMatchObject({ setNumber: 2, totalSets: 2, targetReps: 8 })
  })

  it('handles rest: countdown, next-up and slowed preview of the next move', () => {
    const s = getStateAt(tl, 30)
    expect(s.phase!.kind).toBe('rest')
    expect(s.phaseRemaining).toBe(10)
    expect(s.nextUp).toMatchObject({ exerciseIndex: 0, setNumber: 2, totalSets: 2 })
    expect(s.figure!.mode).toBe('preview')
    expect(s.figure!.t).toBeCloseTo(((30 - 25) / (2 * PREVIEW_SLOWDOWN)) % 1)

    const between = getStateAt(tl, 60)
    expect(between.nextUp!.exercise.id).toBe('plank')
    expect(between.figure!.animationId).toBe('holdAnim')
  })

  it('time-based work has no rep counter and loops at the animation tempo', () => {
    const s = getStateAt(tl, 76 + 12.25)
    expect(s.phase!.kind).toBe('work')
    expect(s.repsDone).toBeNull()
    expect(s.phaseRemaining).toBeCloseTo(17.75)
    expect(s.figure!.t).toBeCloseTo(0.25)
  })

  it('has no next-up during the last work phase', () => {
    expect(getStateAt(tl, 100).nextUp).toBeNull()
  })

  it('reports overall progress', () => {
    expect(getStateAt(tl, 0).progress).toBe(0)
    expect(getStateAt(tl, 53).progress).toBeCloseTo(0.5)
  })

  it('is finished at and after the end, and clamps before the start', () => {
    expect(getStateAt(tl, 106)).toMatchObject({ finished: true, progress: 1, phase: null })
    expect(getStateAt(tl, 500).finished).toBe(true)
    expect(getStateAt(tl, -3)).toMatchObject({ elapsed: 0, finished: false })
  })

  it('is a pure function of elapsed time (seek anywhere, any order)', () => {
    const a = getStateAt(tl, 47.3)
    getStateAt(tl, 99)
    getStateAt(tl, 1)
    expect(getStateAt(tl, 47.3)).toEqual(a)
  })
})

describe('segments and seeking', () => {
  const tl = build([squat, plank, pushup]) // starts [5, 76, 121], duration 131

  it('fills segments: done, live current, empty upcoming; prep fills nothing', () => {
    expect(getSegmentFills(tl, 2)).toEqual([0, 0, 0])
    const f = getSegmentFills(tl, 76 + 22.5)
    expect(f[0]).toBe(1)
    expect(f[1]).toBeCloseTo(0.5)
    expect(f[2]).toBe(0)
    expect(getSegmentFills(tl, tl.duration)).toEqual([1, 1, 1])
  })

  it('next goes to the next exercise start, then to the end', () => {
    expect(nextExerciseTime(tl, 0)).toBe(5)
    expect(nextExerciseTime(tl, 5)).toBe(76)
    expect(nextExerciseTime(tl, 60)).toBe(76)
    expect(nextExerciseTime(tl, 125)).toBe(tl.duration)
  })

  it('previous restarts the current exercise, or goes back one within the grace period', () => {
    expect(prevExerciseTime(tl, 90)).toBe(76)
    expect(prevExerciseTime(tl, 77)).toBe(5)
    expect(prevExerciseTime(tl, 60)).toBe(5) // in the rest after squat
    expect(prevExerciseTime(tl, 6)).toBe(0) // back to get-ready
    expect(prevExerciseTime(tl, 3)).toBe(0)
  })
})
