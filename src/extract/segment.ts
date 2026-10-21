import {
  extractAnimation,
  ExtractError,
  landmarksToSample,
  median,
  type ExtractResult,
  type TrackedClip,
} from './extract'

// Splits one tracked video into its movements, then runs the single-movement
// extraction (extract.ts) on each. Pure functions, no DOM.
//
//   frames -> body-relative posture per frame
//   -> split at gaps (nobody in frame) and camera cuts
//   -> split where the posture or motion pattern changes (compare the few
//      seconds before each moment with the few seconds after)
//   -> label pieces: movement, hold, rest (standing still) or transition (too short)
//   -> merge neighbouring pieces of the same movement; a rest in between makes
//      it another set of that movement, a different movement in between keeps
//      them as separate entries
//   -> extract each set; one entry per movement, in video order

export type MovementSet = {
  /** Seconds in the source video. */
  start: number
  end: number
  /** Reps found in this set (0 for holds). */
  reps: number
}

export type Movement = {
  /** Seconds in the source video: start of the first set, end of the last. */
  start: number
  end: number
  sets: MovementSet[]
  /** The extracted loop and stats, from the best-tracked set. */
  result: ExtractResult
}

const GAP_SEC = 0.7 // nobody tracked for this long = a break (title card, cut away)
const WINDOW_SEC = 3 // compare this much before vs after each moment
const HOP_SEC = 0.25
const REFINE_SEC = 1 // search +-1 s around each change, with 1 s windows, for the exact moment
const CHANGE_THRESHOLD = 1.0 // how different before/after must be to start a new piece
const MIN_SPLIT_GAP_SEC = 2 // two splits at least this far apart
const MIN_MOVE_SEC = 2 // shorter pieces are transitions (getting down to the floor, etc.)
const SAME_MOVE_THRESHOLD = 0.45 // neighbouring pieces closer than this are one movement
const STILL = 0.05 // average spread of posture below this = not moving
const NEW_SET_GAP_SEC = 1.5 // a pause this long between pieces of the same move = a new set
const EDGE_TRIM_SEC = 0.25 // ignore the very edges of a piece (half a transition)

type Frame = { t: number; joints: number[] | null }
type Feature = { t: number; f: number[]; hip: { x: number; y: number }; spine: number }
type Piece = { start: number; end: number; feats: Feature[] }
type Kind = 'move' | 'hold' | 'rest' | 'transition'

/**
 * Posture relative to the hips, in spine lengths. Horizontal offsets are taken
 * as absolute values so turning around (facing left vs right) is not a change.
 */
export function postureFeature(j: number[]): { f: number[]; hip: { x: number; y: number }; spine: number } | null {
  const hx = (j[16] + j[18]) / 2
  const hy = (j[17] + j[19]) / 2
  const spine = Math.hypot(j[2] - hx, j[3] - hy)
  if (!(spine > 1e-6)) return null
  const f: number[] = []
  for (let i = 0; i < 14; i++) f.push(Math.abs(j[2 * i] - hx) / spine, (j[2 * i + 1] - hy) / spine)
  return { f, hip: { x: hx, y: hy }, spine }
}

/** Mean posture plus how much each part moves: what the body is doing, not when. */
function describe(feats: Feature[]): number[] {
  const n = feats.length
  const d = feats[0].f.length
  const mean = new Array(d).fill(0)
  for (const x of feats) for (let k = 0; k < d; k++) mean[k] += x.f[k] / n
  const std = new Array(d).fill(0)
  for (const x of feats) for (let k = 0; k < d; k++) std[k] += (x.f[k] - mean[k]) ** 2 / n
  return [...mean, ...std.map((v) => 2 * Math.sqrt(v))]
}

const distance = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, k) => s + (v - b[k]) ** 2, 0) / a.length) * 4

/** Average spread of the posture over a piece: ~0 when holding still. */
function motion(feats: Feature[]): number {
  const desc = describe(feats)
  const half = desc.length / 2
  return desc.slice(half).reduce((a, b) => a + b, 0) / half / 2
}

