import { describe, expect, it } from 'vitest'
import type { Landmark } from './extract'
import { needsExtraFrame } from './mediapipe'

/** A standing body: shoulders at y 0.3, hips at 0.5 (torso 0.2), then hands/feet moved by `dx`. */
const body = (dx = 0): Landmark[] =>
  Array.from({ length: 33 }, (_, i) => {
    const y = i === 11 || i === 12 ? 0.3 : i === 23 || i === 24 ? 0.5 : 0.6
    const moves = [15, 16, 27, 28].includes(i)
    return { x: 0.5 + (moves ? dx : 0), y, z: 0, visibility: 0.9 }
  })

describe('needsExtraFrame', () => {
  it('adds a frame when hands or feet moved fast (over a third of the torso)', () => {
    expect(needsExtraFrame(body(0), body(0.1))).toBe(true) // 0.5 torso
    expect(needsExtraFrame(body(0), body(0.03))).toBe(false) // 0.15 torso
  })

  it('adds one frame right after the person is lost, not for every empty frame', () => {
    expect(needsExtraFrame(body(), null)).toBe(true)
    expect(needsExtraFrame(null, null)).toBe(false)
    expect(needsExtraFrame(null, body())).toBe(false)
  })
})
