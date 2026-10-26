import type { Animation, Joint, Pose } from '../types'
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
// Pass 1, candidates:
//   frames -> body-relative posture per frame (plus whole-body bounce)
//   -> split at gaps (nobody in frame) and camera cuts
//   -> split where the posture or motion pattern changes (compare the few
//      seconds before each moment with the few seconds after)
//   -> label pieces: movement, hold, rest or transition
//   -> merge neighbouring pieces of the same movement; a rest or a break in
//      between makes it another set, a different movement keeps them apart
// Pass 2, verification:
//   -> extend each movement while the same motion continues next to it,
//      then trim it to its first and last rep
//   -> re-examine any uncovered stretch over 3 s for a missed movement
//   -> merge neighbouring fragments of one movement
//   -> clamp to the video and remove overlaps
//   -> rate confidence (high / medium / low) and say why
//   -> flag one-sided movements, and whether the other side follows in the video

export type MovementSet = {
  /** Seconds in the source video. */
  start: number
  end: number
  /** Reps found in this set (0 for holds). */
  reps: number
}

export type Confidence = 'high' | 'medium' | 'low'

export type Movement = {
  /** Seconds in the source video: start of the first set, end of the last. */
  start: number
  end: number
  sets: MovementSet[]
  /** The extracted loop and stats, from the best-tracked set. */
  result: ExtractResult
  /** 'reps' (repeating), 'hold' (visibly still for a sustained time) or 'unclear' (moving, no steady rhythm). */
  kind: 'reps' | 'hold' | 'unclear'
  confidence: Confidence
  /** Plain-language reasons the confidence isn't high (shown with "Check this one"). */
  reasons: string[]
  /** One side of the body does the work (lunge, single-arm row, side plank...). */
  oneSided: boolean
  /** The other side follows right after in the video, so there's no need to add it. */
  bothSidesShown: boolean
}

/** Why the video was cut up the way it was (for the debug file). */
export type DebugLog = {
  pieces: { start: number; end: number; kind: Kind; why: string; motion: number }[]
  decisions: string[]
}

export type ExtractOptions = {
  /** Real length of the video, to clamp timestamps. */
  videoDuration?: number
  /** Filled in with every decision, for the debug file. */
  log?: DebugLog
  /**
   * Analysis speeds to try. 2 = analyse as if the video ran at half speed, so
   * the time-based rules fit fast videos (sped-up reels, quick reps). The
   * clearest result wins; 1 is tried first and kept when it's already clear.
   * Default [1, 2]. "Slow analysis" passes more.
   */
  stretches?: number[]
}

const GAP_SEC = 0.7 // nobody tracked for this long = a break (title card, cut away)
const WINDOW_SEC = 3 // compare this much before vs after each moment
const HOP_SEC = 0.25
const REFINE_SEC = 1 // search +-1 s around each change, with 1 s windows, for the exact moment
const CHANGE_THRESHOLD = 0.75 // how different before/after must be to start a new piece (over-split; merging undoes false splits)
const MIN_SPLIT_GAP_SEC = 2 // two splits at least this far apart
const MIN_MOVE_SEC = 2 // shorter pieces are transitions (getting down to the floor, etc.)
const HOLD_MIN_SEC = 5 // a hold must be visibly still for at least this long
const SAME_MOVE_THRESHOLD = 0.45 // neighbouring pieces closer than this can be one movement...
const SAME_MOVE_LOOSE = 0.9 // ...or up to this, if joining them gives a clearly steadier rhythm
const RHYTHM_GOOD = 0.5 // a part with at least this rhythm score has a clear rhythm of its own
const RHYTHM_DROP = 0.25 // joining two parts that loses this much rhythm means two different movements
const RHYTHM_MIN_SEC = 4 // a rhythm score over less time than this isn't trustworthy
const EXTEND_THRESHOLD = 0.6 // keep extending a movement while its neighbour looks this similar
const EXTEND_WINDOW_SEC = 1.5
const STILL = 0.05 // average spread of posture below this = not moving
const NEW_SET_GAP_SEC = 1.5 // nobody in frame this long between pieces of the same move = a new set
const GAP_CHECK_SEC = 3 // uncovered stretches longer than this get a second look
const UNCLEAR_MIN_SEC = 4 // moving with no rhythm for less than this = a transition, not a movement
const LEFTOVER_MAX_SEC = 5 // leftovers up to this long can be folded into the movement next to them
const BOUNDARY_SEARCH_SEC = 2 // how far a boundary between two movements may move to fit their rhythms
const EDGE_TRIM_SEC = 0.25 // ignore the very edges of a piece (half a transition)
const STILL_REGION = 0.1 // any one body part moving more than this = not a hold (arm-only moves)
const HOLD_STEADY_SHARE = 0.8 // ...and at least this share of each second must be still
const HOLD_MIN_COVERAGE = 0.8 // ...with the body tracked in at least this share of the frames
const CLEAR_ENOUGH = 0.85 // a first result this clear (and nothing low) isn't re-analysed slower
const PREFER_GAIN = 0.05 // a slower analysis must be this much clearer to win

type Frame = { t: number; joints: number[] | null; nose?: { x: number; y: number }; vis?: { lArm: number; rArm: number; lLeg: number; rLeg: number } }
type Feature = { t: number; f: number[]; hip: { x: number; y: number }; spine: number }
type Piece = { start: number; end: number; feats: Feature[]; gapBefore: number }
type Kind = 'move' | 'hold' | 'rest' | 'transition'
type Labelled = Piece & { kind: Kind; why: string; desc: number[] }

/**
 * Posture relative to the hips, in spine lengths. Horizontal offsets are taken
 * as absolute values so turning around (facing left vs right) is not a change.
 *
 * In a clear side view, three more numbers say how far the near wrist, knee
 * and ankle sit ahead of the far ones (in the facing direction), so a left-leg
 * lunge and a right-leg lunge differ. "Near" = the more visible limb, because
 * trackers swap their left/right labels mid-clip.
 */
