import { samplePose } from '../animation/interpolate'
import { along, BODY, FLOOR, ik, lerp, sidePose, v, wave } from '../animation/rig'
import type { Animation, Joint, Pose } from '../types'
import { JOINTS } from '../types'
import type { Landmark, TrackedClip } from './extract'

// Test-only: fake tracker output for unit tests (never imported by the app).
// Fake tracker output generated from the library's own animations, with the
// kinds of damage real tracking has: noise, dropped frames, an arbitrary
// position/scale in the video, a mirrored camera, the far side facing us.

const MP_INDEX: Partial<Record<Joint, number>> = {
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
}

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

export type ClipOpts = {
  /** Pose source instead of looping the animation (rest, transitions). t is seconds into this clip. */
  poseAt?: (t: number) => Pose
  /** Where the person sits in the frame (changes at a camera cut). */
  scale?: number
  offsetX?: number
  offsetY?: number
  /** Time of the first frame (to splice clips into one video). */
  startTime?: number
  secPerRep?: number
  seconds?: number
  fps?: number
  phase?: number
  noise?: number
  dropout?: number
  mirror?: boolean
  nearSideRight?: boolean
  /** Make depth point the wrong way while visibility tells the truth (real occlusion). */
  misleadingDepth?: boolean
  /** Visibility the tracker gives the hidden (far) limbs. */
  farVisibility?: number
  /** Swap the tracker's left/right labels every N seconds, like real identity switches. */
  switchLabelsEverySec?: number
  seed?: number
}

export function fakeClip(anim: Animation, o: ClipOpts = {}): TrackedClip {
  const { secPerRep = anim.defaultTempoSec, seconds = 12, fps = 20, phase = 0, noise = 0.002, dropout = 0.05 } = o
  const width = 720
  const height = 1280
  const aspect = width / height
  const rand = rng(o.seed ?? 7)
  const gauss = () => (rand() + rand() + rand() - 1.5) * noise * 2
  const { scale = 0.62, offsetX = 0.06, offsetY = 0.2, startTime = 0 } = o
  const toVideo = (p: { x: number; y: number }) => {
    let x = (offsetX + p.x * scale) / aspect
    if (o.mirror) x = 1 - x
    return { x: x + gauss(), y: offsetY + p.y * scale + gauss() }
  }
  const frames: TrackedClip['frames'] = []
  for (let i = 0; i < seconds * fps; i++) {
    const t = i / fps
    if (rand() < dropout) {
      frames.push({ t: startTime + t, landmarks: null })
      continue
    }
    const pose: Pose = o.poseAt ? o.poseAt(t) : samplePose(anim, phase + t / secPerRep)
    const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.1 }))
    const switched = o.switchLabelsEverySec ? Math.floor(t / o.switchLabelsEverySec) % 2 === 1 : false
    const rightNear = !!o.nearSideRight !== switched
    for (const j of JOINTS) {
      const idx = MP_INDEX[j]
      if (idx === undefined) continue
      // swap labels when the camera sees the right side: the near (drawn) limb is tagged "right"
      const label = rightNear ? (j.startsWith('l') ? 'r' + j.slice(1) : 'l' + j.slice(1)) : j
      const isNear = label.startsWith('l') === !rightNear
      // MediaPipe z: smaller = closer to the camera.
      const z = anim.view === 'side' ? (isNear ? -0.1 : 0.1) * (o.misleadingDepth ? -1 : 1) : 0
      const farVis = o.farVisibility ?? (o.misleadingDepth ? 0.55 : 0.95)
      const torso = /Shoulder|Hip/.test(j)
      const hidden = anim.view === 'side' && !isNear && !torso
      const visibility = hidden ? farVis : 0.95
      // A tracker's guess for a mostly hidden limb is often well off.
      const guessed = hidden && farVis < 0.5 ? { x: pose[j].x + 0.08, y: pose[j].y - 0.06 } : pose[j]
      lm[MP_INDEX[label as Joint]!] = { ...toVideo(guessed), z, visibility }
    }
    const head = pose.head
    const fwd = anim.view === 'side' ? 0.03 : 0
    lm[7] = { ...toVideo({ x: head.x - 0.01, y: head.y }), z: 0, visibility: 0.9 }
    lm[8] = { ...toVideo({ x: head.x + 0.01, y: head.y }), z: 0, visibility: 0.9 }
    lm[0] = { ...toVideo({ x: head.x + fwd, y: head.y + 0.012 }), z: 0, visibility: 0.9 }
    frames.push({ t: startTime + t, landmarks: lm })
  }
  return { width, height, frames }
}

