import { describe, expect, it } from 'vitest'
import { samplePose } from '../animation/interpolate'
import { animations, getAnimation } from '../animation/library'
import type { Pose } from '../types'
import { JOINTS } from '../types'
import { ExtractError } from './extract'
import { extractMovements, extractRange, sidedness, type DebugLog, type Movement } from './segment'
import { calfRaisePose, emptyPart, irregularPhase, kneelPose, lungePose, sitPose, spliceClips } from './testClips'

const A = (id: string) => getAnimation(id)
const stand = samplePose(A('squat'), 0)
const pushTop = samplePose(A('push-up'), 0)
const lerpPose = (a: Pose, b: Pose, u: number) =>
  Object.fromEntries(JOINTS.map((j) => [j, { x: a[j].x + (b[j].x - a[j].x) * u, y: a[j].y + (b[j].y - a[j].y) * u }])) as Pose
const standStill = (seconds: number) => ({ anim: A('squat'), seconds, opts: { poseAt: () => stand } })

/** "view kind sets" per movement, for readable assertions. */
const shape = (ms: Movement[]) => ms.map((m) => `${m.result.view} ${m.kind} x${m.sets.length}`)
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
    // 10 s at 2.2 s per rep: 4 full reps; the first set is cut off mid-rep, so a 5th partial rep may count.
    expect(ms[0].sets[0].reps).toBeGreaterThanOrEqual(4)
    expect(ms[0].sets[0].reps).toBeLessThanOrEqual(5)
    expect(ms[0].sets[1].reps).toBe(4)
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

describe('verification pass (the 5-movement regression case)', () => {
  // Reproduces the three reported failures: a movement missed (calf raises read
  // as standing still), a wrong range (a bridge swallowing time lying on the
  // mat), and an invented hold (kneeling to explain).
  const irregular = irregularPhase(5)
  const lying = samplePose(A('glute-bridge'), 0)
  const video = spliceClips([
    { anim: A('squat'), seconds: 10, opts: { secPerRep: 2.2 } }, // 0-10 squat
    { anim: A('squat'), seconds: 10, opts: { poseAt: (t) => lungePose(t / 2.5) } }, // 10-20 lunge, back-to-back
    { anim: A('squat'), seconds: 6, opts: { poseAt: () => kneelPose() } }, // 20-26 kneel and explain
    { anim: A('push-up'), seconds: 12 }, // 26-38 push-up
    { anim: A('glute-bridge'), seconds: 4, opts: { poseAt: () => lying } }, // 38-42 lie on the mat
    { anim: A('glute-bridge'), seconds: 14, opts: { poseAt: (t) => samplePose(A('glute-bridge'), irregular(t)) } }, // 42-56
    { anim: A('squat'), seconds: 10, opts: { poseAt: (t) => calfRaisePose(t / 1.6) } }, // 56-66 calf raises
  ])
  const truth: [string, number, number][] = [
    ['squat', 0, 10],
    ['lunge', 10, 20],
    ['push-up', 26, 38],
    ['glute bridge', 42, 56],
    ['calf raise', 56, 66],
  ]
  const log: DebugLog = { pieces: [], decisions: [] }
  const ms = extractMovements(video, 'r', { log })

  it('finds all 5 movements and invents no hold', () => {
    expect(ms).toHaveLength(5)
    expect(ms.every((m) => m.kind === 'reps')).toBe(true)
  })

  it('captures each movement’s full range', () => {
    ms.forEach((m, i) => {
      const [name, start, end] = truth[i]
      expect(near(m.start, start, 1.2), `${name} start ${m.start}`).toBe(true)
      expect(near(m.end, end, 1.2), `${name} end ${m.end}`).toBe(true)
    })
  })

  it('rates confidence and flags the one-sided lunge only', () => {
    expect(ms.map((m) => m.confidence).every((c) => c !== 'low')).toBe(true)
    expect(ms.map((m) => m.oneSided)).toEqual([false, true, false, false, false])
  })

  it('re-analyses a hand-edited range without doubling the rep length', () => {
    const m = extractRange(video, 42, 56, 'edited')!
    // Tempo wanders between 1.5 and 3.5 s here; it must not lock onto two reps as one.
    expect(m.result.secPerRep).toBeGreaterThan(1.8)
    expect(m.result.secPerRep).toBeLessThan(3.4)
    expect(m.sets[0].reps).toBeGreaterThanOrEqual(4)
  })

  it('explains every decision in the debug log', () => {
    expect(log.pieces.length).toBeGreaterThan(5)
    expect(log.decisions.some((d) => /rest \(still and kneeling\)/.test(d))).toBe(true)
    expect(log.decisions.filter((d) => /kept as/.test(d))).toHaveLength(5)
  })
})