export function postureFeature(
  j: number[],
  nose?: { x: number; y: number },
  vis?: { lArm: number; rArm: number; lLeg: number; rLeg: number },
): { f: number[]; hip: { x: number; y: number }; spine: number } | null {
  const hx = (j[16] + j[18]) / 2
  const hy = (j[17] + j[19]) / 2
  const spine = Math.hypot(j[2] - hx, j[3] - hy)
  if (!(spine > 1e-6)) return null
  const f: number[] = []
  for (let i = 0; i < 14; i++) f.push(Math.abs(j[2 * i] - hx) / spine, (j[2 * i + 1] - hy) / spine)
  const facingBy = nose ? (nose.x - j[0]) / spine : 0 // nose ahead of the head's centre
  const sideView = Math.abs(facingBy) > 0.08
  const ahead = (l: number, r: number, leftNear: boolean) => {
    if (!sideView) return 0
    const near = leftNear ? j[2 * l] : j[2 * r]
    const far = leftNear ? j[2 * r] : j[2 * l]
    return (Math.sign(facingBy) * (near - far)) / spine
  }
  const armNear = !vis || vis.lArm >= vis.rArm
  const legNear = !vis || vis.lLeg >= vis.rLeg
  f.push(ahead(6, 7, armNear), ahead(10, 11, legNear), ahead(12, 13, legNear))
  return { f, hip: { x: hx, y: hy }, spine }
}

/**
 * Mean posture, how much each part moves, and how much the whole body bounces
 * (calf raises, jumps): what the body is doing, not when.
 */
function describe(feats: Feature[]): number[] {
  const n = feats.length
  const d = feats[0].f.length
  const mean = new Array(d).fill(0)
  for (const x of feats) for (let k = 0; k < d; k++) mean[k] += x.f[k] / n
  const std = new Array(d).fill(0)
  for (const x of feats) for (let k = 0; k < d; k++) std[k] += (x.f[k] - mean[k]) ** 2 / n
  return [...mean, 0, ...std.map((v) => 2 * Math.sqrt(v)), 3 * bounce(feats)]
}

/** Up-and-down movement of the whole body, in spine lengths (camera assumed still). */
function bounce(feats: Feature[]): number {
  const spine = median(feats.map((x) => x.spine))
  const ys = feats.map((x) => x.hip.y / spine)
  const m = ys.reduce((a, b) => a + b, 0) / ys.length
  return 2 * Math.sqrt(ys.reduce((a, y) => a + (y - m) ** 2, 0) / ys.length)
}

const distance = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, k) => s + (v - b[k]) ** 2, 0) / a.length) * 4

/** How much the body moves over a piece: ~0 when holding still. */
function motion(feats: Feature[]): number {
  const desc = describe(feats)
  const half = (desc.length - 2) / 2
  const posture = desc.slice(half + 1, half + 1 + half).reduce((a, b) => a + b, 0) / half / 2
  return Math.max(posture, bounce(feats))
}

// Feature indices: joint i -> [2i] = |dx| / spine, [2i + 1] = dy / spine (y down, relative to the hips).
const DY = (feats: Feature[], joint: number) => median(feats.map((x) => x.f[joint * 2 + 1]))
const NECK = 1
const SHOULDERS = [2, 3]
const ARMS = [4, 5, 6, 7] // elbows, wrists
const KNEES = [10, 11]
const ANKLES = [12, 13]
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/** Still positions that are not exercises: standing, kneeling, sitting, lying on the mat. */
function restPosition(feats: Feature[]): string | null {
  const neck = DY(feats, NECK)
  const knee = mean(KNEES.map((j) => DY(feats, j)))
  const ankle = mean(ANKLES.map((j) => DY(feats, j)))
  const upright = neck < -0.8
  if (upright && ankle > 1.3) return 'standing'
  if (upright && knee > 0.5 && Math.abs(ankle - knee) < 0.3) return 'kneeling'
  if (upright && Math.abs(knee) < 0.35 && Math.abs(ankle) < 0.45) return 'sitting'
  if (Math.abs(neck) < 0.5 && !supported(feats)) return 'lying down'
  return null
}

/** Arms under the shoulders, holding the body up (plank, side plank, push-up hold). */
function supported(feats: Feature[]): boolean {
  const shoulder = mean(SHOULDERS.map((j) => DY(feats, j)))
  return Math.max(...ARMS.map((j) => DY(feats, j))) - shoulder > 0.35
}

/** Runs of tracked frames, broken at gaps and at camera cuts (the body jumps in the frame). */
function runs(frames: Frame[], gapSec = GAP_SEC): { feats: Feature[]; gapBefore: number }[] {
  const out: { feats: Feature[]; gapBefore: number }[] = []
  let cur: Feature[] = []
  let gapBefore = 0
  for (const fr of frames) {
    const p = fr.joints && postureFeature(fr.joints, fr.nose, fr.vis)
    if (!p) continue
    const last = cur[cur.length - 1]
    const gap = last ? fr.t - last.t : 0
    const cut =
      last &&
      Math.hypot(p.hip.x - last.hip.x, p.hip.y - last.hip.y) / last.spine > 0.8 &&
      Math.abs(Math.log(p.spine / last.spine)) > 0.15
    if (last && (gap > gapSec || cut)) {
      out.push({ feats: cur, gapBefore })
      cur = []
      gapBefore = gap
    }
    cur.push({ t: fr.t, ...p })
  }
  if (cur.length) out.push({ feats: cur, gapBefore })
  return out
}

/** Split a run where the before/after posture-and-motion description changes most. */
function splitRun(run: Feature[]): Omit<Piece, 'gapBefore'>[] {
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
  const pieces: Omit<Piece, 'gapBefore'>[] = []
  for (let i = 0; i + 1 < edges.length; i++) {
    const feats = run.filter((x) => x.t >= edges[i] && x.t < edges[i + 1])
    if (feats.length) pieces.push({ start: feats[0].t, end: feats[feats.length - 1].t, feats })
  }
  return pieces
}

// Feature groups per body part (indices into postureFeature's x/y pairs).
const REGIONS: Record<string, number[]> = {
  arms: [4, 5, 6, 7],
  legs: [10, 11, 12, 13],
  torso: [0, 1, 2, 3],
}

