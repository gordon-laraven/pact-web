import type { LinkConfidence, LinkExercise, LinkSource, LinkWorkout } from './types.ts'

// Whatever produced a list (a model, the local parser, a person typing), it
// comes through here: names are trimmed, numbers are kept in sane ranges, and
// an empty list counts as "not usable" so the pipeline moves to the next step.

const LIMITS = { sets: [1, 20], reps: [1, 300], duration_seconds: [1, 3600], rest_seconds: [0, 600] } as const

export function normalizeWorkout(raw: unknown, source: LinkSource, fallbackTitle = 'Workout from a link'): LinkWorkout | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const list = Array.isArray(r.exercises) ? r.exercises : []
  const exercises = list.map(normalizeExercise).filter((e): e is LinkExercise => e !== null).slice(0, 40)
  if (exercises.length === 0) return null
  const title = text(r.title, 80) ?? fallbackTitle
  const said = r.confidence === 'high' || r.confidence === 'medium' || r.confidence === 'low' ? r.confidence : 'medium'
  return { title, source, exercises, confidence: capConfidence(said, exercises) }
}

function normalizeExercise(raw: unknown): LinkExercise | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = text(r.name, 60)
  if (!name || !/[a-z]{2}/i.test(name)) return null
  return {
    name,
    sets: int(r.sets, LIMITS.sets),
    reps: int(r.reps, LIMITS.reps),
    duration_seconds: int(r.duration_seconds, LIMITS.duration_seconds),
    rest_seconds: int(r.rest_seconds, LIMITS.rest_seconds),
    notes: text(r.notes, 160),
  }
}

/** A list where most moves have no reps or time is never "high". */
function capConfidence(said: LinkConfidence, exercises: LinkExercise[]): LinkConfidence {
  const missing = exercises.filter((e) => e.reps == null && e.duration_seconds == null).length
  if (missing === exercises.length) return 'low'
  if (missing * 2 > exercises.length && said === 'high') return 'medium'
  return said
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

function int(v: unknown, [lo, hi]: readonly [number, number]): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  const r = Math.round(n)
  return r < lo || r > hi ? null : r
}
