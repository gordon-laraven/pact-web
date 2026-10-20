import type { Timeline } from './timeline'

// Audio cues are scheduled on the same timeline as everything else, so they
// fire off the one player clock: the player asks "which cues fall inside the
// time that just elapsed?" every frame.

export type Cue = {
  at: number
  /** Text for speechSynthesis, if any. */
  say?: string
  /** Web Audio beep: short tick on 3-2-1, longer high tone when work begins. */
  beep?: 'tick' | 'go'
}

/** Time-based work at least this long gets a "Halfway" cue. */
export const LONG_HOLD_SEC = 30

export function buildCues(tl: Timeline): Cue[] {
  const cues: Cue[] = []
  const { phases, workout } = tl

  phases.forEach((p, i) => {
    const ex = workout.exercises[p.exerciseIndex]
    if (p.kind === 'prep') {
      cues.push({ at: p.start, say: 'Get ready' })
    } else if (p.kind === 'rest') {
      cues.push({ at: p.start, say: 'Rest' })
    } else {
      // 3, 2, 1 during the tail of the prep/rest that leads into this work phase.
      const prev = phases[i - 1]
      if (prev && prev.kind !== 'work') {
        for (const n of [3, 2, 1]) {
          const at = p.start - n
          if (at >= prev.start) cues.push({ at, say: String(n), beep: 'tick' })
        }
      }
      cues.push({ at: p.start, beep: 'go', say: p.setIndex === 0 ? ex.name : undefined })
      if (ex.type === 'time_based' && p.duration >= LONG_HOLD_SEC) {
        cues.push({ at: p.start + p.duration / 2, say: 'Halfway' })
      }
    }
  })

  if (phases.length > 0) cues.push({ at: tl.duration, say: 'Done. Workout complete.' })
  return cues.sort((a, b) => a.at - b.at)
}

/**
 * Cues with from < at <= to. If a lot of time passed at once (tab was in the
 * background), only cues from the last `maxLagSec` are returned so we don't
 * fire a burst of stale announcements.
 */
export function cuesBetween(cues: Cue[], from: number, to: number, maxLagSec = 1): Cue[] {
  if (!(to > from)) return []
  const lo = Math.max(from, to - maxLagSec)
  return cues.filter((c) => c.at > lo && c.at <= to)
}