/** The most any one body part moves (2 × std, spine lengths). An arm-only move counts as moving. */
function regionMotion(feats: Feature[]): { part: string; m: number } {
  let best = { part: 'body', m: 0 }
  for (const [part, joints] of Object.entries(REGIONS)) {
    let sum = 0
    for (const j of joints) {
      for (const k of [2 * j, 2 * j + 1]) {
        const xs = feats.map((x) => x.f[k])
        const mu = xs.reduce((a, b) => a + b, 0) / xs.length
        sum += 2 * Math.sqrt(xs.reduce((a, v) => a + (v - mu) ** 2, 0) / xs.length)
      }
    }
    const m = sum / (joints.length * 2)
    if (m > best.m) best = { part, m }
  }
  return best
}

/** Not moving: the body as a whole, and every part of it on its own. */
const isStill = (feats: Feature[]) => motion(feats) < STILL && regionMotion(feats).m < STILL_REGION

/** Share of the piece's 1 s stretches that are still: a hold is still the whole way, not on average. */
function steadyShare(feats: Feature[]): number {
  const t0 = feats[0].t
  const t1 = feats[feats.length - 1].t
  let total = 0
  let still = 0
  for (let a = t0; a + 1 <= t1 + 1e-6; a += 1) {
    const w = feats.filter((x) => x.t >= a && x.t < a + 1)
    if (w.length < 3) continue
    total++
    if (motion(w) < STILL * 1.5 && regionMotion(w).m < STILL_REGION) still++ // a little slack for 1 s of tracker noise
  }
  return total ? still / total : 0
}

function classify(p: Piece, fps: number): { kind: Kind; why: string } {
  const dur = p.end - p.start
  if (dur < MIN_MOVE_SEC) return { kind: 'transition', why: `shorter than ${MIN_MOVE_SEC} s` }
  const m = motion(p.feats)
  if (m >= STILL) return { kind: 'move', why: `moving (${m.toFixed(2)})` }
  const part = regionMotion(p.feats)
  if (part.m >= STILL_REGION) return { kind: 'move', why: `only the ${part.part} move (${part.m.toFixed(2)})` }
  const rest = restPosition(p.feats)
  if (rest) return { kind: 'rest', why: `still and ${rest}` }
  if (dur < HOLD_MIN_SEC) return { kind: 'transition', why: `still for only ${dur.toFixed(1)} s; a hold needs ${HOLD_MIN_SEC} s` }
  // A hold must be visibly, steadily still, with the body tracked throughout.
  const coverage = fps > 0 ? p.feats.length / (dur * fps + 1) : 1
  if (coverage < HOLD_MIN_COVERAGE) return { kind: 'transition', why: `still, but the body was tracked in only ${Math.round(coverage * 100)}% of frames` }
  const steady = steadyShare(p.feats)
  if (steady < HOLD_STEADY_SHARE) return { kind: 'transition', why: `still on average, but steady for only ${Math.round(steady * 100)}% of the time` }
  return { kind: 'hold', why: supported(p.feats) ? 'still, held up on the arms' : 'still, in an unusual position' }
}

/**
 * Frames where the tracker repeated its last answer exactly (it does this when
 * it loses the person in a blur). They'd look perfectly still, which is how a
 * hold that isn't there gets in, so they count as "not tracked".
 */
export function dropFrozenFrames(clip: TrackedClip): TrackedClip {
  let prev: TrackedClip['frames'][number]['landmarks'] = null
  let changed = false
  const frames = clip.frames.map((f) => {
    const lm = f.landmarks
    const frozen = !!lm && !!prev && lm.length === prev.length && lm.every((p, i) => p.x === prev![i].x && p.y === prev![i].y)
    prev = lm ?? prev
    if (!frozen) return f
    changed = true
    return { t: f.t, landmarks: null }
  })
  return changed ? { ...clip, frames } : clip
}

/** Typical seconds between frames. */
function frameRate(clip: TrackedClip): number {
  const dts: number[] = []
  for (let i = 1; i < clip.frames.length; i++) dts.push(clip.frames[i].t - clip.frames[i - 1].t)
  const dt = dts.length ? median(dts) : 0
  return dt > 0 ? 1 / dt : 0
}

/** Pass 1: the clip cut into labelled pieces. */
function cutIntoPieces(clip: TrackedClip, gapSec = GAP_SEC): { pieces: Labelled[]; feats: Feature[] } {
  const aspect = clip.width > 0 && clip.height > 0 ? clip.width / clip.height : 1
  const frames: Frame[] = clip.frames.map((f) => {
    const s = landmarksToSample(f.landmarks, aspect)
    return { t: f.t, joints: s?.joints ?? null, nose: s?.nose, vis: s?.vis }
  })
  const rs = runs(frames, gapSec)
  const fps = frameRate(clip)
  const pieces = rs.flatMap((r) =>
    splitRun(r.feats).map((p, i) => {
      const piece: Piece = { ...p, gapBefore: i === 0 ? r.gapBefore : 0 }
      return { ...piece, ...classify(piece, fps), desc: describe(p.feats) }
    }),
  )
  return { pieces, feats: rs.flatMap((r) => r.feats) }
}

/** The change detector's score over time: before-vs-after difference at each moment (for debugging). */
export function changeCurve(clip: TrackedClip): { t: number; d: number }[] {
  const { feats } = cutIntoPieces(clip)
  const out: { t: number; d: number }[] = []
  const window = (a: number, b: number) => feats.filter((x) => x.t >= a && x.t < b)
  for (let t = (feats[0]?.t ?? 0) + WINDOW_SEC; t <= (feats[feats.length - 1]?.t ?? 0) - WINDOW_SEC; t += HOP_SEC) {
    const before = window(t - WINDOW_SEC, t)
    const after = window(t, t + WINDOW_SEC)
    if (before.length >= 5 && after.length >= 5) out.push({ t, d: distance(describe(before), describe(after)) })
  }
  return out
}

/** The pieces a clip is cut into, with their labels (for tests and debugging). */
export function pieceSummary(clip: TrackedClip) {
  let prev: number[] | null = null
  return cutIntoPieces(clip).pieces.map((p) => {
    const fromPrev = prev ? distance(prev, p.desc) : null
    prev = p.desc
    return { start: p.start, end: p.end, kind: p.kind, why: p.why, motion: motion(p.feats), fromPrev }
  })
}

type Group = {
  /** Time ranges of each set. */
  sets: { start: number; end: number }[]
  desc: number[]
  kind: 'move' | 'hold'
  feats: Feature[]
  fromGapCheck?: boolean
}

