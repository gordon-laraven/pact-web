import type { Animation } from '../types'

/**
 * The same move as seen from the other side: every pose flipped left-to-right.
 * Used for "Add other side" when the video only shows one side.
 */
export function mirrorAnimation(anim: Animation): Animation {
  return {
    ...anim,
    id: `${anim.id}-mirrored`,
    loop: anim.loop.map(({ t, pose }) => ({
      t,
      pose: Object.fromEntries(Object.entries(pose).map(([j, p]) => [j, { x: 1 - p.x, y: p.y }])) as typeof pose,
    })),
  }
}
