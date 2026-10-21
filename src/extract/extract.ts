import { BODY } from '../animation/rig'
import { JOINTS, type Animation, type Joint, type Pose } from '../types'

// Turns pose-tracking output for a clip into a looping Animation the player
// can use as-is. Pure functions only, no DOM, so it's unit-tested end to end.
//
//   landmarks per frame -> our 14 joints -> fill gaps, resample, smooth
//   -> detect view (front/side), facing and near side
//   -> find the repeating motion (PCA + autocorrelation) and cut it into reps
//   -> average the consistent reps into one clean, closed loop
//   -> scale and place it in the normalized 0..1 frame

/** One MediaPipe landmark, normalized to the video frame (0..1 on each axis). */
export type Landmark = { x: number; y: number; z: number; visibility?: number }

/** Tracker output for a clip. `landmarks` is null where no person was found. */
export type TrackedClip = {
  width: number
  height: number
  frames: { t: number; landmarks: Landmark[] | null }[]
}

export type ExtractResult = {
  animation: Animation
  /** 'reps': a repeating movement was found. 'hold': no repetition (plank, wall sit...). */
  kind: 'reps' | 'hold'
  /** Complete reps found in the clip (0 for holds). */
  repsFound: number
  /** Seconds per rep as performed in the clip (loop length for holds). */
  secPerRep: number
  view: 'front' | 'side'
  /** Fraction of frames where a person was tracked. */
  coverage: number
  /** 0..1, how clearly periodic the motion is. */
  confidence: number
  /** Start and end of each detected rep, in source-video seconds (empty for holds). */
  repTimes: [number, number][]
}

/** A problem with the clip itself; `message` is written for the user. */
export class ExtractError extends Error {}

// MediaPipe Pose landmark indices.
const MP = {
  nose: 0,
  lEar: 7,
  rEar: 8,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
} as const

const LEFT = [MP.lShoulder, MP.lElbow, MP.lWrist, MP.lHip, MP.lKnee, MP.lAnkle]
const RIGHT = [MP.rShoulder, MP.rElbow, MP.rWrist, MP.rHip, MP.rKnee, MP.rAnkle]
const MIN_VISIBILITY = 0.5

const FPS = 30 // internal resampling rate
const LOOP_KEYS = 36 // keyframes in the extracted loop
const HOLD_LOOP_SEC = 4 // a slow breath for holds
const N = JOINTS.length * 2

/** Per-frame data after mapping: joints flattened [x0, y0, x1, y1, ...] in JOINTS order. */
type Sample = {
  joints: number[]
  nose: { x: number; y: number }
  /** Mean depth of each side's landmarks (MediaPipe z, smaller = closer). */
  lz: number
  rz: number
  /** Visibility of each arm (elbow, wrist) and leg (knee, ankle). */
  vis: { lArm: number; rArm: number; lLeg: number; rLeg: number }
}

/**
 * MediaPipe's 33 landmarks -> our 14 joints, in units of video height
 * (x is scaled by the aspect ratio so both axes share a unit). The head joint
 * is the midpoint of the ears (centre of the head); the neck is the midpoint
 * of the shoulders.
 */