/**
 * The movements in a tracked clip, in order. Throws ExtractError (with a
 * user-facing message) if there are none.
 *
 * The rules below are in seconds, tuned for videos at normal speed. A sped-up
 * reel squeezes each exercise into too few seconds (two look-alike moves then
 * blur into one), so if the first result isn't clear, the clip is analysed
 * again "slowed down" (its timestamps stretched), and the clearest result
 * wins. Only timestamps change: no video is re-read, and nothing is stored.
 */
export function extractMovements(clip: TrackedClip, idPrefix: string, opts: ExtractOptions = {}): Movement[] {
  const source = dropFrozenFrames(clip)
  const speeds = [...new Set(opts.stretches ?? [1, 2])].filter((k) => k >= 1)
  let best: { k: number; movements: Movement[]; q: number; log: DebugLog } | null = null
  const tried: string[] = []
  for (const k of speeds) {
    if (best && !shouldTrySlower(best)) break
    const log: DebugLog = { pieces: [], decisions: [] }
    let movements: Movement[]
    try {
      movements = extractAtSpeed(stretch(source, k), idPrefix, { videoDuration: opts.videoDuration && opts.videoDuration * k, log }, k).map((m) => unstretch(m, k))
    } catch (e) {
      if (!(e instanceof ExtractError)) throw e
      tried.push(`×${k}: nothing found`)
      continue
    }
    const q = clarity(movements, source)
    tried.push(`×${k}: ${movements.length} movements, clarity ${q.toFixed(2)}`)
    if (!best || isClearer({ k, q }, best)) best = { k, movements, q, log }
  }
  if (!best) {
    throw new ExtractError(
      "Couldn't find a clear exercise in this video. Try a clip where one person does the moves with the whole body in frame.",
    )
  }
  if (opts.log) {
    const k = best.k
    opts.log.pieces.push(...best.log.pieces.map((p) => ({ ...p, start: p.start / k, end: p.end / k })))
    opts.log.decisions.push(
      `Analysis speeds tried: ${tried.join('; ')}. Kept ×${k}${k === 1 ? ' (normal speed)' : ` (as if slowed ${k}×; times in the notes below are at that speed, divide by ${k})`}.`,
      ...best.log.decisions,
    )
  }
  return best.movements
}

/** A normal-speed result that's already clear (and has nothing low) isn't analysed again. */
export function shouldTrySlower(r: { k: number; q: number; movements: Pick<Movement, 'confidence'>[] }): boolean {
  return !(r.k === 1 && r.q >= CLEAR_ENOUGH && r.movements.every((m) => m.confidence !== 'low'))
}

/** A slower analysis has to be clearly better to replace a faster one. */
export function isClearer(a: { k: number; q: number }, b: { k: number; q: number }): boolean {
  return a.q > b.q + (a.k > b.k ? PREFER_GAIN : 0)
}

/** How clear a result is: the share of the video covered by movements, weighted by confidence. */
function clarity(movements: Movement[], clip: TrackedClip): number {
  const span = clip.frames.length ? clip.frames[clip.frames.length - 1].t - clip.frames[0].t : 0
  if (span <= 0) return 0
  const w = { high: 1, medium: 0.6, low: 0.2 }
  return movements.reduce((a, m) => a + w[m.confidence] * (m.end - m.start), 0) / span
}

const stretch = (clip: TrackedClip, k: number): TrackedClip =>
  k === 1 ? clip : { ...clip, frames: clip.frames.map((f) => ({ ...f, t: f.t * k })) }

/** Back to real time: positions, reps and tempo. */
function unstretch(m: Movement, k: number): Movement {
  if (k === 1) return m
  const r = m.result
  return {
    ...m,
    start: m.start / k,
    end: m.end / k,
    sets: m.sets.map((s) => ({ ...s, start: s.start / k, end: s.end / k })),
    result: {
      ...r,
      secPerRep: r.kind === 'reps' ? r.secPerRep / k : r.secPerRep,
      repTimes: r.repTimes.map(([a, b]) => [a / k, b / k] as [number, number]),
      animation: r.kind === 'reps' ? { ...r.animation, defaultTempoSec: r.animation.defaultTempoSec / k } : r.animation,
    },
  }
}

