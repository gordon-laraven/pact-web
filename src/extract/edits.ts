import type { TrackedClip } from './extract'
import { extractRange, type Movement } from './segment'

// Hand edits on detected movements. Each re-reads the tracked frames for the
// new range, so reps, tempo and the stick-figure loop stay true to the video.

/** Shortest part a split can leave: shorter than this can't hold a rep reliably. */
export const MIN_PART_SEC = 1.5

/** Two movements (usually neighbours) as one, spanning both. Null if no movement can be tracked across them. */
export function mergeMovements(clip: TrackedClip, a: Movement, b: Movement, id: string): Movement | null {
  return extractRange(clip, Math.min(a.start, b.start), Math.max(a.end, b.end), id)
}

/** One movement as two, cut at `at` seconds. Null if either part is too short or can't be tracked. */
export function splitMovement(clip: TrackedClip, m: Movement, at: number, ids: [string, string]): [Movement, Movement] | null {
  if (at - m.start < MIN_PART_SEC || m.end - at < MIN_PART_SEC) return null
  const first = extractRange(clip, m.start, at, ids[0])
  const second = extractRange(clip, at, m.end, ids[1])
  return first && second ? [first, second] : null
}
