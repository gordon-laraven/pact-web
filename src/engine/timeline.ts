import type { Exercise, Workout } from '../types'

// Pure timeline engine: Workout -> flat list of phases, and elapsed -> state.
// No DOM, no clocks. Everything the player shows is derived from here.

export type PhaseKind = 'prep' | 'work' | 'rest'

export type Phase = {
  index: number
  kind: PhaseKind
  /** prep: the first exercise; work: the exercise; rest: the exercise just finished. */
  exerciseIndex: number
  /** 0-based set index (prep: 0; rest: the set just finished). */
  setIndex: number
  totalSets: number
  start: number
  duration: number
  end: number
  /** work only: target reps for rep_based exercises. */
  targetReps?: number
  /** work only: seconds per animation loop (= seconds per rep for rep_based). */
  loopSec?: number
}

export type Timeline = {
  workout: Workout
  phases: Phase[]
  duration: number
  /** Start time of each exercise's first work phase, by exercise index. */
  exerciseStarts: number[]
}

export type TimelineOptions = {
  /** Get-ready countdown before the first exercise. 0 disables it. */
  prepSec?: number
  /** Default loop length for an animation (rep tempo or time_based loop speed). */
  loopSecFor: (animationId: string) => number
}

export const DEFAULT_PREP_SEC = 5

/** Phase boundaries are sums of floats; this keeps boundary lookups stable. */
const EPS = 1e-9

export function buildTimeline(workout: Workout, opts: TimelineOptions): Timeline {
  const prepSec = opts.prepSec ?? DEFAULT_PREP_SEC
  const phases: Phase[] = []
  const exerciseStarts: number[] = []
  let t = 0

  const push = (p: Omit<Phase, 'index' | 'start' | 'end'>) => {
    if (!(p.duration > 0)) return
    phases.push({ ...p, index: phases.length, start: t, end: t + p.duration })
    t += p.duration
  }

  if (workout.exercises.length === 0) {
    return { workout, phases, duration: 0, exerciseStarts }
  }

  push({
    kind: 'prep',
    exerciseIndex: 0,
    setIndex: 0,
    totalSets: workout.exercises[0].sets.length,
    duration: prepSec,
  })

  workout.exercises.forEach((ex, exerciseIndex) => {
    if (ex.sets.length === 0) throw new Error(`Exercise "${ex.id}" has no sets`)
    const loopSec = loopSecForExercise(ex, opts)
    const isLastExercise = exerciseIndex === workout.exercises.length - 1

    ex.sets.forEach((set, setIndex) => {
      const base = { exerciseIndex, setIndex, totalSets: ex.sets.length }
      if (setIndex === 0) exerciseStarts[exerciseIndex] = t

      if (ex.type === 'rep_based') {
        if (!set.reps || set.reps <= 0) {
          throw new Error(`Exercise "${ex.id}" set ${setIndex + 1} needs reps`)
        }
        push({ ...base, kind: 'work', duration: set.reps * loopSec, targetReps: set.reps, loopSec })
      } else {
        if (!set.holdSec || set.holdSec <= 0) {
          throw new Error(`Exercise "${ex.id}" set ${setIndex + 1} needs holdSec`)
        }
        push({ ...base, kind: 'work', duration: set.holdSec, loopSec })
      }

      const isVeryLastSet = isLastExercise && setIndex === ex.sets.length - 1
      if (!isVeryLastSet) push({ ...base, kind: 'rest', duration: set.restAfterSec })
    })
  })

  return { workout, phases, duration: t, exerciseStarts }
}

function loopSecForExercise(ex: Exercise, opts: TimelineOptions): number {
  const loopSec =
    ex.type === 'rep_based' && ex.tempoSec ? ex.tempoSec : opts.loopSecFor(ex.animationId)
  if (!(loopSec > 0)) throw new Error(`Exercise "${ex.id}" has no valid tempo`)
  return loopSec
}

/** How slow the dimmed preview loop runs during prep/rest, relative to live tempo. */
export const PREVIEW_SLOWDOWN = 1.8

export type NextUp = {
  exerciseIndex: number
  exercise: Exercise
  setNumber: number
  totalSets: number
}

export type PlayerState = {
  elapsed: number
  finished: boolean
  phase: Phase | null
  phaseElapsed: number
  phaseRemaining: number
  exercise: Exercise | null
  exerciseIndex: number
  /** 1-based. */
  setNumber: number
  totalSets: number
  /** rep_based work only: completed reps (increments exactly when a loop completes). */
  repsDone: number | null
  targetReps: number | null
  /** Overall progress 0..1. */
  progress: number
  /** The next work phase after the current phase, if any. */
  nextUp: NextUp | null
  /** What the stick figure should show. */
  figure: { animationId: string; t: number; mode: 'live' | 'preview' } | null
}

