import { describe, expect, it } from 'vitest'
import type { Exercise } from '../types'
import { formatClock, prescription, readSpeed } from './format'

const ex = (e: Partial<Exercise>): Exercise => ({
  id: 'x',
  name: 'X',
  type: 'rep_based',
  animationId: 'a',
  sets: [],
  ...e,
})

describe('formatClock', () => {
  it('formats m:ss', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(59.4)).toBe('0:59')
    expect(formatClock(75)).toBe('1:15')
    expect(formatClock(420.2)).toBe('7:00')
    expect(formatClock(-3)).toBe('0:00')
  })
})

describe('prescription', () => {
  it('describes rep and time based exercises', () => {
    expect(prescription(ex({ sets: [{ reps: 10, restAfterSec: 1 }, { reps: 10, restAfterSec: 1 }] }))).toBe('2 × 10')
    expect(prescription(ex({ sets: [{ reps: 10, restAfterSec: 1 }, { reps: 8, restAfterSec: 1 }] }))).toBe('10, 8')
    expect(prescription(ex({ type: 'time_based', sets: [{ holdSec: 40, restAfterSec: 1 }] }))).toBe('40 sec')
    expect(
      prescription(ex({ type: 'time_based', sets: [{ holdSec: 30, restAfterSec: 1 }, { holdSec: 30, restAfterSec: 1 }] })),
    ).toBe('2 × 30 sec')
  })
})

describe('readSpeed', () => {
  it('reads ?speed= in dev only, with sane bounds', () => {
    expect(readSpeed('?speed=4', true)).toBe(4)
    expect(readSpeed('?speed=4', false)).toBe(1)
    expect(readSpeed('', true)).toBe(1)
    expect(readSpeed('?speed=abc', true)).toBe(1)
    expect(readSpeed('?speed=-2', true)).toBe(1)
    expect(readSpeed('?speed=1000', true)).toBe(32)
  })
})