/** Standing upright, legs straight: the classic between-exercises rest. */
function isUpright(feats: Feature[]): boolean {
  const neckY = median(feats.map((x) => x.f[3]))
  const ankleY = median(feats.map((x) => (x.f[25] + x.f[27]) / 2))
  return neckY < -0.85 && ankleY > 1.3
}

/** Runs of tracked frames, broken at gaps and at camera cuts (the body jumps in the frame). */
function runs(frames: Frame[]): Feature[][] {
  const out: Feature[][] = []
  let cur: Feature[] = []
  for (const fr of frames) {
    const p = fr.joints && postureFeature(fr.joints)
    if (!p) continue
    const last = cur[cur.length - 1]
    const gap = last && fr.t - last.t > GAP_SEC
    const cut =
      last &&
      Math.hypot(p.hip.x - last.hip.x, p.hip.y - last.hip.y) / last.spine > 0.8 &&
      Math.abs(Math.log(p.spine / last.spine)) > 0.15
    if (gap || cut) {
      out.push(cur)
      cur = []
    }
    cur.push({ t: fr.t, ...p })
  }
  if (cur.length) out.push(cur)
  return out
}

/** Split a run where the before/after posture-and-motion description changes most. */
function splitRun(run: Feature[]): Piece[] {
  const t0 = run[0].t
  const t1 = run[run.length - 1].t
  const window = (a: number, b: number) => run.filter((x) => x.t >= a && x.t < b)
  const scores: { t: number; d: number }[] = []
  for (let t = t0 + WINDOW_SEC; t <= t1 - WINDOW_SEC; t += HOP_SEC) {
    const before = window(t - WINDOW_SEC, t)
    const after = window(t, t + WINDOW_SEC)
    if (before.length < 5 || after.length < 5) continue
    scores.push({ t, d: distance(describe(before), describe(after)) })
  }
  // Peaks above the threshold, strongest first, kept apart from each other.
  const peaks = scores
    .filter((s, i) => s.d > CHANGE_THRESHOLD && s.d >= (scores[i - 1]?.d ?? 0) && s.d >= (scores[i + 1]?.d ?? 0))
    .sort((a, b) => b.d - a.d)
  const cuts: number[] = []
  for (const p of peaks) if (cuts.every((c) => Math.abs(c - p.t) >= MIN_SPLIT_GAP_SEC)) cuts.push(p.t)
  // The wide windows find *that* something changed; short windows pin down *when*.
  const refined = cuts.map((c) => {
    let best = { t: c, d: -Infinity }
    for (const x of run) {
      if (x.t < c - REFINE_SEC || x.t > c + REFINE_SEC) continue
      const before = window(x.t - REFINE_SEC, x.t)
      const after = window(x.t, x.t + REFINE_SEC)
      if (before.length < 3 || after.length < 3) continue
      const d = distance(describe(before), describe(after))
      if (d > best.d) best = { t: x.t, d }
    }
    return best.t
  })
  cuts.splice(0, cuts.length, ...refined.sort((a, b) => a - b))
  const edges = [t0, ...cuts, t1 + 1e-6]
  const pieces: Piece[] = []
  for (let i = 0; i + 1 < edges.length; i++) {
    const feats = run.filter((x) => x.t >= edges[i] && x.t < edges[i + 1])
    if (feats.length) pieces.push({ start: feats[0].t, end: feats[feats.length - 1].t, feats })
  }
  return pieces
}

function classify(p: Piece): Kind {
  if (p.end - p.start < MIN_MOVE_SEC) return 'transition'
  if (motion(p.feats) < STILL) return isUpright(p.feats) ? 'rest' : 'hold'
  return 'move'
}

type Group = { sets: Piece[][]; desc: number[] }

/** The pieces a clip is cut into, with their labels (for tests and debugging). */
export function pieceSummary(clip: TrackedClip) {
  const aspect = clip.width > 0 && clip.height > 0 ? clip.width / clip.height : 1
  const frames: Frame[] = clip.frames.map((f) => ({ t: f.t, joints: landmarksToSample(f.landmarks, aspect)?.joints ?? null }))
  let prev: number[] | null = null
  return runs(frames)
    .flatMap(splitRun)
    .map((p) => {
      const desc = describe(p.feats)
      const fromPrev = prev ? distance(prev, desc) : null
      prev = desc
      return { start: p.start, end: p.end, kind: classify(p), motion: motion(p.feats), fromPrev }
    })
}

