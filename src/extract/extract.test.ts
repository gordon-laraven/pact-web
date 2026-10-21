import { describe, expect, it } from 'vitest'
import { getAnimation } from '../animation/library'
import type { Joint, Pose } from '../types'
import { JOINTS } from '../types'
import { extractAnimation, ExtractError, landmarksToSample, type Landmark, type TrackedClip } from './extract'
import { fakeClip } from './testClips'

const hipY = (p: Pose) => (p.lHip.y + p.rHip.y) / 2
const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs)
const bone = (p: Pose, a: Joint, b: Joint) => Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y)

describe('extractAnimation', () => {
  it('recovers a squat: side view, rep tempo, rep count and range of motion', () => {
    const squat = getAnimation('squat')
    const r = extractAnimation(fakeClip(squat, { secPerRep: 2, seconds: 12 }), 'clip-1')
    expect(r.kind).toBe('reps')
    expect(r.view).toBe('side')
    expect(r.secPerRep).toBeGreaterThan(1.9)
    expect(r.secPerRep).toBeLessThan(2.1)
    expect(r.repsFound).toBeGreaterThanOrEqual(4)
    expect(r.confidence).toBeGreaterThan(0.6)
    expect(r.animation.defaultTempoSec).toBeCloseTo(r.secPerRep)

    // Same depth of squat as the source (both use the same body proportions).
    const src = squat.loop.map((k) => hipY(k.pose))
    const out = r.animation.loop.map((k) => hipY(k.pose))
    expect(range(out)).toBeGreaterThan(range(src) * 0.8)
    expect(range(out)).toBeLessThan(range(src) * 1.2)

    // The loop starts where the clip starts: standing (hips at their highest).
    expect(out[0]).toBeLessThan(Math.min(...out) + range(out) * 0.15)
  })

  it('produces a valid, closed loop in the 0..1 frame', () => {
    const r = extractAnimation(fakeClip(getAnimation('push-up')), 'clip-2')
    const loop = r.animation.loop
    expect(loop[0].t).toBe(0)
    expect(loop.at(-1)!.t).toBe(1)
    expect(loop.at(-1)!.pose).toEqual(loop[0].pose)
    for (const { pose } of loop) {
      for (const j of JOINTS) {
        expect(pose[j].x).toBeGreaterThanOrEqual(0)
        expect(pose[j].x).toBeLessThanOrEqual(1)
        expect(pose[j].y).toBeGreaterThanOrEqual(0)
        expect(pose[j].y).toBeLessThanOrEqual(0.9 + 1e-9)
      }
    }
    // Lowest joint sits on the floor line.
    const lowest = Math.max(...loop.flatMap(({ pose }) => JOINTS.filter((j) => j !== 'head').map((j) => pose[j].y)))
    expect(lowest).toBeCloseTo(0.9)
    // Averaging reps keeps limb lengths steady.
    const lens = loop.map(({ pose }) => bone(pose, 'lKnee', 'lAnkle'))
    expect(range(lens)).toBeLessThan(Math.max(...lens) * 0.1)
  })

  it('detects a front view (jumping jacks)', () => {
    const r = extractAnimation(fakeClip(getAnimation('jumping-jacks'), { secPerRep: 1.1 }), 'clip-3')
    expect(r.view).toBe('front')
    expect(r.kind).toBe('reps')
    expect(r.secPerRep).toBeCloseTo(1.1, 1)
  })

  it('turns a mirrored clip around to face right', () => {
    const r = extractAnimation(fakeClip(getAnimation('push-up'), { mirror: true }), 'clip-4')
    const p = r.animation.loop[0].pose
    expect(p.head.x).toBeGreaterThan(p.lAnkle.x) // head to the right, like the library
  })

  it('uses the side nearest the camera as the near (bright) side', () => {
    const climbers = getAnimation('mountain-climbers')
    const r = extractAnimation(fakeClip(climbers, { nearSideRight: true, secPerRep: 1 }), 'clip-5')
    // In the source, the near (left) knee is tucked at t = 0.5 of its loop; whichever
    // phase extraction starts at, the near and far legs must still alternate.
    const nearKnee = r.animation.loop.map((k) => k.pose.lKnee.x)
    const farKnee = r.animation.loop.map((k) => k.pose.rKnee.x)
    const corr = nearKnee.reduce((s, v, i) => s + (v - nearKnee[0]) * (farKnee[i] - farKnee[0]), 0)
    expect(corr).toBeLessThan(0)
    expect(r.repsFound).toBeGreaterThanOrEqual(5)
  })

  it('trusts visibility over depth to pick the near side (occluded limbs are guesses)', () => {
    const climbers = getAnimation('mountain-climbers')
    const truth = extractAnimation(fakeClip(climbers, { secPerRep: 1 }), 'a')
    const r = extractAnimation(fakeClip(climbers, { secPerRep: 1, nearSideRight: true, misleadingDepth: true }), 'b')
    // Frame for frame, the near knee follows the same path as in the clean clip
    // (picking the wrong side would put the other, half-a-loop-apart leg there).
    const err = r.animation.loop.map((k, i) =>
      Math.hypot(k.pose.lKnee.x - truth.animation.loop[i].pose.lKnee.x, k.pose.lKnee.y - truth.animation.loop[i].pose.lKnee.y),
    )
    expect(Math.max(...err)).toBeLessThan(0.02)
  })

  it('follows the visible limbs when the tracker switches left/right mid-clip', () => {
    const pushUp = getAnimation('push-up')
    const clean = extractAnimation(fakeClip(pushUp, { farVisibility: 0.3 }), 'a')
    const r = extractAnimation(fakeClip(pushUp, { farVisibility: 0.3, switchLabelsEverySec: 1.3 }), 'b')
    const err = r.animation.loop.map((k, i) =>
      Math.max(
        Math.hypot(k.pose.lWrist.x - clean.animation.loop[i].pose.lWrist.x, k.pose.lWrist.y - clean.animation.loop[i].pose.lWrist.y),
        Math.hypot(k.pose.lElbow.x - clean.animation.loop[i].pose.lElbow.x, k.pose.lElbow.y - clean.animation.loop[i].pose.lElbow.y),
      ),
    )
    expect(Math.max(...err)).toBeLessThan(0.02)
    // The hidden far arm is drawn behind the near one, not where the tracker guessed.
    for (const { pose } of r.animation.loop) {
      expect(Math.hypot(pose.rWrist.x - pose.lWrist.x, pose.rWrist.y - pose.lWrist.y)).toBeLessThan(0.01)
    }
  })

  it('finds the tempo even when the clip starts mid-rep and has lots of dropouts', () => {
    const r = extractAnimation(
      fakeClip(getAnimation('glute-bridge'), { secPerRep: 2.6, phase: 0.37, dropout: 0.25, seed: 3 }),
      'clip-6',
    )
    expect(r.kind).toBe('reps')
    expect(r.secPerRep).toBeGreaterThan(2.45)
    expect(r.secPerRep).toBeLessThan(2.75)
  })

  it('treats a still position as a hold with a subtle breathing loop', () => {
    const r = extractAnimation(fakeClip(getAnimation('plank'), { seconds: 10 }), 'clip-7')
    expect(r.kind).toBe('hold')
    expect(r.repsFound).toBe(0)
    expect(r.view).toBe('side')
    const heads = r.animation.loop.map((k) => k.pose.head.y)
    expect(range(heads)).toBeGreaterThan(0)
    expect(range(heads)).toBeLessThan(0.01)
  })

  it('explains when no person is found', () => {
    const empty: TrackedClip = {
      width: 720,
      height: 1280,
      frames: Array.from({ length: 60 }, (_, i) => ({ t: i / 20, landmarks: null })),
    }
    expect(() => extractAnimation(empty, 'x')).toThrow(ExtractError)
    expect(() => extractAnimation(empty, 'x')).toThrow(/whole body/)
  })
})

describe('landmarksToSample', () => {
  it('needs at least one visible shoulder and one visible hip', () => {
    const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }))
    expect(landmarksToSample(lm, 1)).not.toBeNull()
    lm[23] = { ...lm[23], visibility: 0.2 } // far hip hidden: fine
    expect(landmarksToSample(lm, 1)).not.toBeNull()
    lm[24] = { ...lm[24], visibility: 0.2 } // no hips at all
    expect(landmarksToSample(lm, 1)).toBeNull()
    expect(landmarksToSample(null, 1)).toBeNull()
  })

  it('puts the head at the ears and the neck between the shoulders, in square units', () => {
    const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.9 }))
    lm[7] = { x: 0.4, y: 0.1, z: 0 }
    lm[8] = { x: 0.6, y: 0.1, z: 0 }
    lm[11] = { x: 0.3, y: 0.3, z: 0 }
    lm[12] = { x: 0.7, y: 0.3, z: 0 }
    const s = landmarksToSample(lm, 0.5)!
    expect(s.joints.slice(0, 4)).toEqual([0.25, 0.1, 0.25, 0.3]) // head (x*aspect), neck
  })
})
