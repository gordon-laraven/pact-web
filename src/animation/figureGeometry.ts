import type { Animation, Joint, Pose } from '../types'
import { animationBounds, HEAD_RADIUS } from './library'

// What the renderer draws, as data: bones (rounded lines), joint dots, head.
// In side view the figure's right side is the far side and is drawn dimmed.

export type Layer = 'far' | 'core' | 'near'

/** 'pelvis' is the midpoint of the hips (the spine attaches there). */
type Point = Joint | 'pelvis'

export const BONES: { a: Point; b: Point; layer: Layer }[] = [
  { a: 'rShoulder', b: 'rElbow', layer: 'far' },
  { a: 'rElbow', b: 'rWrist', layer: 'far' },
  { a: 'rHip', b: 'rKnee', layer: 'far' },
  { a: 'rKnee', b: 'rAnkle', layer: 'far' },
  { a: 'neck', b: 'head', layer: 'core' },
  { a: 'neck', b: 'pelvis', layer: 'core' },
  { a: 'lShoulder', b: 'rShoulder', layer: 'core' },
  { a: 'lHip', b: 'rHip', layer: 'core' },
  { a: 'lShoulder', b: 'lElbow', layer: 'near' },
  { a: 'lElbow', b: 'lWrist', layer: 'near' },
  { a: 'lHip', b: 'lKnee', layer: 'near' },
  { a: 'lKnee', b: 'lAnkle', layer: 'near' },
]

export const DOTS: { j: Joint; layer: Layer }[] = [
  { j: 'rElbow', layer: 'far' },
  { j: 'rWrist', layer: 'far' },
  { j: 'rKnee', layer: 'far' },
  { j: 'rAnkle', layer: 'far' },
  { j: 'lElbow', layer: 'near' },
  { j: 'lWrist', layer: 'near' },
  { j: 'lKnee', layer: 'near' },
  { j: 'lAnkle', layer: 'near' },
]

export const STROKE = 0.03
export const DOT_R = STROKE * 0.42
export { HEAD_RADIUS }

export function point(pose: Pose, p: Point): { x: number; y: number } {
  if (p !== 'pelvis') return pose[p]
  return { x: (pose.lHip.x + pose.rHip.x) / 2, y: (pose.lHip.y + pose.rHip.y) / 2 }
}

/** viewBox centred on the animation's full range of motion, at a shared size. */
export function viewBoxFor(anim: Animation, frame: { w: number; h: number }) {
  const b = animationBounds(anim)
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  return { x: cx - frame.w / 2, y: cy - frame.h / 2, w: frame.w, h: frame.h }
}

const floorCache = new WeakMap<Animation, { y: number; x1: number; x2: number }>()

/** A floor line just under the lowest joint the animation reaches. */
export function floorFor(anim: Animation) {
  const hit = floorCache.get(anim)
  if (hit) return hit
  const b = animationBounds(anim)
  let lowest = -Infinity
  for (const { pose } of anim.loop) {
    for (const [j, p] of Object.entries(pose)) if (j !== 'head') lowest = Math.max(lowest, p.y)
  }
  const floor = { y: lowest + STROKE / 2 + 0.004, x1: b.minX - 0.06, x2: b.maxX + 0.06 }
  floorCache.set(anim, floor)
  return floor
}