export function landmarksToSample(lm: Landmark[] | null, aspect: number): Sample | null {
  if (!lm || lm.length <= MP.rAnkle) return null
  // Need the torso: at least one shoulder and one hip (from the side, the far ones are hidden).
  const seen = (i: number) => (lm[i].visibility ?? 1) >= MIN_VISIBILITY
  if (!(seen(MP.lShoulder) || seen(MP.rShoulder)) || !(seen(MP.lHip) || seen(MP.rHip))) return null
  const p = (i: number) => ({ x: lm[i].x * aspect, y: lm[i].y })
  const mid = (a: number, b: number) => ({ x: ((lm[a].x + lm[b].x) / 2) * aspect, y: (lm[a].y + lm[b].y) / 2 })
  const pose: Pose = {
    head: mid(MP.lEar, MP.rEar),
    neck: mid(MP.lShoulder, MP.rShoulder),
    lShoulder: p(MP.lShoulder),
    rShoulder: p(MP.rShoulder),
    lElbow: p(MP.lElbow),
    rElbow: p(MP.rElbow),
    lWrist: p(MP.lWrist),
    rWrist: p(MP.rWrist),
    lHip: p(MP.lHip),
    rHip: p(MP.rHip),
    lKnee: p(MP.lKnee),
    rKnee: p(MP.rKnee),
    lAnkle: p(MP.lAnkle),
    rAnkle: p(MP.rAnkle),
  }
  const meanZ = (idx: number[]) => idx.reduce((s, i) => s + lm[i].z, 0) / idx.length
  const vis = (a: number, b: number) => ((lm[a].visibility ?? 1) + (lm[b].visibility ?? 1)) / 2
  return {
    joints: poseToVec(pose),
    nose: p(MP.nose),
    lz: meanZ(LEFT),
    rz: meanZ(RIGHT),
    vis: {
      lArm: vis(MP.lElbow, MP.lWrist),
      rArm: vis(MP.rElbow, MP.rWrist),
      lLeg: vis(MP.lKnee, MP.lAnkle),
      rLeg: vis(MP.rKnee, MP.rAnkle),
    },
  }
}

export function extractAnimation(clip: TrackedClip, id: string): ExtractResult {
  const aspect = clip.width > 0 && clip.height > 0 ? clip.width / clip.height : 1
  const raw = clip.frames.map((f) => ({ t: f.t, s: landmarksToSample(f.landmarks, aspect) }))
  const found = raw.filter((r) => r.s) as { t: number; s: Sample }[]
  const coverage = raw.length ? found.length / raw.length : 0
  if (found.length < 10 || coverage < 0.5) {
    throw new ExtractError(
      "Couldn't find a person in most of this clip. Try one where the whole body stays in frame, with steady lighting.",
    )
  }

  // 1. Uniform 30 fps, gaps filled by interpolating between tracked frames.
  let samples = resample(found, FPS)
  // 2. Remove one-off tracking spikes, then lightly smooth the jitter (keeps the timing of the move).
  samples = smooth(despike(samples, 2), 1.5)

  // 3. View: from the side, the shoulders overlap; from the front, they're wide.
  const spine = median(samples.map((s) => spineLength(s.joints)))
  if (!(spine > 0)) throw new ExtractError("Couldn't make out the body's proportions in this clip.")
  const shoulderWidth = median(samples.map((s) => Math.hypot(s.joints[4] - s.joints[6], s.joints[5] - s.joints[7])))
  const view: 'front' | 'side' = shoulderWidth / spine < 0.4 ? 'side' : 'front'

  if (view === 'side') {
    // The player draws the figure's left side as the near side: swap if the
    // camera sees the right side. The hidden side's limbs are guessed by the
    // tracker and score lower visibility, which is the most reliable signal;
    // fall back to depth (z, smaller = closer) when visibility can't tell.
    const visGap = median(samples.map((s) => (s.vis.rArm + s.vis.rLeg - s.vis.lArm - s.vis.lLeg) / 2))
    const rightIsNear = Math.abs(visGap) > 0.05 ? visGap > 0 : median(samples.map((s) => s.rz - s.lz)) < 0
    if (rightIsNear) samples = samples.map((s) => swapGroup(swapGroup(s, ARM), LEG))
    samples = fixLimbIdentity(samples)
    // Library side views face right; mirror if the person faces left.
    const facing = median(samples.map((s) => s.nose.x - s.joints[0]))
    if (facing < -0.05 * spine) samples = samples.map(mirrorX)
  }

  // 4. Scale so the spine matches the library's body proportions.
  const k = BODY.spine / spine
  const X = samples.map((s) => s.joints.map((v) => v * k))

  // 5. Find the repeating movement.
  const signal = principalSignal(X)
  const period = findPeriod(signal, FPS)
  const cycles = period ? findCycles(signal, period.lag) : []

  let loop: Animation['loop']
  let kind: ExtractResult['kind']
  let secPerRep: number
  if (period && cycles.length >= 1) {
    const template = averageCycles(X, cycles)
    loop = template.map((joints, i) => ({ t: i / LOOP_KEYS, pose: vecToPose(joints) }))
    kind = 'reps'
    // The autocorrelation period averages over the whole clip, so it's steadier
    // than any single rep's length.
    secPerRep = period.lag / FPS
  } else {
    loop = holdLoop(medianPose(X))
    kind = 'hold'
    secPerRep = HOLD_LOOP_SEC
  }
  loop.push({ t: 1, pose: clonePose(loop[0].pose) })
  fitToFrame(loop)

  const t0 = found[0].t
  return {
    animation: { id, view, defaultTempoSec: round(secPerRep, 2), loop },
    repTimes: kind === 'reps' ? cycles.map(([a, b]) => [round(t0 + a / FPS, 3), round(t0 + b / FPS, 3)]) : [],
    kind,
    repsFound: kind === 'reps' ? cycles.length : 0,
    secPerRep: round(secPerRep, 2),
    view,
    coverage,
    confidence: period ? round(Math.max(0, period.score), 2) : 0,
  }
}

