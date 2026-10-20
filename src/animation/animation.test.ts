import { describe, expect, it } from 'vitest'
import { sampleWorkout } from '../data/sampleWorkout'
import { buildTimeline } from '../engine/timeline'
import { JOINTS, type Animation, type Joint, type Pose } from '../types'
import { samplePose } from './interpolate'
import { animations, getAnimation, loopSecFor } from './library'

const still = (x: number, y: number): Pose =>
  Object.fromEntries(JOINTS.map((j) => [j, { x, y }])) as Pose

const twoKey: Animation = {
  id: 'two',
  view: 'side',
  defaultTempoSec: 1,
  loop: [
    { t: 0, pose: still(0, 0) },
    { t: 0.5, pose: still(1, 2) },
    { t: 1, pose: still(0, 0) },
  ],
}

describe('samplePose', () => {
  it('hits keyframes exactly', () => {
    expect(samplePose(twoKey, 0).head).toEqual({ x: 0, y: 0 })
    expect(samplePose(twoKey, 0.5).head).toEqual({ x: 1, y: 2 })
  })

  it('eases in and out between two keyframes (smoothstep)', () => {
    const q = samplePose(twoKey, 0.125).head.x // a quarter of the way through the segment
    expect(q).toBeCloseTo(3 * 0.25 ** 2 - 2 * 0.25 ** 3) // 0.15625, slower than linear 0.25
    expect(samplePose(twoKey, 0.25).head.x).toBeCloseTo(0.5)
  })

  it('wraps t and is continuous across the loop seam', () => {
    expect(samplePose(twoKey, 1.25).head.x).toBeCloseTo(samplePose(twoKey, 0.25).head.x)
    expect(samplePose(twoKey, -0.75).head.x).toBeCloseTo(samplePose(twoKey, 0.25).head.x)
    const a = samplePose(twoKey, 0.9999).head
    const b = samplePose(twoKey, 0).head
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-3)
  })

  it('never overshoots the keyframe range (monotone)', () => {
    const anim: Animation = {
      ...twoKey,
      loop: [
        { t: 0, pose: still(0, 0) },
        { t: 0.2, pose: still(0.9, 0) },
        { t: 0.4, pose: still(1, 0) },
        { t: 0.6, pose: still(1, 0) }, // hold
        { t: 1, pose: still(0, 0) },
      ],
    }
    for (let t = 0; t < 1; t += 0.01) {
      const x = samplePose(anim, t).head.x
      expect(x).toBeGreaterThanOrEqual(-1e-9)
      expect(x).toBeLessThanOrEqual(1 + 1e-9)
    }
    expect(samplePose(anim, 0.5).head.x).toBeCloseTo(1) // hold stays held
  })

  it('handles unsorted keyframes and a single keyframe', () => {
    const unsorted = { ...twoKey, loop: [twoKey.loop[1], twoKey.loop[0]] }
    expect(samplePose(unsorted, 0.5).head).toEqual({ x: 1, y: 2 })
    const single = { ...twoKey, loop: [{ t: 0, pose: still(3, 4) }] }
    expect(samplePose(single, 0.7).head).toEqual({ x: 3, y: 4 })
  })

  it('reuses the output object when given one', () => {
    const out = samplePose(twoKey, 0.1)
    expect(samplePose(twoKey, 0.3, out)).toBe(out)
  })
})

const BONES: [Joint, Joint][] = [
  ['neck', 'head'],
  ['lShoulder', 'lElbow'],
  ['lElbow', 'lWrist'],
  ['rShoulder', 'rElbow'],
  ['rElbow', 'rWrist'],
  ['lHip', 'lKnee'],
  ['lKnee', 'lAnkle'],
  ['rHip', 'rKnee'],
  ['rKnee', 'rAnkle'],
]
const dist = (p: Pose, a: Joint, b: Joint) => Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y)

describe.each(Object.values(animations))('animation "$id"', (anim) => {
  it('has sorted keyframes spanning 0..1 that close the loop', () => {
    const ts = anim.loop.map((k) => k.t)
    expect(ts[0]).toBe(0)
    expect(ts.at(-1)).toBe(1)
    expect([...ts].sort((a, b) => a - b)).toEqual(ts)
    expect(anim.loop[0].pose).toEqual(anim.loop.at(-1)!.pose)
    expect(anim.defaultTempoSec).toBeGreaterThan(0)
  })

  it('keeps every joint inside the normalized 0..1 frame', () => {
    for (const { pose } of anim.loop) {
      for (const j of JOINTS) {
        expect(Number.isFinite(pose[j].x) && Number.isFinite(pose[j].y)).toBe(true)
        expect(pose[j].x).toBeGreaterThanOrEqual(0)
        expect(pose[j].x).toBeLessThanOrEqual(1)
        expect(pose[j].y).toBeGreaterThanOrEqual(0)
        expect(pose[j].y).toBeLessThanOrEqual(1)
      }
    }
  })

  it('keeps limb lengths constant, including between keyframes (within 3%)', () => {
    const ref = anim.loop[0].pose
    for (let t = 0; t < 1; t += 1 / 200) {
      const p = samplePose(anim, t)
      for (const [a, b] of BONES) {
        expect(Math.abs(dist(p, a, b) - dist(ref, a, b))).toBeLessThan(dist(ref, a, b) * 0.03)
      }
    }
  })

  it('moves smoothly at 60fps: no jumps and no sudden changes of speed', () => {
    const frames = Math.round(anim.defaultTempoSec * 60)
    const at = (i: number) => samplePose(anim, i / frames)
    for (let i = 0; i < frames; i++) {
      const [a, b, c] = [at(i - 1), at(i), at(i + 1)]
      for (const j of JOINTS) {
        expect(Math.hypot(c[j].x - b[j].x, c[j].y - b[j].y)).toBeLessThan(0.05)
        // Second difference = acceleration per frame. A pop or kink shows up
        // well above 0.02; the fastest real motion here (a jumping-jack wrist
        // at mid-swing, ~0.0054 centripetal) sits under 0.008.
        expect(Math.hypot(c[j].x - 2 * b[j].x + a[j].x, c[j].y - 2 * b[j].y + a[j].y)).toBeLessThan(0.008)
      }
    }
  })
})

describe('sample workout', () => {
  it('only references animations that exist', () => {
    for (const ex of sampleWorkout.exercises) expect(() => getAnimation(ex.animationId)).not.toThrow()
  })

  it('runs roughly 6 to 7 minutes', () => {
    const tl = buildTimeline(sampleWorkout, { loopSecFor })
    expect(tl.duration).toBeGreaterThan(6 * 60)
    expect(tl.duration).toBeLessThanOrEqual(7 * 60 + 5)
  })
})
