import { describe, expect, it } from 'vitest'
import { scoreDetections, summarize } from './evaluate'

const truth = [
  { name: 'Squat', start: 0, end: 10 },
  { name: 'Lunge', start: 10, end: 20 },
  { name: 'Plank', start: 20, end: 30, kind: 'hold' as const },
]

describe('scoreDetections', () => {
  it('a perfect match', () => {
    const s = scoreDetections(truth, [{ start: 0.5, end: 10 }, { start: 10, end: 19.5 }, { start: 20, end: 30, kind: 'hold' }])
    expect(summarize(s)).toBe('3/3 found · 0 missed · 0 fragments · 0 extra · 0 false holds · edges ±0.3 s')
  })

  it('counts missed, fragments, extras and false holds', () => {
    const s = scoreDetections(truth, [
      { start: 0, end: 4 },
      { start: 5, end: 10 }, // Squat in two pieces
      { start: 20, end: 30, kind: 'hold' },
      { start: 31, end: 38, kind: 'hold' }, // nothing there
    ])
    expect(s.missed).toEqual(['Lunge'])
    expect(s.fragments).toEqual([{ name: 'Squat', pieces: 2 }])
    expect(s.extra).toHaveLength(1)
    expect(s.falseHolds).toBe(1)
  })

  it('a hold inside a rep movement is a false hold, even when matched', () => {
    const s = scoreDetections(truth, [{ start: 10, end: 20, kind: 'hold' }])
    expect(s.falseHolds).toBe(1)
  })
})