export function findPhaseIndex(tl: Timeline, elapsed: number): number {
  const { phases } = tl
  if (phases.length === 0 || elapsed >= tl.duration - EPS) return -1
  let lo = 0
  let hi = phases.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (phases[mid].start <= elapsed + EPS) lo = mid
    else hi = mid - 1
  }
  return lo
}

function nextWorkAfter(tl: Timeline, phaseIndex: number): NextUp | null {
  for (let i = phaseIndex + 1; i < tl.phases.length; i++) {
    const p = tl.phases[i]
    if (p.kind === 'work') {
      return {
        exerciseIndex: p.exerciseIndex,
        exercise: tl.workout.exercises[p.exerciseIndex],
        setNumber: p.setIndex + 1,
        totalSets: p.totalSets,
      }
    }
  }
  return null
}

export function getStateAt(tl: Timeline, elapsedIn: number): PlayerState {
  const elapsed = Math.min(Math.max(elapsedIn, 0), tl.duration)
  const progress = tl.duration > 0 ? elapsed / tl.duration : 1
  const idx = findPhaseIndex(tl, elapsed)

  if (idx < 0) {
    const lastEx = tl.workout.exercises.length - 1
    return {
      elapsed,
      finished: true,
      phase: null,
      phaseElapsed: 0,
      phaseRemaining: 0,
      exercise: tl.workout.exercises[lastEx] ?? null,
      exerciseIndex: lastEx,
      setNumber: 0,
      totalSets: 0,
      repsDone: null,
      targetReps: null,
      progress: 1,
      nextUp: null,
      figure: null,
    }
  }

  const phase = tl.phases[idx]
  const phaseElapsed = Math.max(0, elapsed - phase.start)
  const phaseRemaining = Math.max(0, phase.end - elapsed)
  const exercise = tl.workout.exercises[phase.exerciseIndex]
  const nextUp = nextWorkAfter(tl, idx)

  let repsDone: number | null = null
  let targetReps: number | null = null
  let figure: PlayerState['figure'] = null

  if (phase.kind === 'work') {
    const loopSec = phase.loopSec!
    const loops = phaseElapsed / loopSec
    // Snap tiny float error so the counter flips on the exact frame the loop wraps.
    const whole = Math.floor(loops + EPS)
    if (phase.targetReps != null) {
      targetReps = phase.targetReps
      repsDone = Math.min(whole, phase.targetReps)
    }
    figure = { animationId: exercise.animationId, t: Math.max(0, loops - whole), mode: 'live' }
  } else if (nextUp) {
    // Prep and rest preview the upcoming move: dimmed and slowed down.
    const nextPhase = tl.phases.find(
      (p, i) => i > idx && p.kind === 'work' && p.exerciseIndex === nextUp.exerciseIndex,
    )!
    const loops = phaseElapsed / (nextPhase.loopSec! * PREVIEW_SLOWDOWN)
    figure = { animationId: nextUp.exercise.animationId, t: loops - Math.floor(loops), mode: 'preview' }
  }

  return {
    elapsed,
    finished: false,
    phase,
    phaseElapsed,
    phaseRemaining,
    exercise,
    exerciseIndex: phase.exerciseIndex,
    setNumber: phase.setIndex + 1,
    totalSets: phase.totalSets,
    repsDone,
    targetReps,
    progress,
    nextUp,
    figure,
  }
}

/**
 * Progress-bar fill for each exercise segment, 0..1. A segment runs from the
 * exercise's first work phase to the next exercise's first work phase (so it
 * includes the rests after it). The get-ready phase fills nothing.
 */
export function getSegmentFills(tl: Timeline, elapsed: number): number[] {
  return tl.exerciseStarts.map((start, i) => {
    const end = tl.exerciseStarts[i + 1] ?? tl.duration
    if (end <= start) return elapsed >= end ? 1 : 0
    return Math.min(1, Math.max(0, (elapsed - start) / (end - start)))
  })
}

/** Seek target for "next exercise": the next exercise start after `elapsed`, or the end. */
export function nextExerciseTime(tl: Timeline, elapsed: number): number {
  for (const start of tl.exerciseStarts) if (start > elapsed + 1e-6) return start
  return tl.duration
}

/**
 * Seek target for "previous exercise". Like a music player: within the first
 * `graceSec` of an exercise it goes to the previous one, otherwise it restarts
 * the current one. Before the first exercise it goes back to the very start.
 */
export function prevExerciseTime(tl: Timeline, elapsed: number, graceSec = 2): number {
  let target = 0
  for (const start of tl.exerciseStarts) if (start <= elapsed - graceSec + 1e-6) target = start
  return target
}