// ---------- pose <-> vector ----------

export function poseToVec(p: Pose): number[] {
  const v: number[] = []
  for (const j of JOINTS) v.push(p[j].x, p[j].y)
  return v
}

export function vecToPose(v: number[]): Pose {
  const p = {} as Pose
  JOINTS.forEach((j, i) => (p[j] = { x: v[i * 2], y: v[i * 2 + 1] }))
  return p
}

const clonePose = (p: Pose): Pose => vecToPose(poseToVec(p))
const J = (name: Joint) => JOINTS.indexOf(name) * 2

function spineLength(v: number[]): number {
  const hx = (v[J('lHip')] + v[J('rHip')]) / 2
  const hy = (v[J('lHip') + 1] + v[J('rHip') + 1]) / 2
  return Math.hypot(v[J('neck')] - hx, v[J('neck') + 1] - hy)
}

const ARM: [Joint, Joint][] = [
  ['lShoulder', 'rShoulder'],
  ['lElbow', 'rElbow'],
  ['lWrist', 'rWrist'],
]
const LEG: [Joint, Joint][] = [
  ['lHip', 'rHip'],
  ['lKnee', 'rKnee'],
  ['lAnkle', 'rAnkle'],
]

/** Swap the left and right arm (or leg), including their visibility. */
function swapGroup(s: Sample, group: typeof ARM): Sample {
  const joints = [...s.joints]
  for (const [a, b] of group) {
    const ia = J(a)
    const ib = J(b)
    ;[joints[ia], joints[ib]] = [joints[ib], joints[ia]]
    ;[joints[ia + 1], joints[ib + 1]] = [joints[ib + 1], joints[ia + 1]]
  }
  const v = s.vis
  const vis = group === ARM ? { ...v, lArm: v.rArm, rArm: v.lArm } : { ...v, lLeg: v.rLeg, rLeg: v.lLeg }
  return group === ARM ? { ...s, joints, vis } : { ...s, joints, vis, lz: s.rz, rz: s.lz }
}

/**
 * From the side, one arm and one leg are hidden and the tracker guesses them,
 * and it can switch which limb it calls left mid-clip. So, frame by frame
 * (with a short majority vote so it can't flicker), make the more visible arm
 * and leg the near ones; then draw a mostly hidden far limb right behind the
 * near one instead of drawing the tracker's guess.
 */