/** One analysis at one speed (k = how much the timestamps were stretched). */
function extractAtSpeed(clip: TrackedClip, idPrefix: string, opts: ExtractOptions, k: number): Movement[] {
  const log = opts.log
  const note = (msg: string) => log?.decisions.push(msg)
  // Tracking gaps are real time, not tempo: a 0.7 s blur is a 0.7 s blur at any speed.
  const { pieces, feats } = cutIntoPieces(clip, GAP_SEC * k)
  const newSetGap = NEW_SET_GAP_SEC * k
  for (const p of pieces) log?.pieces.push({ start: p.start, end: p.end, kind: p.kind, why: p.why, motion: motion(p.feats) })

  // Rhythm of a stretch: how clearly it repeats (0 = no rhythm). Two different
  // movements joined together lose the steady rhythm each has on its own.
  const rhythmCache = new Map<string, number>()
  const rhythm = (a: number, b: number) => {
    if (b - a < RHYTHM_MIN_SEC) return 0
    const key = `${a.toFixed(2)}-${b.toFixed(2)}`
    if (!rhythmCache.has(key)) {
      const r = tryExtract(clip, a, b, 'rhythm')
      rhythmCache.set(key, r?.kind === 'reps' ? r.confidence : 0)
    }
    return rhythmCache.get(key)!
  }
  /** A short stretch is a real movement only if it shows 2.5+ clean repetitions (a burst of jacks). */
  const clearShortBurst = (a: number, b: number) => {
    const r = tryExtract(clip, a, b, 'burst')
    return !!r && r.kind === 'reps' && r.confidence >= 0.7 && (b - a) / r.secPerRep >= 2.5
  }
  /** Same movement continuing? Looks alike, and joining keeps (or improves) the rhythm. */
  const sameMovement = (a: { start: number; end: number; desc: number[] }, b: { start: number; end: number; desc: number[] }) => {
    const d = distance(a.desc, b.desc)
    if (d >= SAME_MOVE_LOOSE) return { same: false, why: 'looks different' }
    const ra = rhythm(a.start, a.end)
    const rb = rhythm(b.start, b.end)
    const joined = rhythm(a.start, b.end)
    if (ra >= RHYTHM_GOOD && rb >= RHYTHM_GOOD && joined < Math.min(ra, rb) - RHYTHM_DROP) {
      return { same: false, why: `looks alike, but each has its own rhythm (${ra.toFixed(2)}, ${rb.toFixed(2)}) and together they don't (${joined.toFixed(2)})` }
    }
    if (d < SAME_MOVE_THRESHOLD) return { same: true, why: 'looks the same' }
    // A slow rep cut in half has no rhythm in either half; joined, it repeats.
    if (joined >= RHYTHM_GOOD && joined >= Math.max(ra, rb) - 0.1) return { same: true, why: `together they repeat steadily (${joined.toFixed(2)})` }
    return { same: false, why: 'looks different' }
  }

  // ---- Pass 1: group pieces into candidate movements ----
  const groups: Group[] = []
  const leftovers: { start: number; end: number }[] = [] // time that isn't (yet) part of any movement
  let paused = false // a rest or a break since the last movement piece
  for (const p of pieces) {
    const prev = groups[groups.length - 1]
    const pause = paused || p.gapBefore >= newSetGap
    const similar = prev && distance(prev.desc, p.desc) < SAME_MOVE_THRESHOLD
    const lastSet = prev?.sets[prev.sets.length - 1]
    if (p.kind === 'rest') {
      paused = true
      note(`${t(p.start)}–${t(p.end)}: rest (${p.why})`)
      continue
    }
    if (p.kind === 'transition') {
      // A short piece that looks like the movement before it is just its end; absorb it.
      if (similar && !pause) {
        prev.sets[prev.sets.length - 1].end = p.end
        prev.feats.push(...p.feats)
        note(`${t(p.start)}–${t(p.end)}: transition, absorbed into the movement before it`)
      } else {
        note(`${t(p.start)}–${t(p.end)}: transition, not part of a movement yet (${p.why})`)
        if (!pause) leftovers.push({ start: p.start, end: p.end })
      }
      continue
    }
    const verdict =
      prev && prev.kind === p.kind
        ? p.kind === 'hold' || pause
          ? { same: !!similar, why: similar ? 'looks the same' : 'looks different' }
          : sameMovement({ start: lastSet!.start, end: lastSet!.end, desc: prev.desc }, p)
        : null
    if (prev && verdict?.same) {
      if (pause) prev.sets.push({ start: p.start, end: p.end })
      else prev.sets[prev.sets.length - 1].end = p.end
      prev.feats.push(...p.feats)
      prev.desc = describe(prev.feats)
      note(`${t(p.start)}–${t(p.end)}: same movement as before (${verdict.why}), ${pause ? 'new set (after a rest or break)' : 'same set'}`)
    } else {
      groups.push({ sets: [{ start: p.start, end: p.end }], desc: p.desc, kind: p.kind as 'move' | 'hold', feats: [...p.feats] })
      note(`${t(p.start)}–${t(p.end)}: new ${p.kind === 'hold' ? 'hold' : 'movement'} candidate (${p.why})${verdict ? `; not joined to the one before: ${verdict.why}` : ''}`)
    }
    paused = false
  }

  // ---- Pass 2a: drop candidates that aren't exercises, before anything else grows into their time ----
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]
    if (g.kind !== 'move') continue
    const where = `${t(g.sets[0].start)}–${t(g.sets[g.sets.length - 1].end)}`
    if (g.sets.some((s) => rhythm(s.start, s.end) > 0 || clearShortBurst(s.start, s.end))) continue
    const length = g.sets.reduce((n, s) => n + (s.end - s.start), 0)
    if (restPosition(g.feats) === 'standing') {
      note(`${where}: not a movement on its own: standing and moving without any repeating rhythm`)
      groups.splice(i, 1)
      leftovers.push(...g.sets)
    } else if (length < UNCLEAR_MIN_SEC) {
      note(`${where}: not a movement on its own: only ${length.toFixed(1)} s of movement with no rhythm`)
      groups.splice(i, 1)
      leftovers.push(...g.sets)
    }
  }

  // ---- Pass 2a': a short leftover next to a movement is often its first or last rep ----
  // Between two movements it usually holds the end of one and the start of the
  // next, so split it where both neighbours keep their steadiest rhythm.
  const moveSets = () => groups.filter((g) => g.kind === 'move').flatMap((g) => g.sets)
  const joinedLeftovers: { start: number; end: number }[] = []
  for (const lo of leftovers.sort((a, b) => a.start - b.start)) {
    const last = joinedLeftovers[joinedLeftovers.length - 1]
    if (last && lo.start - last.end < 0.3) last.end = Math.max(last.end, lo.end)
    else joinedLeftovers.push({ ...lo })
  }
  for (const lo of joinedLeftovers) {
    if (lo.end - lo.start > LEFTOVER_MAX_SEC) {
      note(`${t(lo.start)}–${t(lo.end)}: dropped (walking about, adjusting, or a transition)`)
      continue
    }
    const before = moveSets().find((st) => Math.abs(lo.start - st.end) < 0.6)
    const after = moveSets().find((st) => Math.abs(st.start - lo.end) < 0.6)
    if (!before && !after) {
      note(`${t(lo.start)}–${t(lo.end)}: dropped (walking about, adjusting, or a transition)`)
      continue
    }
    // Split it where both neighbours keep their steadiest rhythm. The whole
    // leftover is shared out: better to include a second of transition than to
    // cut off someone's first or last rep.
    let best: { cut: number; score: number } | null = null
    for (let cut = lo.start; cut <= lo.end + 1e-6; cut += HOP_SEC) {
      const a = before ? rhythm(before.start, cut) : 0
      const b = after ? rhythm(cut, after.end) : 0
      const okA = !before || cut === lo.start || a >= Math.max(RHYTHM_GOOD, rhythm(before.start, before.end) - 0.3)
      const okB = !after || cut >= lo.end - 1e-6 || b >= Math.max(RHYTHM_GOOD, rhythm(after.start, after.end) - 0.3)
      if (!okA || !okB) continue
      if (!best || a + b > best.score + 1e-9) best = { cut, score: a + b }
    }
    if (!best) {
      note(`${t(lo.start)}–${t(lo.end)}: not part of either neighbour (it would break their rhythm)`)
      continue
    }
    if (before && best.cut > lo.start) before.end = best.cut
    if (after && best.cut < lo.end) after.start = best.cut
    note(`${t(lo.start)}–${t(lo.end)}: leftover shared out at ${t(best.cut)} between the movements before and after (keeping their rhythm)`)
  }

  // ---- Pass 2a'': where two movements meet directly, put the boundary where both repeat most steadily ----
  {
    const sets = moveSets().sort((a, b) => a.start - b.start)
    for (let i = 0; i + 1 < sets.length; i++) {
      const a = sets[i]
      const b = sets[i + 1]
      if (b.start - a.end > 0.6) continue
      const current = (a.end + b.start) / 2
      const score = (cut: number) => rhythm(a.start, cut) + rhythm(cut, b.end)
      const here = score(current)
      const tried: { cut: number; score: number }[] = []
      for (let cut = current - BOUNDARY_SEARCH_SEC; cut <= current + BOUNDARY_SEARCH_SEC + 1e-6; cut += HOP_SEC) {
        if (cut - a.start < RHYTHM_MIN_SEC || b.end - cut < RHYTHM_MIN_SEC) continue
        tried.push({ cut, score: score(cut) })
      }
      const top = Math.max(here, ...tried.map((x) => x.score))
      // Rhythm scores level off near their best, so of the near-best cuts take
      // the one closest to where the change detector put it.
      const best = tried
        .filter((x) => x.score >= top - 0.03)
        .sort((x, y) => Math.abs(x.cut - current) - Math.abs(y.cut - current))[0] ?? { cut: current, score: here }
      if (best.score > here + 0.1 && Math.abs(best.cut - current) > 0.2) {
        note(`${t(current)}: boundary moved to ${t(best.cut)}, where both movements repeat most steadily (${here.toFixed(2)} → ${best.score.toFixed(2)})`)
        a.end = best.cut
        b.start = best.cut
      }
    }
  }

  // ---- Pass 2b: extend each movement through neighbouring stretches of the same motion ----
  const restRanges = pieces.filter((p) => p.kind === 'rest').map((p) => [p.start, p.end] as const)
  const taken = () => [...groups.flatMap((g) => g.sets.map((s) => [s.start, s.end] as const)), ...restRanges]
  for (const [gi, g] of groups.entries()) {
    if (g.kind !== 'move') continue
    const first = g.sets[0]
    const last = g.sets[g.sets.length - 1]
    const others = taken().filter(([a, b]) => b <= first.start - 1e-6 || a >= last.end + 1e-6)
    const before = Math.max(-Infinity, ...others.filter(([, b]) => b <= first.start).map(([, b]) => b))
    const after = Math.min(Infinity, ...others.filter(([a]) => a >= last.end).map(([a]) => a))
    // Time between two movements goes to whichever neighbour it looks more like.
    const similarAt = (a: number, b: number, neighbour?: Group) => {
      const w = feats.filter((x) => x.t >= a && x.t < b)
      if (w.length < 5) return false
      const d = describe(w)
      const mine = distance(d, g.desc)
      return mine < EXTEND_THRESHOLD && (!neighbour || mine <= distance(d, neighbour.desc))
    }
    const prevGroup = groups[gi - 1]
    const nextGroup = groups[gi + 1]
    const stillAt = (a: number, b: number) => {
      const w = feats.filter((x) => x.t >= a && x.t < b)
      return w.length >= 5 && isStill(w)
    }
    const s0 = first.start
    const e0 = last.end
    while (first.start - HOP_SEC > before && similarAt(first.start - EXTEND_WINDOW_SEC, first.start, prevGroup)) first.start -= HOP_SEC
    while (last.end + HOP_SEC < after && similarAt(last.end, last.end + EXTEND_WINDOW_SEC, nextGroup)) last.end += HOP_SEC
    // ...and don't start or end on a stretch of standing or lying still (even
    // if the edge itself catches the last moment of the move before).
    for (let a = first.start; a <= first.start + 1 + 1e-6; a += HOP_SEC) {
      if (!stillAt(a, a + EXTEND_WINDOW_SEC)) continue
      let u = a
      while (u + EXTEND_WINDOW_SEC < first.end && stillAt(u, u + EXTEND_WINDOW_SEC)) u += HOP_SEC
      first.start = u
      break
    }
    for (let b = last.end; b >= last.end - 1 - 1e-6; b -= HOP_SEC) {
      if (!stillAt(b - EXTEND_WINDOW_SEC, b)) continue
      let u = b
      while (u - EXTEND_WINDOW_SEC > last.start && stillAt(u - EXTEND_WINDOW_SEC, u)) u -= HOP_SEC
      last.end = u
      break
    }
    if (Math.abs(first.start - s0) > 1e-6 || Math.abs(last.end - e0) > 1e-6) {
      note(`${t(s0)}–${t(e0)}: range adjusted to ${t(first.start)}–${t(last.end)} (same motion continues next to it, or still at the edges)`)
    }
  }

  // ---- Pass 2c: re-examine uncovered stretches for a missed movement ----
  const tracked = feats.length ? [feats[0].t, feats[feats.length - 1].t] : [0, 0]
  const covered = taken().sort((a, b) => a[0] - b[0])
  let cursor = tracked[0]
  const gaps: [number, number][] = []
  for (const [a, b] of [...covered, [tracked[1], tracked[1]] as const]) {
    if (a - cursor > GAP_CHECK_SEC) gaps.push([cursor, a])
    cursor = Math.max(cursor, b)
  }
  for (const [a, b] of gaps) {
    const w = feats.filter((x) => x.t >= a && x.t <= b)
    if (w.length < 10) {
      note(`${t(a)}–${t(b)}: uncovered, but nobody is in frame (intro, title card or cut away)`)
      continue
    }
    if (isStill(w)) {
      note(`${t(a)}–${t(b)}: uncovered, body is still (${restPosition(w) ?? 'not a clear hold'}): not a movement`)
      continue
    }
    const r = rhythm(w[0].t, w[w.length - 1].t)
    if (r < RHYTHM_GOOD && (restPosition(w) === 'standing' || b - a < UNCLEAR_MIN_SEC)) {
      note(`${t(a)}–${t(b)}: uncovered and moving, but nothing repeats there: not a movement`)
      continue
    }
    groups.push({ sets: [{ start: w[0].t, end: w[w.length - 1].t }], desc: describe(w), kind: 'move', feats: w, fromGapCheck: true })
    note(`${t(a)}–${t(b)}: uncovered and moving, re-examined as a possible missed movement (rhythm ${r.toFixed(2)})`)
  }
  groups.sort((x, y) => x.sets[0].start - y.sets[0].start)

  // ---- Pass 2d: extract each set, trim to first/last rep, rate confidence ----
  type Built = Movement & { desc: number[]; groupKind: Group['kind']; feats: Feature[] }
  const built: Built[] = []
  for (const [gi, g] of groups.entries()) {
    const sets = g.sets.map((s, si) => {
      const result = tryExtract(clip, s.start, s.end, `${idPrefix}-${gi + 1}-${si + 1}`)
      const reps = result?.kind === 'reps' ? result.repTimes : []
      // A set runs from its first rep to its last. Partial reps at the edges
      // aren't counted, so allow up to one rep of slack before trimming.
      const slack = result?.secPerRep ?? 0
      const start = g.kind === 'move' && reps.length ? Math.max(s.start, reps[0][0] - slack) : s.start
      const end = g.kind === 'move' && reps.length ? Math.min(s.end, reps[reps.length - 1][1] + slack) : s.end
      return { start, end, reps: reps.length, result }
    })
    const usable = sets.filter((s) => s.result)
    const where = `${t(g.sets[0].start)}–${t(g.sets[g.sets.length - 1].end)}`
    if (usable.length === 0) {
      note(`${where}: dropped, the body couldn't be tracked well enough to extract it`)
      continue
    }
    // Animate from the set that tracked best: most reps, then clearest rhythm.
    const best = usable.reduce((a, b) =>
      b.result!.repsFound * (0.5 + b.result!.confidence) > a.result!.repsFound * (0.5 + a.result!.confidence) ? b : a,
    )
    const result = best.result!
    const rhythmless = g.kind === 'move' && result.kind !== 'reps'
    if (rhythmless && restPosition(g.feats) === 'standing') {
      note(`${where}: dropped, standing and moving without any repeating rhythm (walking about, adjusting)`)
      continue
    }
    const length = g.sets.reduce((n, s) => n + (s.end - s.start), 0)
    if (rhythmless && length < UNCLEAR_MIN_SEC) {
      note(`${where}: dropped, only ${length.toFixed(1)} s of movement with no rhythm (a transition)`)
      continue
    }
    const { confidence, reasons } = rate(g, result, sets.reduce((n, s) => n + s.reps, 0))
    built.push({
      start: sets[0].start,
      end: sets[sets.length - 1].end,
      sets: sets.map(({ start, end, reps }) => ({ start, end, reps })),
      result,
      kind: g.kind === 'hold' ? 'hold' : rhythmless ? 'unclear' : 'reps',
      confidence,
      reasons,
      oneSided: false,
      bothSidesShown: false,
      desc: g.desc,
      groupKind: g.kind,
      feats: g.feats,
    })
    note(`${where}: kept as ${result.kind === 'reps' ? `${result.repsFound} reps at ${result.secPerRep} s` : 'a hold'}, confidence ${confidence}${reasons.length ? ` (${reasons.join('; ')})` : ''}`)
  }

  // ---- Pass 2e: merge neighbouring fragments of one movement ----
  for (let i = 0; i + 1 < built.length; ) {
    const a = built[i]
    const b = built[i + 1]
    if (a.groupKind === b.groupKind && a.kind === b.kind && sameMovement(a, b).same) {
      const restBetween = restRanges.some(([s, e]) => s >= a.end - 1e-6 && e <= b.start + 1e-6)
      if (restBetween) a.sets.push(...b.sets)
      else a.sets[a.sets.length - 1] = { ...a.sets[a.sets.length - 1], end: b.sets[0].end, reps: a.sets[a.sets.length - 1].reps + b.sets[0].reps }
      if (!restBetween) a.sets.push(...b.sets.slice(1))
      a.end = b.end
      if (b.result.repsFound > a.result.repsFound) a.result = b.result
      a.reasons = [...new Set([...a.reasons, ...b.reasons])]
      a.confidence = worst(a.confidence, b.confidence)
      note(`${t(a.start)}–${t(b.end)}: two neighbouring fragments of the same movement merged`)
      built.splice(i + 1, 1)
    } else i++
  }

  // ---- Pass 2f: clamp to the video and remove overlaps ----
  const lo = clip.frames.length ? clip.frames[0].t : 0
  const hi = Math.min(clip.frames.length ? clip.frames[clip.frames.length - 1].t : 0, opts.videoDuration ?? Infinity)
  built.sort((a, b) => a.start - b.start)
  built.forEach((m, i) => {
    const next = built[i + 1]
    const limit = next ? Math.min(hi, next.start) : hi
    m.start = Math.max(lo, Math.min(m.start, limit))
    m.end = Math.max(m.start, Math.min(m.end, limit))
    m.sets = m.sets.map((s) => ({ ...s, start: Math.max(m.start, s.start), end: Math.min(m.end, s.end) }))
  })

  // ---- One-sided movements, and whether the other side follows in the video ----
  for (const m of built) m.oneSided = sidedness(m.result.animation).oneSided
  for (let i = 0; i + 1 < built.length; i++) {
    const a = built[i]
    const b = built[i + 1]
    if (a.oneSided && b.oneSided && isOtherSide(a.result.animation, b.result.animation)) {
      a.bothSidesShown = b.bothSidesShown = true
      note(`${t(a.start)}–${t(b.end)}: one movement done on both sides, back to back`)
    }
  }

  if (built.length === 0) {
    throw new ExtractError(
      "Couldn't find a clear exercise in this video. Try a clip where one person does the moves with the whole body in frame.",
    )
  }
  return built.map(({ desc: _d, groupKind: _k, feats: _f, ...m }) => m)
}