describe('holds and rests', () => {
  const still = (pose: Pose, seconds: number) => ({ anim: A('squat'), seconds, opts: { poseAt: () => pose } })
  const squats = { anim: A('squat'), seconds: 8, opts: { secPerRep: 2.2 } }

  it.each([
    ['kneeling', kneelPose()],
    ['sitting', sitPose()],
    ['lying on the mat', samplePose(A('glute-bridge'), 0)],
    ['standing', stand],
  ])('does not turn %s still between moves into a hold', (_name, pose) => {
    const out = extractMovements(spliceClips([squats, still(pose, 7), { anim: A('push-up'), seconds: 10 }]), 'h')
    expect(shape(out)).toEqual(['side reps x1', 'side reps x1'])
  })

  it('keeps a real, sustained plank as a confident hold', () => {
    const out = extractMovements(spliceClips([squats, { anim: A('plank'), seconds: 12 }]), 'h')
    expect(shape(out)).toEqual(['side reps x1', 'side hold x1'])
    expect(out[1].confidence).toBe('high')
  })

  it('needs a hold to last: 3 s still in a plank position is not one', () => {
    const out = extractMovements(spliceClips([squats, { anim: A('plank'), seconds: 3 }, { anim: A('push-up'), seconds: 10 }]), 'h')
    expect(out.some((m) => m.kind !== 'reps')).toBe(false)
  })
})

describe('one-sided movements', () => {
  it('flags a lunge but not two-sided moves', () => {
    const lunge = extractMovements(spliceClips([{ anim: A('squat'), seconds: 12, opts: { poseAt: (t) => lungePose(t / 2.5) } }]), 'o')
    expect(lunge[0].oneSided).toBe(true)
    expect(lunge[0].bothSidesShown).toBe(false)
    for (const id of ['squat', 'push-up', 'jumping-jacks', 'mountain-climbers', 'glute-bridge']) {
      expect(sidedness(A(id)).oneSided, id).toBe(false)
    }
  })

  it('notices when the video already shows both sides back to back', () => {
    const out = extractMovements(
      spliceClips([
        { anim: A('squat'), seconds: 12, opts: { poseAt: (t) => lungePose(t / 2.5, 'near') } },
        { anim: A('squat'), seconds: 12, opts: { poseAt: (t) => lungePose(t / 2.5, 'far') } },
      ]),
      'o',
    )
    expect(out).toHaveLength(2)
    expect(out.every((m) => m.oneSided && m.bothSidesShown)).toBe(true)
  })
})

describe('timestamps and manual ranges', () => {
  it('clamps to the real video length and never overlaps', () => {
    const clip = spliceClips([
      { anim: A('squat'), seconds: 10, opts: { secPerRep: 2.2 } },
      { anim: A('push-up'), seconds: 10 },
    ])
    const out = extractMovements(clip, 't', { videoDuration: 18 })
    expect(out.at(-1)!.end).toBeLessThanOrEqual(18)
    out.forEach((m, i) => {
      expect(m.start).toBeLessThanOrEqual(m.end)
      if (i > 0) expect(m.start).toBeGreaterThanOrEqual(out[i - 1].end)
    })
  })

  it('extracts a movement from a range chosen by hand', () => {
    const clip = spliceClips([
      { anim: A('squat'), seconds: 10, opts: { secPerRep: 2.2 } },
      { anim: A('push-up'), seconds: 12 },
    ])
    const m = extractRange(clip, 10, 22, 'manual')!
    expect(m.result.view).toBe('side')
    expect(m.result.secPerRep).toBeCloseTo(2.4, 0)
    expect(extractRange(spliceClips([emptyPart(5)]), 0, 5, 'none')).toBeNull()
  })
})