function fixLimbIdentity(samples: Sample[]): Sample[] {
  const flipArm = majority(samples.map((s) => s.vis.rArm - s.vis.lArm > 0.15), 4)
  const flipLeg = majority(samples.map((s) => s.vis.rLeg - s.vis.lLeg > 0.15), 4)
  return samples.map((s, i) => {
    let q = s
    if (flipArm[i]) q = swapGroup(q, ARM)
    if (flipLeg[i]) q = swapGroup(q, LEG)
    const joints = [...q.joints]
    const hide = (near: Joint[], far: Joint[]) =>
      near.forEach((n, k) => {
        joints[J(far[k])] = joints[J(n)]
        joints[J(far[k]) + 1] = joints[J(n) + 1]
      })
    if (q.vis.rArm < 0.5) hide(['lElbow', 'lWrist'], ['rElbow', 'rWrist'])
    if (q.vis.rLeg < 0.5) hide(['lKnee', 'lAnkle'], ['rKnee', 'rAnkle'])
    return { ...q, joints }
  })
}

function majority(flags: boolean[], radius: number): boolean[] {
  return flags.map((_, i) => {
    let yes = 0
    let all = 0
    for (let d = -radius; d <= radius; d++) {
      if (i + d < 0 || i + d >= flags.length) continue
      all++
      if (flags[i + d]) yes++
    }
    return yes * 2 > all
  })
}

function mirrorX(s: Sample): Sample {
  return { ...s, joints: s.joints.map((v, i) => (i % 2 === 0 ? -v : v)), nose: { x: -s.nose.x, y: s.nose.y } }
}

// ---------- signal processing ----------

function resample(found: { t: number; s: Sample }[], fps: number): Sample[] {
  const t0 = found[0].t
  const t1 = found[found.length - 1].t
  const n = Math.max(2, Math.floor((t1 - t0) * fps) + 1)
  const out: Sample[] = []
  let j = 0
  for (let i = 0; i < n; i++) {
    const t = t0 + i / fps
    while (j < found.length - 2 && found[j + 1].t < t) j++
    const a = found[j]
    const b = found[Math.min(j + 1, found.length - 1)]
    const u = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0
    out.push({
      joints: a.s.joints.map((v, k) => v + (b.s.joints[k] - v) * u),
      nose: { x: a.s.nose.x + (b.s.nose.x - a.s.nose.x) * u, y: a.s.nose.y + (b.s.nose.y - a.s.nose.y) * u },
      lz: a.s.lz + (b.s.lz - a.s.lz) * u,
      rz: a.s.rz + (b.s.rz - a.s.rz) * u,
      vis: {
        lArm: a.s.vis.lArm + (b.s.vis.lArm - a.s.vis.lArm) * u,
        rArm: a.s.vis.rArm + (b.s.vis.rArm - a.s.vis.rArm) * u,
        lLeg: a.s.vis.lLeg + (b.s.vis.lLeg - a.s.vis.lLeg) * u,
        rLeg: a.s.vis.rLeg + (b.s.vis.rLeg - a.s.vis.rLeg) * u,
      },
    })
  }
  return out
}

/** Running median over time per coordinate: drops single-frame jumps (e.g. a wrist snapping to the face). */
function despike(samples: Sample[], radius: number): Sample[] {
  return samples.map((s, i) => {
    const lo = Math.max(0, i - radius)
    const hi = Math.min(samples.length, i + radius + 1)
    const window = samples.slice(lo, hi)
    return { ...s, joints: s.joints.map((_, k) => median(window.map((w) => w.joints[k]))) }
  })
}

/** Gaussian smoothing over time, sigma in frames. Edges use the available window. */
function smooth(samples: Sample[], sigma: number): Sample[] {
  const r = Math.ceil(sigma * 3)
  const w = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)))
  return samples.map((s, i) => {
    const joints = new Array(N).fill(0)
    let total = 0
    for (let d = -r; d <= r; d++) {
      const q = samples[i + d]
      if (!q) continue
      const wt = w[d + r]
      total += wt
      for (let k = 0; k < N; k++) joints[k] += q.joints[k] * wt
    }
    return { ...s, joints: joints.map((v) => v / total) }
  })
}