/**
 * One movement from a time range you chose (editing a range, or adding a
 * missed movement by hand). Null if the body can't be tracked there.
 */
export function extractRange(rawClip: TrackedClip, start: number, end: number, id: string): Movement | null {
  const clip = dropFrozenFrames(rawClip)
  const result = tryExtract(clip, start, end, id)
  if (!result) return null
  const reps = result.kind === 'reps' ? result.repsFound : 0
  const aspect = clip.width > 0 && clip.height > 0 ? clip.width / clip.height : 1
  const feats = clip.frames
    .filter((f) => f.t >= start && f.t <= end)
    .map((f) => {
      const s = landmarksToSample(f.landmarks, aspect)
      const p = s && postureFeature(s.joints, s.nose, s.vis)
      return p && { t: f.t, ...p }
    })
    .filter((x): x is Feature => !!x)
  // Same rules as detected movements; a range you chose is still checked.
  const group: Group = { sets: [{ start, end }], desc: [], kind: result.kind === 'hold' && isStill(feats) ? 'hold' : 'move', feats }
  const { confidence, reasons } = rate(group, result, reps)
  return {
    start,
    end,
    sets: [{ start, end, reps }],
    result,
    kind: group.kind === 'hold' ? 'hold' : result.kind === 'reps' ? 'reps' : 'unclear',
    confidence,
    reasons,
    oneSided: sidedness(result.animation).oneSided,
    bothSidesShown: false,
  }
}

