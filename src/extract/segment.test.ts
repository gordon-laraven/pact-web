import { describe, expect, it } from 'vitest'
import { samplePose } from '../animation/interpolate'
import { animations, getAnimation } from '../animation/library'
import type { Pose } from '../types'
import { JOINTS } from '../types'
import { ExtractError } from './extract'
import { extractMovements, type Movement } from './segment'
import { emptyPart, spliceClips } from './testClips'

const A = (id: string) => getAnimation(id)
const stand = samplePose(A('squat'), 0)
const pushTop = samplePose(A('push-up'), 0)
const lerpPose = (a: Pose, b: Pose, u: number) =>
  Object.fromEntries(JOINTS.map((j) => [j, { x: a[j].x + (b[j].x - a[j].x) * u, y: a[j].y + (b[j].y - a[j].y) * u }])) as Pose
const standStill = (seconds: number) => ({ anim: A('squat'), seconds, opts: { poseAt: () => stand } })

/** "view kind sets" per movement, for readable assertions. */
const shape = (ms: Movement[]) => ms.map((m) => `${m.result.view} ${m.result.kind} x${m.sets.length}`)
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol

describe('extractMovements', () => {
  // Squat, rest, squat, get down, push-ups, cut straight to jacks (new framing),
  // title card, plank, squats again, mountain climbers.
  const video = spliceClips([
    { anim: A('squat'), seconds: 10, opts: { secPerRep: 2.2 } }, // 0-10
    standStill(4), // 10-14 rest
    { anim: A('squat'), seconds: 10, opts: { secPerRep: 2.2 } }, // 14-24
    { anim: A('push-up'), seconds: 1.5, opts: { poseAt: (t) => lerpPose(stand, pushTop, t / 1.5) } }, // 24-25.5
    { anim: A('push-up'), seconds: 12 }, // 25.5-37.5
    { anim: A('jumping-jacks'), seconds: 9, opts: { scale: 0.5, offsetX: 0.12, offsetY: 0.3 } }, // 37.5-46.5
    emptyPart(2), // 46.5-48.5 title card
    { anim: A('plank'), seconds: 10 }, // 48.5-58.5
    { anim: A('squat'), seconds: 8, opts: { secPerRep: 2.2 } }, // 58.5-66.5
    { anim: A('mountain-climbers'), seconds: 8, opts: { secPerRep: 1 } }, // 66.5-74.5
  ])
  const ms = extractMovements(video, 'v')

  it('returns one entry per distinct movement, in video order', () => {
    expect(shape(ms)).toEqual([
      'side reps x2', // squat: two sets around the rest
      'side reps x1', // push-up
      'front reps x1', // jumping jacks (back-to-back with push-ups, no break)
      'side hold x1', // plank
      'side reps x1', // squat again: separate entry, other moves came between
      'side reps x1', // mountain climbers
    ])
  })

  it('puts start/end timestamps close to where each movement really is', () => {
    const truth = [
      [0, 24],
      [25.5, 37.5],
      [37.5, 46.5],
      [48.5, 58.5],
      [58.5, 66.5],
      [66.5, 74.5],
    ]
    ms.forEach((m, i) => {
      expect(near(m.start, truth[i][0], 1)).toBe(true)
      expect(near(m.end, truth[i][1], 1.6)).toBe(true) // a transition can attach to the end
    })
    expect(near(ms[0].sets[0].end, 10)).toBe(true)
    expect(near(ms[0].sets[1].start, 14)).toBe(true)
  })

  it('counts reps per set and keeps each movement’s tempo', () => {
    expect(ms[0].sets.map((s) => s.reps)).toEqual([4, 4]) // full reps inside 10 s at 2.2 s each
    const within5pct = (got: number, want: number) => expect(Math.abs(got - want) / want).toBeLessThan(0.05)
    within5pct(ms[0].result.secPerRep, 2.2)
    within5pct(ms[1].result.secPerRep, 2.4)
    within5pct(ms[2].result.secPerRep, 1.1)
    expect(ms[3].sets[0].reps).toBe(0) // a hold has a duration, not reps
  })

  it('gives every movement its own animation id', () => {
    const ids = ms.map((m) => m.result.animation.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(Object.keys(animations))('leaves a single-movement video (%s) as one entry', (id) => {
    const anim = A(id)
    const out = extractMovements(spliceClips([{ anim, seconds: 30, opts: { secPerRep: anim.defaultTempoSec } }]), 's')
    expect(out).toHaveLength(1)
    expect(out[0].sets).toHaveLength(1)
    expect(out[0].start).toBeLessThan(1)
    expect(out[0].end).toBeGreaterThan(29)
  })

  it('does not split a long, slow continuous set', () => {
    const out = extractMovements(spliceClips([{ anim: A('glute-bridge'), seconds: 45, opts: { secPerRep: 3 } }]), 's')
    expect(shape(out)).toEqual(['side reps x1'])
  })

  it('finds a very short movement between two others', () => {
    const out = extractMovements(
      spliceClips([
        { anim: A('squat'), seconds: 9, opts: { secPerRep: 2.2 } },
        { anim: A('jumping-jacks'), seconds: 3.5 },
        { anim: A('push-up'), seconds: 10 },
      ]),
      's',
    )
    expect(shape(out)).toEqual(['side reps x1', 'front reps x1', 'side reps x1'])
    expect(near(out[1].start, 9) && near(out[1].end, 12.5)).toBe(true)
  })

  it('treats leaving the frame between sets of the same move as a new set', () => {
    const out = extractMovements(
      spliceClips([
        { anim: A('push-up'), seconds: 10 },
        emptyPart(3),
        { anim: A('push-up'), seconds: 10 },
      ]),
      's',
    )
    expect(shape(out)).toEqual(['side reps x2'])
  })

  it('explains, without crashing, when there is no clear movement', () => {
    const still = spliceClips([standStill(12)])
    expect(() => extractMovements(still, 's')).toThrow(ExtractError)
    expect(() => extractMovements(still, 's')).toThrow(/clear exercise/)
    const nobody = spliceClips([emptyPart(10)])
    expect(() => extractMovements(nobody, 's')).toThrow(ExtractError)
  })
})
