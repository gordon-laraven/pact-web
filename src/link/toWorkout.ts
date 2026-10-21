import type { Exercise, Workout } from '../types'
import type { LinkConfidence, LinkExercise, LinkPlatform, LinkPost, LinkSource, LinkWorkout } from './types'

// Link list -> the app's own Workout. The editable row in between is what the
// review screen shows, so people can fix names, numbers and order first.

export type LinkRow = {
  key: string
  name: string
  type: Exercise['type']
  sets: number
  reps: number
  holdSec: number
  restSec: number
  notes: string
  animationId: string
}

export const DEFAULTS = { sets: 1, reps: 10, holdSec: 30, restSec: 15 }

/** Library moves, and the words that pick them. First match wins. */
export const FIGURES: { id: string; label: string; words: RegExp }[] = [
  { id: 'squat', label: 'Squat', words: /squat|lunge|deadlift|rdl|hinge|step[- ]?up|calf|good morning|swing|sumo/i },
  { id: 'push-up', label: 'Push-up', words: /push|press[- ]?up|dip\b|inchworm|shoulder tap/i },
  { id: 'plank', label: 'Plank', words: /plank|hold|hollow|wall sit|bear|dead ?bug|superman|bird ?dog/i },
  { id: 'glute-bridge', label: 'Glute bridge', words: /bridge|thrust|hip lift|clam|donkey|hydrant|crunch|sit[- ]?up|leg raise|flutter/i },
  { id: 'mountain-climbers', label: 'Mountain climbers', words: /climber|high knee|knee drive|\brun|sprint|march|skater|butt kick/i },
  { id: 'jumping-jacks', label: 'Jumping jacks', words: /jack|jump|hop|skip|burpee|star|seal|shadow ?box|punch|jab/i },
]

export function guessFigure(name: string, timed: boolean): string {
  return FIGURES.find((f) => f.words.test(name))?.id ?? (timed ? 'jumping-jacks' : 'squat')
}

let counter = 0
const newKey = () => `row-${Date.now().toString(36)}-${(counter++).toString(36)}`

export function toRow(e: LinkExercise): LinkRow {
  const timed = e.reps == null && e.duration_seconds != null
  return {
    key: newKey(),
    name: e.name,
    type: timed ? 'time_based' : 'rep_based',
    sets: e.sets ?? DEFAULTS.sets,
    reps: e.reps ?? DEFAULTS.reps,
    holdSec: e.duration_seconds ?? DEFAULTS.holdSec,
    restSec: e.rest_seconds ?? DEFAULTS.restSec,
    notes: e.notes ?? '',
    animationId: guessFigure(e.name, timed),
  }
}

export function blankRow(): LinkRow {
  return { key: newKey(), name: '', type: 'rep_based', ...DEFAULTS, notes: '', animationId: 'squat' }
}

/** Is there anything to fix before this list can be built? */
export function rowsReady(rows: LinkRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.name.trim() !== '')
}

export type LinkMeta = { platform: LinkPlatform | null; url: string | null; post: LinkPost | null; source: LinkSource; confidence: LinkConfidence }

export function toWorkout(title: string, rows: LinkRow[], meta: LinkMeta): Workout {
  const id = `link-${slug(title) || 'workout'}`
  const used = new Set<string>()
  const exercises: Exercise[] = rows.map((r, i) => {
    let exId = slug(r.name) || `move-${i + 1}`
    while (used.has(exId)) exId = `${exId}-${i + 1}`
    used.add(exId)
    const sets = Math.max(1, Math.round(r.sets))
    const set = r.type === 'rep_based' ? { reps: Math.max(1, Math.round(r.reps)) } : { holdSec: Math.max(1, Math.round(r.holdSec)) }
    return {
      id: exId,
      name: r.name.trim(),
      type: r.type,
      animationId: r.animationId,
      sets: Array.from({ length: sets }, (_, s) => ({ ...set, restAfterSec: s === sets - 1 && i === rows.length - 1 ? 0 : Math.max(0, Math.round(r.restSec)) })),
      ...(r.notes.trim() ? { notes: r.notes.trim() } : {}),
    }
  })
  const platform = meta.platform === 'youtube' || meta.platform === 'instagram' || meta.platform === 'facebook' ? meta.platform : 'manual'
  return {
    id,
    title: title.trim() || 'Workout from a link',
    ...(meta.post?.author ? { creator: { name: meta.post.author, ...(meta.url ? { attributionUrl: meta.url } : {}) } } : {}),
    source: { platform, ...(meta.url ? { url: meta.url } : {}) },
    exercises,
  }
}

export function rowsFrom(w: LinkWorkout): LinkRow[] {
  return w.exercises.map(toRow)
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