function rate(g: Group, result: ExtractResult, totalReps: number): { confidence: Confidence; reasons: string[] } {
  const reasons: string[] = []
  let level = 2 // 2 high, 1 medium, 0 low
  if (g.fromGapCheck) {
    reasons.push('found on a second look at a stretch the first pass skipped')
    level = 0
  }
  if (g.kind === 'hold') {
    const dur = Math.max(...g.sets.map((s) => s.end - s.start))
    if (!supported(g.feats)) {
      reasons.push("held still in an unusual position, so check it's really an exercise")
      level = 0
    } else if (dur < 8) {
      reasons.push(`a short hold (${Math.round(dur)} s)`)
      level = Math.min(level, 1)
    }
  } else if (result.kind !== 'reps') {
    reasons.push('no steady rhythm found, so check the range and the type')
    level = 0
  } else {
    if (result.confidence < 0.4) {
      reasons.push('the reps are irregular')
      level = 0
    } else if (result.confidence < 0.6) {
      reasons.push('the reps are a bit irregular')
      level = Math.min(level, 1)
    }
    if (totalReps < 3) {
      reasons.push(`only ${totalReps} rep${totalReps === 1 ? '' : 's'} found`)
      level = Math.min(level, 1)
    }
  }
  if (result.coverage < 0.8) {
    reasons.push('the body was lost in some frames')
    level = Math.max(0, level - 1)
  }
  return { confidence: (['low', 'medium', 'high'] as const)[level], reasons }
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }
const worst = (a: Confidence, b: Confidence) => (RANK[a] <= RANK[b] ? a : b)

