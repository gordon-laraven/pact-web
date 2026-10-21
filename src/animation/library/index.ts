import { JOINTS, type Animation } from '../../types'
import { BODY } from '../rig'
import { gluteBridge } from './gluteBridge'
import { jumpingJacks } from './jumpingJacks'
import { mountainClimbers } from './mountainClimbers'
import { plank } from './plank'
import { pushUp } from './pushUp'
import { squat } from './squat'

// The animation library: animationId -> Animation. To add a move, create a
// file next to these and register it here (see README).

export const animations: Record<string, Animation> = Object.fromEntries(
  [jumpingJacks, squat, pushUp, plank, gluteBridge, mountainClimbers].map((a) => [a.id, a]),
)

/** Adds an animation made at runtime (e.g. extracted from a video). */
export function registerAnimation(anim: Animation): void {
  animations[anim.id] = anim
}

export function getAnimation(id: string): Animation {
  const anim = animations[id]
  if (!anim) throw new Error(`Unknown animationId "${id}"`)
  return anim
}

export const loopSecFor = (id: string) => getAnimation(id).defaultTempoSec

export const HEAD_RADIUS = BODY.headR

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

const boundsCache = new WeakMap<Animation, Bounds>()

/** Bounding box of an animation over its whole loop (head circle included). */
export function animationBounds(anim: Animation): Bounds {
  const hit = boundsCache.get(anim)
  if (hit) return hit
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const { pose } of anim.loop) {
    for (const j of JOINTS) {
      const r = j === 'head' ? HEAD_RADIUS : 0
      b.minX = Math.min(b.minX, pose[j].x - r)
      b.maxX = Math.max(b.maxX, pose[j].x + r)
      b.minY = Math.min(b.minY, pose[j].y - r)
      b.maxY = Math.max(b.maxY, pose[j].y + r)
    }
  }
  boundsCache.set(anim, b)
  return b
}

/**
 * One frame size shared by every animation, so the figure is drawn at the
 * same scale for every exercise (it's the same person) and never jumps.
 */
export function sharedFrame(anims: Animation[], pad = 0.08): { w: number; h: number } {
  let w = 0
  let h = 0
  for (const a of anims) {
    const b = animationBounds(a)
    w = Math.max(w, b.maxX - b.minX)
    h = Math.max(h, b.maxY - b.minY)
  }
  return { w: w + pad * 2, h: h + pad * 2 }
}
