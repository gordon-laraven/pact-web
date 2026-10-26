// Scores detected movements against a known list (the test set in /testset).
// Pure, so the eval script and unit tests share it.
//
// Matching: each detection is assigned to the true movement it overlaps most,
// if that covers at least half of the detection. Then:
//   missed    a true movement with no detection
//   fragment  a true movement with more than one detection (each extra one counts)
//   extra     a detection that isn't mostly inside any true movement (a false positive)

export type Span = { start: number; end: number }
export type TruthMovement = Span & { name: string; kind?: 'reps' | 'hold' }
export type Detected = Span & { kind?: string; confidence?: string }

export type Score = {
  truth: number
  detected: number
  matched: number
  missed: string[]
  fragments: { name: string; pieces: number }[]
  extra: Detected[]
  /** Mean |start error| + |end error| over matched movements, seconds. */
  meanEdgeError: number | null
  /** Holds reported where the truth has none. */
  falseHolds: number
}

const overlap = (a: Span, b: Span) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))

export function scoreDetections(truth: TruthMovement[], detected: Detected[]): Score {
  const byTruth = truth.map(() => [] as Detected[])
  const extra: Detected[] = []
  for (const d of detected) {
    let best = -1
    let bestO = 0
    truth.forEach((t, i) => {
      const o = overlap(t, d)
      if (o > bestO) {
        bestO = o
        best = i
      }
    })
    const len = Math.max(1e-6, d.end - d.start)
    if (best >= 0 && bestO / len >= 0.5) byTruth[best].push(d)
    else extra.push(d)
  }
  const edges: number[] = []
  byTruth.forEach((ds, i) => {
    if (!ds.length) return
    const start = Math.min(...ds.map((d) => d.start))
    const end = Math.max(...ds.map((d) => d.end))
    edges.push(Math.abs(start - truth[i].start) + Math.abs(end - truth[i].end))
  })
  const falseHolds = detected.filter((d) => d.kind === 'hold' && !truth.some((t) => t.kind === 'hold' && overlap(t, d) / Math.max(1e-6, d.end - d.start) >= 0.5)).length
  return {
    truth: truth.length,
    detected: detected.length,
    matched: byTruth.filter((d) => d.length).length,
    missed: truth.filter((_, i) => byTruth[i].length === 0).map((t) => t.name),
    fragments: byTruth.flatMap((ds, i) => (ds.length > 1 ? [{ name: truth[i].name, pieces: ds.length }] : [])),
    extra,
    meanEdgeError: edges.length ? edges.reduce((a, b) => a + b, 0) / edges.length : null,
    falseHolds,
  }
}

/** One line: "7/7 found · 0 missed · 0 fragments · 0 extra · 0 false holds · edges ±1.2 s" */
export function summarize(s: Score): string {
  const frag = s.fragments.reduce((a, f) => a + f.pieces - 1, 0)
  return [
    `${s.matched}/${s.truth} found`,
    `${s.missed.length} missed${s.missed.length ? ` (${s.missed.join(', ')})` : ''}`,
    `${frag} fragment${frag === 1 ? '' : 's'}${s.fragments.length ? ` (${s.fragments.map((f) => `${f.name} ×${f.pieces}`).join(', ')})` : ''}`,
    `${s.extra.length} extra`,
    `${s.falseHolds} false hold${s.falseHolds === 1 ? '' : 's'}`,
    s.meanEdgeError == null ? 'edges –' : `edges ±${s.meanEdgeError.toFixed(1)} s`,
  ].join(' · ')
}