const LIMB_PAIRS: [Joint, Joint][] = [
  ['lElbow', 'rElbow'],
  ['lWrist', 'rWrist'],
  ['lKnee', 'rKnee'],
  ['lAnkle', 'rAnkle'],
]

/** Average position of each limb relative to the hips, in spine lengths (front view: right side mirrored). */
function limbLayout(anim: Animation, swap = false): { x: number; y: number }[] {
  const spine = median(anim.loop.map(({ pose }) => Math.hypot(pose.neck.x - hipOf(pose).x, pose.neck.y - hipOf(pose).y)))
  const out: { x: number; y: number }[] = []
  for (const [l, r] of LIMB_PAIRS) {
    for (const [j, isRight] of [
      [swap ? r : l, swap],
      [swap ? l : r, !swap],
    ] as const) {
      const pts = anim.loop.map(({ pose }) => {
        const h = hipOf(pose)
        const dx = (pose[j].x - h.x) / spine
        return { x: anim.view === 'front' && isRight ? -dx : dx, y: (pose[j].y - h.y) / spine }
      })
      out.push({ x: mean(pts.map((p) => p.x)), y: mean(pts.map((p) => p.y)) })
    }
  }
  return out
}

const hipOf = (p: Pose) => ({ x: (p.lHip.x + p.rHip.x) / 2, y: (p.lHip.y + p.rHip.y) / 2 })

/**
 * One side of the body does the work. From the side: left and right limbs sit
 * in clearly different places (one leg forward). From the front, where a
 * slight camera angle shifts left and right apart anyway: one leg or arm moves
 * much more than the other.
 */
export function sidedness(anim: Animation): { oneSided: boolean; score: number } {
  if (anim.view === 'side') {
    const layout = limbLayout(anim)
    let score = 0
    for (let i = 0; i < layout.length; i += 2) {
      score = Math.max(score, Math.hypot(layout[i].x - layout[i + 1].x, layout[i].y - layout[i + 1].y))
    }
    return { oneSided: score > 0.5, score }
  }
  const spine = median(anim.loop.map(({ pose }) => Math.hypot(pose.neck.x - hipOf(pose).x, pose.neck.y - hipOf(pose).y)))
  const travel = (j: Joint) => {
    const pts = anim.loop.map(({ pose }) => ({ x: (pose[j].x - hipOf(pose).x) / spine, y: (pose[j].y - hipOf(pose).y) / spine }))
    const mx = mean(pts.map((p) => p.x))
    const my = mean(pts.map((p) => p.y))
    return 2 * Math.sqrt(mean(pts.map((p) => (p.x - mx) ** 2 + (p.y - my) ** 2)))
  }
  let score = 0
  for (const [l, r] of LIMB_PAIRS) {
    const a = travel(l)
    const b = travel(r)
    if (Math.max(a, b) < 0.4) continue // neither moves much: says nothing
    score = Math.max(score, 1 - Math.min(a, b) / Math.max(a, b))
  }
  return { oneSided: score > 0.45, score }
}

/** b is a's movement with left and right swapped (the other side). */
function isOtherSide(a: Animation, b: Animation): boolean {
  const la = limbLayout(a)
  const lb = limbLayout(b, true)
  const diff = mean(la.map((p, i) => Math.hypot(p.x - lb[i].x, p.y - lb[i].y)))
  return diff < 0.3
}

const t = (sec: number) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, '0')}`

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
