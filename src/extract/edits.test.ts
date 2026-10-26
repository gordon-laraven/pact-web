import { describe, expect, it } from 'vitest'
import { getAnimation } from '../animation/library'
import { mergeMovements, splitMovement } from './edits'
import { extractRange } from './segment'
import { spliceClips } from './testClips'

const A = getAnimation
// 0–12 s squats, then 12–24 s push-ups, no break.
const clip = spliceClips([
  { anim: A('squat'), seconds: 12 },
  { anim: A('push-up'), seconds: 12 },
])

describe('split and merge', () => {
  it('splits one range holding two exercises into the two', () => {
    const both = extractRange(clip, 0, 24, 'both')!
    const parts = splitMovement(clip, both, 12, ['a', 'b'])!
    expect(parts.map((p) => [p.start, p.end, p.result.view])).toEqual([
      [0, 12, 'side'],
      [12, 24, 'side'],
    ])
    expect(parts[0].kind).toBe('reps')
    expect(parts[0].sets[0].reps).toBeGreaterThanOrEqual(4)
    expect(parts[1].kind).toBe('reps')
  })

  it("won't leave a part too short to hold a rep", () => {
    const both = extractRange(clip, 0, 24, 'both')!
    expect(splitMovement(clip, both, 1, ['a', 'b'])).toBeNull()
    expect(splitMovement(clip, both, 23.2, ['a', 'b'])).toBeNull()
  })

  it('merges two halves of one exercise back into one, with all its reps', () => {
    const a = extractRange(clip, 0, 6, 'a')!
    const b = extractRange(clip, 6, 12, 'b')!
    const m = mergeMovements(clip, a, b, 'm')!
    expect([m.start, m.end]).toEqual([0, 12])
    expect(m.sets[0].reps).toBeGreaterThan(Math.max(a.sets[0].reps, b.sets[0].reps))
  })
})
