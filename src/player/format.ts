import type { Exercise } from '../types'

/** 75 -> "1:15" */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "2 × 10", "10, 8", "40 sec", "2 × 30 sec" */
export function prescription(ex: Exercise): string {
  const n = ex.sets.length
  if (ex.type === 'rep_based') {
    const reps = ex.sets.map((s) => s.reps ?? 0)
    return reps.every((r) => r === reps[0]) ? `${n} × ${reps[0]}` : reps.join(', ')
  }
  const holds = ex.sets.map((s) => s.holdSec ?? 0)
  if (n === 1) return `${holds[0]} sec`
  return holds.every((h) => h === holds[0]) ? `${n} × ${holds[0]} sec` : `${holds.join(', ')} sec`
}

/**
 * Dev-only clock multiplier from the URL, e.g. ?speed=4. Ignored in
 * production builds. Clamped to a sane range.
 */
export function readSpeed(search: string, isDev: boolean): number {
  if (!isDev) return 1
  const raw = Number(new URLSearchParams(search).get('speed'))
  if (!Number.isFinite(raw) || raw <= 0) return 1
  return Math.min(Math.max(raw, 0.1), 32)
}