/** Projection of each frame onto the main direction of motion (1st principal component). */
export function principalSignal(X: number[][]): number[] {
  const n = X.length
  const mean = new Array(N).fill(0)
  for (const x of X) for (let k = 0; k < N; k++) mean[k] += x[k] / n
  const C = X.map((x) => x.map((v, k) => v - mean[k]))
  // Power iteration on the covariance, without forming it.
  let v = new Array(N).fill(0).map((_, k) => Math.sin(k + 1))
  for (let it = 0; it < 60; it++) {
    const proj = C.map((c) => c.reduce((s, ck, k) => s + ck * v[k], 0))
    const next = new Array(N).fill(0)
    C.forEach((c, i) => c.forEach((ck, k) => (next[k] += ck * proj[i])))
    const norm = Math.hypot(...next)
    if (!(norm > 1e-12)) break
    v = next.map((x) => x / norm)
  }
  return C.map((c) => c.reduce((s, ck, k) => s + ck * v[k], 0))
}

/**
 * Rep length in frames via autocorrelation. Returns null when the motion is
 * too small or not clearly periodic (it's a hold, or there's only one rep).
 */
export function findPeriod(s: number[], fps: number): { lag: number; score: number } | null {
  const n = s.length
  const mean = s.reduce((a, b) => a + b, 0) / n
  const d = s.map((x) => x - mean)
  const variance = d.reduce((a, b) => a + b * b, 0) / n
  // Peak-to-peak movement under 15% of a spine length is breathing or sway,
  // not reps: treat it as still. (Even a calf raise moves ~2x that.)
  const sorted = [...s].sort((a, b) => a - b)
  if (sorted[Math.floor(n * 0.95)] - sorted[Math.floor(n * 0.05)] < BODY.spine * 0.15) return null
  const minLag = Math.round(0.35 * fps)
  // Need about 1.4 repetitions in view to see a rhythm (slow combo reps can be 4 s+).
  const maxLag = Math.min(Math.round(10 * fps), Math.floor(n / 1.4))
  if (maxLag <= minLag + 2) return null
  const acf: number[] = []
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i + lag < n; i++) sum += d[i] * d[i + lag]
    acf.push(sum / (n - lag) / variance)
  }
  const peaks: number[] = []
  for (let lag = minLag; lag < maxLag; lag++) {
    if (acf[lag] > acf[lag - 1] && acf[lag] >= acf[lag + 1]) peaks.push(lag)
  }
  if (peaks.length === 0) return null
  const best = Math.max(...peaks.map((l) => acf[l]))
  if (best < 0.3) return null
  // The first strong peak, not a multiple of the period. Uneven reps blur the
  // first peak, so accept one that's at least 65% as strong as the best.
  const lag = peaks.find((l) => acf[l] >= 0.65 * best)!
  // Parabolic refinement for sub-frame accuracy.
  const [a, b, c] = [acf[lag - 1], acf[lag], acf[lag + 1]]
  const den = a - 2 * b + c
  const off = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0
  return { lag: lag + off, score: b }
}

/**
 * Cuts the signal into reps. Reps start and end at the extreme nearest where
 * the clip starts (people usually begin in the start position: standing for a
 * squat, arms straight for a push-up).
 */
export function findCycles(s: number[], period: number): [number, number][] {
  const n = s.length
  const sorted = [...s].sort((a, b) => a - b)
  const lo = sorted[Math.floor(n * 0.1)]
  const hi = sorted[Math.floor(n * 0.9)]
  const start = median(s.slice(0, Math.max(3, Math.round(period / 6))))
  const sign = Math.abs(start - hi) < Math.abs(start - lo) ? 1 : -1
  const threshold = (lo + hi) / 2
  const win = Math.max(1, Math.round(period * 0.4))

  const extremes: number[] = []
  for (let i = 0; i < n; i++) {
    if ((s[i] - threshold) * sign <= 0) continue
    let isExtreme = true
    for (let d = -win; d <= win && isExtreme; d++) {
      const q = s[i + d]
      if (q !== undefined && d !== 0 && (q - s[i]) * sign > 0) isExtreme = false
    }
    if (isExtreme && (extremes.length === 0 || i - extremes[extremes.length - 1] >= period * 0.5)) extremes.push(i)
  }

  const cycles: [number, number][] = []
  for (let i = 0; i + 1 < extremes.length; i++) {
    const len = extremes[i + 1] - extremes[i]
    if (len >= period * 0.6 && len <= period * 1.6) cycles.push([extremes[i], extremes[i + 1]])
  }
  return cycles
}

