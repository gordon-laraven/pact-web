import { JOINTS, type Animation, type Pose } from '../types'

// Samples an Animation at any t in [0, 1) (wrapping). Works the same for a few
// hand-authored keyframes or dense pose-tracking frames.
//
// Interpolation is a cyclic, monotone cubic Hermite spline per coordinate
// (Fritsch-Butland tangents): the curve passes through every keyframe, never
// overshoots, and slows to a stop wherever a coordinate reverses direction.
// With two keyframes this is exactly ease-in-out; with more, motion flows
// smoothly through the in-between keys instead of stopping at each one.

type Prepared = {
  times: number[] // n keyframe times in [0, 1)
  // channel = joint index * 2 + (0 for x, 1 for y)
  values: Float64Array[] // [channel][key]
  tangents: Float64Array[] // [channel][key]
}

const cache = new WeakMap<Animation, Prepared>()
const CHANNELS = JOINTS.length * 2

function prepare(anim: Animation): Prepared {
  const hit = cache.get(anim)
  if (hit) return hit
  if (anim.loop.length === 0) throw new Error(`Animation "${anim.id}" has no keyframes`)

  let keys = [...anim.loop].sort((a, b) => a.t - b.t)
  // A key at t=1 closes the loop; it's the same instant as t=0.
  if (keys.length > 1 && keys[keys.length - 1].t >= 1 && keys[0].t <= 0) keys = keys.slice(0, -1)
  const n = keys.length
  const times = keys.map((k) => k.t)

  const values: Float64Array[] = []
  const tangents: Float64Array[] = []
  for (let c = 0; c < CHANNELS; c++) {
    const joint = JOINTS[c >> 1]
    const v = new Float64Array(n)
    for (let i = 0; i < n; i++) v[i] = c & 1 ? keys[i].pose[joint].y : keys[i].pose[joint].x
    values.push(v)
    tangents.push(cyclicMonotoneTangents(times, v))
  }

  const prepared = { times, values, tangents }
  cache.set(anim, prepared)
  return prepared
}

function cyclicMonotoneTangents(times: number[], v: Float64Array): Float64Array {
  const n = v.length
  const m = new Float64Array(n)
  if (n < 2) return m
  const h = (i: number) => {
    const j = (i + 1) % n
    return j === 0 ? times[0] + 1 - times[i] : times[j] - times[i]
  }
  const d = (i: number) => (v[(i + 1) % n] - v[i]) / h(i)
  for (let i = 0; i < n; i++) {
    const ip = (i - 1 + n) % n
    const d0 = d(ip)
    const d1 = d(i)
    if (d0 * d1 <= 0) continue // local extremum or flat: zero velocity here
    const h0 = h(ip)
    const h1 = h(i)
    m[i] = (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1)
  }
  return m
}

export function makePose(): Pose {
  const p = {} as Pose
  for (const j of JOINTS) p[j] = { x: 0, y: 0 }
  return p
}

/** Pose at loop phase t. Pass `out` to reuse an object (no per-frame allocation). */
export function samplePose(anim: Animation, t: number, out: Pose = makePose()): Pose {
  const { times, values, tangents } = prepare(anim)
  const n = times.length
  let tt = t - Math.floor(t)

  // Segment i spans times[i] -> times[i+1] (wrapping to times[0] + 1).
  let i = n - 1
  for (let k = 0; k < n - 1; k++) {
    if (tt < times[k + 1]) {
      i = k
      break
    }
  }
  if (tt < times[0]) {
    i = n - 1
    tt += 1
  }
  const j = (i + 1) % n
  const t0 = times[i]
  const t1 = j === 0 ? times[0] + 1 : times[j]
  const h = t1 - t0
  const s = n < 2 || h <= 0 ? 0 : (tt - t0) / h

  // Cubic Hermite basis.
  const s2 = s * s
  const s3 = s2 * s
  const h00 = 2 * s3 - 3 * s2 + 1
  const h10 = s3 - 2 * s2 + s
  const h01 = -2 * s3 + 3 * s2
  const h11 = s3 - s2

  for (let c = 0; c < CHANNELS; c++) {
    const v = values[c]
    const m = tangents[c]
    const val = h00 * v[i] + h10 * h * m[i] + h01 * v[j] + h11 * h * m[j]
    const pt = out[JOINTS[c >> 1]]
    if (c & 1) pt.y = val
    else pt.x = val
  }
  return out
}
