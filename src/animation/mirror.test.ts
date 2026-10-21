import { describe, expect, it } from 'vitest'
import { mirrorAnimation } from './mirror'
import { getAnimation } from './library'

describe('mirrorAnimation', () => {
  it('flips every pose left-to-right and keeps timing', () => {
    const squat = getAnimation('squat')
    const m = mirrorAnimation(squat)
    expect(m.id).toBe('squat-mirrored')
    expect(m.defaultTempoSec).toBe(squat.defaultTempoSec)
    m.loop.forEach((k, i) => {
      expect(k.t).toBe(squat.loop[i].t)
      expect(k.pose.head.x).toBeCloseTo(1 - squat.loop[i].pose.head.x)
      expect(k.pose.lKnee.y).toBe(squat.loop[i].pose.lKnee.y)
    })
    expect(mirrorAnimation(m).loop[3].pose.lWrist.x).toBeCloseTo(squat.loop[3].pose.lWrist.x) // twice = original
  })
})