/**
 * Time-normalizes every rep, drops outlier reps, then takes the median of the
 * rest at each moment of the rep (robust to a rep that was badly tracked at
 * that moment), and closes the loop.
 */
function averageCycles(X: number[][], cycles: [number, number][]): number[][] {
  const reps = cycles.map(([a, b]) =>
    Array.from({ length: LOOP_KEYS + 1 }, (_, i) => {
      const f = a + ((b - a) * i) / LOOP_KEYS
      const i0 = Math.floor(f)
      const i1 = Math.min(i0 + 1, X.length - 1)
      const u = f - i0
      return X[i0].map((v, k) => v + (X[i1][k] - v) * u)
    }),
  )
  const mean = (set: number[][][]) =>
    Array.from({ length: LOOP_KEYS + 1 }, (_, i) =>
      Array.from({ length: N }, (_, k) => set.reduce((s, r) => s + r[i][k], 0) / set.length),
    )
  const first = mean(reps)
  const dist = reps.map((r) => r.reduce((s, row, i) => s + row.reduce((q, v, k) => q + (v - first[i][k]) ** 2, 0), 0))
  const cut = median(dist) * 1.5 + 1e-12
  const kept = reps.filter((_, i) => dist[i] <= cut)
  const use = kept.length ? kept : reps
  const avg =
    use.length >= 3
      ? Array.from({ length: LOOP_KEYS + 1 }, (_, i) => Array.from({ length: N }, (_, k) => median(use.map((r) => r[i][k]))))
      : mean(use)
  // Close the loop: spread any end-start mismatch evenly across the rep.
  const drift = avg[LOOP_KEYS].map((v, k) => v - avg[0][k])
  return avg.slice(0, LOOP_KEYS).map((row, i) => row.map((v, k) => v - (drift[k] * i) / LOOP_KEYS))
}

function medianPose(X: number[][]): Pose {
  const mid = X.slice(Math.floor(X.length * 0.25), Math.ceil(X.length * 0.75))
  return vecToPose(Array.from({ length: N }, (_, k) => median(mid.map((x) => x[k]))))
}

/** A hold: the median pose with a subtle breath so it never looks frozen. */
function holdLoop(pose: Pose): Animation['loop'] {
  const upper = new Set<Joint>(['head', 'neck', 'lShoulder', 'rShoulder', 'lElbow', 'rElbow'])
  return Array.from({ length: 8 }, (_, i) => {
    const t = i / 8
    const breath = (1 - Math.cos(2 * Math.PI * t)) / 2
    const p = clonePose(pose)
    for (const j of JOINTS) if (upper.has(j)) p[j].y -= 0.004 * breath
    return { t, pose: p }
  })
}

/** Place the loop in the 0..1 frame: feet on y = 0.9, centred, never clipped. */
function fitToFrame(loop: Animation['loop']) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let lowest = -Infinity
  for (const { pose } of loop) {
    for (const j of JOINTS) {
      const r = j === 'head' ? BODY.headR : 0
      minX = Math.min(minX, pose[j].x - r)
      maxX = Math.max(maxX, pose[j].x + r)
      minY = Math.min(minY, pose[j].y - r)
      maxY = Math.max(maxY, pose[j].y + r)
      if (j !== 'head') lowest = Math.max(lowest, pose[j].y)
    }
  }
  const f = Math.min(1, 0.9 / (maxX - minX), 0.86 / (lowest - minY))
  const cx = (minX + maxX) / 2
  for (const { pose } of loop) {
    for (const j of JOINTS) {
      pose[j].x = 0.5 + (pose[j].x - cx) * f
      pose[j].y = 0.9 + (pose[j].y - lowest) * f
    }
  }
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d
