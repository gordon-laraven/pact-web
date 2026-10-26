// "Set for all movements": one set of sets, reps and rest applied to every
// movement on the review screen. Pure, so the rules are unit-tested:
//   - timed moves get the sets and rest, never reps; their time changes only
//     if a uniform time is given
//   - a movement edited by hand is "custom" and keeps its values unless the
//     person chooses to replace them
//   - every apply can be undone
//   - movements added later start from the uniform values

export type Uniform = {
  sets: number
  reps: number
  restSec: number
  /** Optional: one time for every timed move. null leaves their times alone. */
  holdSec: number | null
}

/** The numbers a movement card holds that the uniform values can set. */
export type Plan = { type: 'rep_based' | 'time_based'; sets: number; reps: number; holdSec: number; restSec: number }

/** Anything with a key, a plan and a "custom" mark (the review screen's cards). */
export type Planned<F extends Plan = Plan> = { key: string; form: F; custom?: boolean }

export const DEFAULT_UNIFORM: Uniform = { sets: 3, reps: 10, restSec: 30, holdSec: null }

export const LIMITS = { sets: [1, 20], reps: [1, 200], restSec: [0, 600], holdSec: [1, 600] } as const

const clampInt = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)))

/** Values kept in range (what the inputs allow). */
export function cleanUniform(u: Uniform): Uniform {
  return {
    sets: clampInt(u.sets, LIMITS.sets),
    reps: clampInt(u.reps, LIMITS.reps),
    restSec: clampInt(u.restSec, LIMITS.restSec),
    holdSec: u.holdSec == null || !Number.isFinite(u.holdSec) || u.holdSec <= 0 ? null : clampInt(u.holdSec, LIMITS.holdSec),
  }
}

/** One plan with the uniform values: reps for rep moves, time (if given) for timed ones. */
export function applyToPlan<F extends Plan>(form: F, u: Uniform): F {
  const c = cleanUniform(u)
  return form.type === 'rep_based'
    ? { ...form, sets: c.sets, restSec: c.restSec, reps: c.reps }
    : { ...form, sets: c.sets, restSec: c.restSec, holdSec: c.holdSec ?? form.holdSec }
}

/** Did a card edit change anything the uniform values set? Then it's custom. */
export function changesPlan(before: Plan, after: Plan): boolean {
  return (['type', 'sets', 'reps', 'holdSec', 'restSec'] as const).some((k) => before[k] !== after[k])
}

export type ApplyResult<T> = {
  items: T[]
  /** How many cards changed, and how many custom ones were left alone. */
  applied: number
  keptCustom: number
  /** Timed moves that kept their own time (no uniform time given). */
  timedKeptTime: number
  /** Put everything back as it was. */
  undo: Undo<T>
}

export type Undo<T> = { before: Map<string, T> }

export function applyToAll<F extends Plan, T extends Planned<F>>(items: T[], u: Uniform, opts: { replaceCustom: boolean }): ApplyResult<T> {
  const before = new Map(items.map((it) => [it.key, it]))
  let applied = 0
  let keptCustom = 0
  let timedKeptTime = 0
  const next = items.map((it) => {
    if (it.custom && !opts.replaceCustom) {
      keptCustom++
      return it
    }
    applied++
    if (it.form.type === 'time_based' && cleanUniform(u).holdSec == null) timedKeptTime++
    return { ...it, form: applyToPlan(it.form, u), custom: false }
  })
  return { items: next, applied, keptCustom, timedKeptTime, undo: { before } }
}

/**
 * Undo an apply: every card that still exists gets its plan and custom mark
 * back. Cards added or removed since are left as they are now.
 */
export function undoApply<F extends Plan, T extends Planned<F>>(items: T[], undo: Undo<T>): T[] {
  return items.map((it) => {
    const was = undo.before.get(it.key)
    return was ? { ...it, form: was.form, custom: was.custom } : it
  })
}

/** A movement added after uniform values were applied starts from them. */
export function forNewMovement<F extends Plan>(form: F, active: Uniform | null): F {
  return active ? applyToPlan(form, active) : form
}
