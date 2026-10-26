/// <reference types="node" />
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { it } from 'vitest'
import { scoreDetections, summarize, type Score, type TruthMovement } from '../src/extract/evaluate'
import type { TrackedClip } from '../src/extract/extract'
import { extractMovements } from '../src/extract/segment'

// Runs the current movement detection on every case in /testset and reports
// missed, extra and fragment detections. Each run is compared with the last
// one saved in that case's folder, so you see before → after.
//
//   npm run eval
//
// A case is a folder with truth.json and one or more tracking files (the
// "Download debug file (dev)" file, any name ending in .json). See testset/README.md.

const ROOT = join(process.cwd(), 'testset')

type Truth = { video?: string; movements: TruthMovement[] }
type Result = { file: string; summary: string; score: Score; detected: { start: number; end: number; kind: string; confidence: string }[] }

it('scores detection on the test set', () => {
  const lines: string[] = []
  const cases = existsSync(ROOT) ? readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()) : []
  let totals = { truth: 0, matched: 0, missed: 0, fragments: 0, extra: 0, falseHolds: 0 }
  for (const c of cases) {
    const dir = join(ROOT, c.name)
    if (!existsSync(join(dir, 'truth.json'))) continue
    const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as Truth
    const tracks = readdirSync(dir).filter((f) => f.endsWith('.json') && !['truth.json', 'last-run.json'].includes(f))
    if (!tracks.length) {
      lines.push(`${c.name}: no tracking file yet (add the debug file next to truth.json)`)
      continue
    }
    const before = existsSync(join(dir, 'last-run.json')) ? (JSON.parse(readFileSync(join(dir, 'last-run.json'), 'utf8')) as Result[]) : []
    const results: Result[] = []
    for (const file of tracks) {
      const data = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      const clip: TrackedClip = data.tracking ?? data
      const fps = clip.frames.length > 1 ? (clip.frames.length - 1) / (clip.frames[clip.frames.length - 1].t - clip.frames[0].t) : 0
      const movements = extractMovements(clip, `eval-${c.name}`, { videoDuration: data.video?.duration })
      const detected = movements.map((m) => ({ start: round(m.start), end: round(m.end), kind: m.kind, confidence: m.confidence }))
      const score = scoreDetections(truth.movements, detected)
      const summary = summarize(score)
      results.push({ file, summary, score, detected })
      const prev = before.find((b) => b.file === file)
      lines.push(`${c.name}/${file} (${fps.toFixed(0)} fps)`)
      if (prev && prev.summary !== summary) lines.push(`  before: ${prev.summary}`)
      lines.push(`  ${prev && prev.summary !== summary ? 'after:  ' : ''}${summary}`)
      for (const d of detected) lines.push(`    ${clock(d.start)}–${clock(d.end)}  ${d.kind}, ${d.confidence}`)
      totals = {
        truth: totals.truth + score.truth,
        matched: totals.matched + score.matched,
        missed: totals.missed + score.missed.length,
        fragments: totals.fragments + score.fragments.reduce((a, f) => a + f.pieces - 1, 0),
        extra: totals.extra + score.extra.length,
        falseHolds: totals.falseHolds + score.falseHolds,
      }
    }
    writeFileSync(join(dir, 'last-run.json'), JSON.stringify(results, null, 2))
  }
  lines.push(
    '',
    cases.length
      ? `TOTAL: ${totals.matched}/${totals.truth} found · ${totals.missed} missed · ${totals.fragments} fragments · ${totals.extra} extra · ${totals.falseHolds} false holds`
      : 'No cases in /testset yet. See testset/README.md.',
  )
  const report = lines.join('\n')
  writeFileSync(join(ROOT, 'report.txt'), report + '\n')
  process.stdout.write(`\n${report}\n\n(saved to testset/report.txt)\n`)
})

const round = (x: number) => Math.round(x * 10) / 10
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