/** The movements in a tracked clip, in order. Throws ExtractError (with a user-facing message) if there are none. */
export function extractMovements(clip: TrackedClip, idPrefix: string): Movement[] {
  const aspect = clip.width > 0 && clip.height > 0 ? clip.width / clip.height : 1
  const frames: Frame[] = clip.frames.map((f) => ({ t: f.t, joints: landmarksToSample(f.landmarks, aspect)?.joints ?? null }))

  const pieces = runs(frames).flatMap(splitRun)
  const groups: Group[] = []
  let lastEnd = -Infinity
  let pausedSinceLast = false // a rest or gap since the last movement piece
  for (const p of pieces) {
    const kind = classify(p)
    const desc = describe(p.feats)
    const prev = groups[groups.length - 1]
    if (kind === 'transition') {
      // A short piece that looks like the movement before it is just its end; absorb it.
      if (prev && !pausedSinceLast && distance(prev.desc, desc) < SAME_MOVE_THRESHOLD) {
        prev.sets[prev.sets.length - 1].push(p)
        lastEnd = p.end
      }
      continue
    }
    if (kind === 'rest') {
      pausedSinceLast = true
      continue
    }
    const pause = pausedSinceLast || p.start - lastEnd >= NEW_SET_GAP_SEC
    if (prev && distance(prev.desc, desc) < SAME_MOVE_THRESHOLD) {
      // The same movement continues: either more of this set, or (after a pause) a new set.
      if (pause) prev.sets.push([p])
      else prev.sets[prev.sets.length - 1].push(p)
      prev.desc = describe(prev.sets.flat().flatMap((q) => q.feats))
    } else {
      groups.push({ sets: [[p]], desc })
    }
    lastEnd = p.end
    pausedSinceLast = false
  }

  const movements: Movement[] = []
  for (const [gi, g] of groups.entries()) {
    const sets: (MovementSet & { result: ExtractResult | null })[] = g.sets.map((pieceList, si) => {
      const start = pieceList[0].start
      const end = pieceList[pieceList.length - 1].end
      const result = tryExtract(clip, start, end, `${idPrefix}-${gi + 1}-${si + 1}`)
      return { start, end, reps: result?.kind === 'reps' ? result.repsFound : 0, result }
    })
    const usable = sets.filter((s) => s.result)
    if (usable.length === 0) continue
    // Animate from the set that tracked best: most reps, then clearest rhythm.
    const best = usable.reduce((a, b) =>
      b.result!.repsFound * (0.5 + b.result!.confidence) > a.result!.repsFound * (0.5 + a.result!.confidence) ? b : a,
    )
    const result = best.result!
    // Standing around without repeating anything is a rest, not an exercise.
    if (result.kind === 'hold' && isUpright(g.sets.flat().flatMap((p) => p.feats))) continue
    movements.push({
      start: sets[0].start,
      end: sets[sets.length - 1].end,
      sets: sets.map(({ start, end, reps }) => ({ start, end, reps })),
      result,
    })
  }

  if (movements.length === 0) {
    throw new ExtractError(
      "Couldn't find a clear exercise in this video. Try a clip where one person does the moves with the whole body in frame.",
    )
  }
  return movements
}

/**
 * Single-movement extraction on part of the clip; null if that part can't be
 * extracted. If the edges still hold some of a neighbouring move, a tighter
 * trim usually fixes it, so try that before giving up.
 */
function tryExtract(clip: TrackedClip, start: number, end: number, id: string): ExtractResult | null {
  const len = end - start
  for (const trim of [EDGE_TRIM_SEC, Math.max(EDGE_TRIM_SEC, len * 0.15)]) {
    const [a, b] = len > 4 * trim ? [start + trim, end - trim] : [start, end]
    const frames = clip.frames.filter((f) => f.t >= a && f.t <= b)
    try {
      const result = extractAnimation({ ...clip, frames }, id)
      if (result.kind === 'reps' || trim !== EDGE_TRIM_SEC) return result
    } catch (err) {
      if (!(err instanceof ExtractError)) throw err
    }
  }
  return null
}