/** Splice clips into one video: each part starts where the previous one ended. */
export function spliceClips(parts: { anim: Animation; seconds: number; opts?: ClipOpts }[], fps = 15): TrackedClip {
  const frames: TrackedClip['frames'] = []
  let t = 0
  parts.forEach((p, i) => {
    const clip = fakeClip(p.anim, { fps, seed: 11 + i, ...p.opts, seconds: p.seconds, startTime: t })
    frames.push(...clip.frames)
    t += p.seconds
  })
  return { width: 720, height: 1280, frames }
}

/** A stretch of video with nobody in frame (title card, cut away). */
export function emptyPart(seconds: number, fps = 15): { anim: Animation; seconds: number; opts: ClipOpts } {
  return { anim: EMPTY, seconds, opts: { dropout: 1, fps } }
}
const EMPTY: Animation = { id: 'empty', view: 'front', defaultTempoSec: 1, loop: [] }

// ---------- extra test-only poses (moves the library doesn't have, and non-exercise positions) ----------


/** Side-view forward lunge, front leg = the near (left) leg unless front = 'far'. One loop = one rep. */
export function lungePose(t: number, front: 'near' | 'far' = 'near'): Pose {
  const s = wave(t)
  const hip = v(0.47, lerp(0.53, 0.69, s))
  const fAnkle = v(0.64, FLOOR)
  const bAnkle = v(0.3, FLOOR - 0.01)
  const fKnee = ik(hip, fAnkle, BODY.thigh, BODY.shin, v(hip.x + 1, hip.y))
  const bKnee = ik(hip, bAnkle, BODY.thigh, BODY.shin, v(hip.x, 1.3))
  const neck = along(hip, -90, BODY.spine)
  const head = along(neck, -90, BODY.neck)
  const shoulder = along(neck, 90, BODY.shoulderDrop)
  const elbow = along(shoulder, 95, BODY.upperArm)
  const wrist = along(elbow, 92, BODY.forearm)
  const arm = { shoulder, elbow, wrist, hip }
  const frontLeg = { ...arm, knee: fKnee, ankle: fAnkle }
  const backLeg = { ...arm, knee: bKnee, ankle: bAnkle }
  return front === 'near' ? sidePose(head, neck, frontLeg, backLeg) : sidePose(head, neck, backLeg, frontLeg)
}

/** Kneeling upright, talking to the camera (not an exercise). */
export function kneelPose(): Pose {
  const knee = v(0.5, 0.875)
  const ankle = v(0.3, FLOOR)
  const hip = v(0.5, knee.y - BODY.thigh)
  const neck = along(hip, -88, BODY.spine)
  const shoulder = along(neck, 92, BODY.shoulderDrop)
  const elbow = along(shoulder, 80, BODY.upperArm)
  const wrist = along(elbow, -20, BODY.forearm)
  return sidePose(along(neck, -85, BODY.neck), neck, { shoulder, elbow, wrist, hip, knee, ankle })
}

/** Sitting on the floor, legs out in front (not an exercise). */
export function sitPose(): Pose {
  const hip = v(0.4, 0.86)
  const knee = along(hip, -5, BODY.thigh)
  const ankle = along(knee, 3, BODY.shin)
  const neck = along(hip, -80, BODY.spine)
  const shoulder = along(neck, 100, BODY.shoulderDrop)
  const elbow = along(shoulder, 100, BODY.upperArm)
  const wrist = along(elbow, 95, BODY.forearm)
  return sidePose(along(neck, -80, BODY.neck), neck, { shoulder, elbow, wrist, hip, knee, ankle })
}

/** Reps whose tempo wanders between ~1.5 s and ~3.5 s (no steady rhythm). Returns loop phase at time t. */
export function irregularPhase(seed = 5): (t: number) => number {
  let s = seed
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const tempos = Array.from({ length: 40 }, () => 1.5 + rand() * 2)
  return (t) => {
    let phase = 0
    let left = t
    for (const tempo of tempos) {
      if (left <= tempo) return phase + left / tempo
      left -= tempo
      phase += 1
    }
    return phase
  }
}

/** Standing calf raise (side view): the whole body rises onto the toes and lowers. One loop = one rep. */
export function calfRaisePose(t: number): Pose {
  const stand = lungeFreeStand()
  const lift = 0.035 * wave(t)
  return Object.fromEntries(Object.entries(stand).map(([j, p]) => [j, { x: p.x, y: p.y - lift }])) as Pose
}

function lungeFreeStand(): Pose {
  const ankle = v(0.5, FLOOR)
  const hip = v(0.5, FLOOR - BODY.thigh - BODY.shin + 0.004)
  const knee = ik(hip, ankle, BODY.thigh, BODY.shin, v(1, hip.y + 0.2))
  const neck = along(hip, -90, BODY.spine)
  const shoulder = along(neck, 90, BODY.shoulderDrop)
  const elbow = along(shoulder, 92, BODY.upperArm)
  const wrist = along(elbow, 90, BODY.forearm)
  return sidePose(along(neck, -90, BODY.neck), neck, { shoulder, elbow, wrist, hip, knee, ankle })
}
