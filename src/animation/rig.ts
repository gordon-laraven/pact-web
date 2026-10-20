import type { Animation, Pose } from '../types'

// Authoring helpers for hand-made animations. They only *produce* plain Pose
// keyframes; the player never sees any of this. Building poses from bone
// lengths and simple 2-bone IK keeps limbs a constant length and keeps planted
// hands and feet exactly still, which is what makes the moves read as real.

export type Vec = { x: number; y: number }

/** Body proportions in normalized units (standing height is about 0.79). */
export const BODY = {
  headR: 0.05, // head circle radius (used by the renderer)
  neck: 0.072, // neck joint -> head centre
  spine: 0.25, // hip -> neck
  shoulderDrop: 0.02, // shoulders sit slightly below the neck joint
  upperArm: 0.15,
  forearm: 0.125,
  thigh: 0.21,
  shin: 0.2,
  shoulderHalf: 0.075, // front view: half shoulder width
  hipHalf: 0.048, // front view: half hip width
}

/** y of the floor for planted joints. */
export const FLOOR = 0.9

export const v = (x: number, y: number): Vec => ({ x, y })
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k })
export const lerp = (a: number, b: number, s: number) => a + (b - a) * s
export const lerpV = (a: Vec, b: Vec, s: number): Vec => ({ x: lerp(a.x, b.x, s), y: lerp(a.y, b.y, s) })
export const len = (a: Vec) => Math.hypot(a.x, a.y)
const rad = (deg: number) => (deg * Math.PI) / 180

/** Unit vector at `deg` degrees, screen coordinates (0 = right, 90 = down). */
export const dir = (deg: number): Vec => ({ x: Math.cos(rad(deg)), y: Math.sin(rad(deg)) })

/** Point `length` away from `from` at `deg`. */
export const along = (from: Vec, deg: number, length: number): Vec => add(from, scale(dir(deg), length))

/**
 * Two-bone IK: the middle joint (knee/elbow) for a chain root -> end with bone
 * lengths l1, l2. Of the two solutions, picks the one nearer `hint`. If `end`
 * is out of reach the chain is straightened toward it.
 */
export function ik(root: Vec, end: Vec, l1: number, l2: number, hint: Vec): Vec {
  const delta = sub(end, root)
  const dist = Math.max(1e-9, len(delta))
  const d = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6)
  const u = scale(delta, 1 / dist)
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a))
  const base = add(root, scale(u, a))
  const perp = v(-u.y, u.x)
  const j1 = add(base, scale(perp, h))
  const j2 = add(base, scale(perp, -h))
  return len(sub(j1, hint)) <= len(sub(j2, hint)) ? j1 : j2
}

/** 0 -> 1 -> 0 over one loop, eased (cosine). Peak at t = 0.5. */
export const wave = (t: number) => (1 - Math.cos(2 * Math.PI * t)) / 2

/** Sample a motion function into `frames` evenly spaced keyframes (t = 0..1 inclusive). */
export function sampleLoop(frames: number, fn: (t: number) => Pose): Animation['loop'] {
  const loop: Animation['loop'] = []
  for (let i = 0; i <= frames; i++) {
    const t = i / frames
    loop.push({ t, pose: fn(t === 1 ? 0 : t) })
  }
  return loop
}

type Limb = { shoulder: Vec; elbow: Vec; wrist: Vec; hip: Vec; knee: Vec; ankle: Vec }

/**
 * Side view helper: the figure faces right; its left side is nearest the
 * viewer (drawn bright), the right side is the far side (drawn dimmed).
 */
export function sidePose(head: Vec, neck: Vec, near: Limb, far: Limb = near): Pose {
  return {
    head,
    neck,
    lShoulder: near.shoulder,
    lElbow: near.elbow,
    lWrist: near.wrist,
    lHip: near.hip,
    lKnee: near.knee,
    lAnkle: near.ankle,
    rShoulder: far.shoulder,
    rElbow: far.elbow,
    rWrist: far.wrist,
    rHip: far.hip,
    rKnee: far.knee,
    rAnkle: far.ankle,
  }
}
