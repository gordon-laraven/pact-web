import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { loopSecFor, registerAnimation } from '../animation/library'
import { mirrorAnimation } from '../animation/mirror'
import { buildTimeline } from '../engine/timeline'
import { ExtractError, type Landmark, type TrackedClip } from '../extract/extract'
import { OVERLAY_BONES, trackVideo } from '../extract/mediapipe'
import { mergeMovements, splitMovement } from '../extract/edits'
import { extractMovements, extractRange, type DebugLog, type Movement } from '../extract/segment'
import { formatClock, prescription } from '../player/format'
import type { Exercise, Workout } from '../types'
import { applyToAll, changesPlan, cleanUniform, forNewMovement, undoApply, type Uniform, type Undo } from '../review/uniform'
import type { TicketContext } from '../support/tickets'
import { AnimationPreview } from './AnimationPreview'
import { UploadIcon } from './icons'
import { ReportProblem } from './ReportProblem'
import { UniformBar } from './UniformBar'

// "Make from video": pick a clip, track the body, split it into its movements,
// extract one clean rep of each, and add them to a workout. Everything happens
// in the browser; nothing is uploaded.

export type Draft = { title: string; exercises: Exercise[] }

/** "Set for all movements": the values in the bar, and the last ones applied (new movements start from those). */
export type UniformState = { values: Uniform; active: Uniform | null }

type Props = {
  draft: Draft
  onChange: (draft: Draft) => void
  /** Kept by App, so the values are still there after visiting another screen. */
  uniform: UniformState
  onUniform: (u: UniformState) => void
  onBack: () => void
  onStart: (workout: Workout) => void
}

type Status =
  | { kind: 'idle' }
  | { kind: 'analyzing'; progress: number }
  | { kind: 'done' }
  | { kind: 'error'; message: string; step: string; cause?: unknown }

/** What was analysed, kept for re-analysing edited ranges and for the debug file. */
type Analysis = {
  clip: TrackedClip
  log: DebugLog
  source: { name: string; duration: number; range: { start: number; end: number }; fromDebugFile?: boolean; slow?: boolean }
}

type Side = NonNullable<Exercise['side']>

type Form = {
  name: string
  notes: string
  type: Exercise['type']
  sets: number
  reps: number
  holdSec: number
  restSec: number
  tempoSec: number
}

/** One card in step 2: a detected (or hand-added) movement, or a generated other side. */
export type Item = {
  key: string
  movement: Movement
  form: Form
  side: Side
  /** Key of the item this is the generated other side of. */
  copyOf?: string
  /** Show the stick figure (and the video, when watching) flipped. */
  mirror: boolean
  addedByHand?: boolean
  /** Sets, reps, time, rest or type changed by hand: kept when the uniform values are applied (unless replaced). */
  custom?: boolean
  /** Low confidence when detected: listed first for checking. Fixed at detection so cards don't jump while you edit. */
  checkFirst?: boolean
  rangeError?: string
}

const SAMPLE_FPS = 15
/** "Slow analysis": twice the frames, and more analysis speeds for fast videos. Same device, no API cost. */
const SLOW_FPS = 30
const SLOW_STRETCHES = [1, 1.5, 2, 3]

/** Starting values for a movement's form, from what was detected in the video. */
function formFor(m: Movement, n: number): Form {
  const reps = m.sets.map((s) => s.reps).filter((r) => r > 0)
  const durations = m.sets.map((s) => s.end - s.start)
  return {
    name: `Movement ${n}`,
    notes: '',
    type: m.kind === 'reps' ? 'rep_based' : 'time_based',
    sets: m.sets.length,
    reps: reps.length ? Math.max(...reps) : 10,
    holdSec: Math.max(5, Math.round(Math.max(...durations))),
    restSec: 15,
    tempoSec: clamp(m.result.secPerRep, 0.5, 10),
  }
}

/** "(Left)" <-> "(Right)": the name for the other side of a movement. */
function sideNames(name: string): { original: string; copy: string; originalSide: Side; copySide: Side } {
  if (/\bleft\b/i.test(name)) return { original: name, copy: swapWord(name, /\bleft\b/i, 'Right'), originalSide: 'left', copySide: 'right' }
  if (/\bright\b/i.test(name)) return { original: name, copy: swapWord(name, /\bright\b/i, 'Left'), originalSide: 'right', copySide: 'left' }
  return { original: `${name} (Left)`, copy: `${name} (Right)`, originalSide: 'left', copySide: 'right' }
}
const swapWord = (s: string, re: RegExp, to: string) => s.replace(re, (m) => (m[0] === m[0].toLowerCase() ? to.toLowerCase() : to))

/** A readable line for something thrown that isn't an Error (an Event, a string…). */
const describe = (x: unknown): string => {
  if (typeof x === 'string') return x
  const o = x as { message?: unknown; type?: unknown; constructor?: { name?: string } } | null
  if (o && typeof o.message === 'string') return o.message
  return [o?.constructor?.name, typeof o?.type === 'string' ? o.type : null].filter(Boolean).join(' ') || String(x)
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (e: ChangeEvent<HTMLInputElement>) => Number(e.target.value)
const round1 = (x: number) => Math.round(x * 10) / 10

export function VideoBuilder({ draft, onChange, uniform, onUniform, onBack, onStart }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const abort = useRef<AbortController | null>(null)
  const [file, setFile] = useState<{ name: string; url: string; size: number } | null>(null)
  const [duration, setDuration] = useState(0)
  const [range, setRange] = useState({ start: 0, end: 0 })
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [manual, setManual] = useState({ start: 0, end: 0, error: '' })
  const [slow, setSlow] = useState(false)
  /** The last "Apply to all", while it can be undone. */
  const [lastApply, setLastApply] = useState<{ undo: Undo<Item>; active: Uniform | null; message: string } | null>(null)

  // Release the video and stop any analysis when leaving the screen.
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => () => void (file && URL.revokeObjectURL(file.url)), [file])

  const reset = () => {
    setStatus({ kind: 'idle' })
    setAnalysis(null)
    setItems([])
    clearOverlay()
  }

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again
    if (!f) return
    abort.current?.abort()
    setFile({ name: f.name, url: URL.createObjectURL(f), size: f.size })
    reset()
  }

  const onMeta = () => {
    const v = video.current
    if (!v) return
    const d = Number.isFinite(v.duration) ? v.duration : 0
    setDuration(d)
    setRange({ start: 0, end: round1(d) })
    if (overlay.current) {
      overlay.current.width = v.videoWidth
      overlay.current.height = v.videoHeight
    }
  }

  const clearOverlay = () => {
    const c = overlay.current
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height)
  }

  const drawOverlay = (lm: Landmark[] | null) => {
    const c = overlay.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    if (!lm) return
    // The mode's glow (a token), bright enough to read over any video.
    const style = getComputedStyle(c)
    const accent = style.getPropertyValue('--glow').trim() || style.color
    ctx.strokeStyle = accent
    ctx.fillStyle = accent
    ctx.lineWidth = Math.max(4, c.width / 90)
    ctx.lineCap = 'round'
    for (const [a, b] of OVERLAY_BONES) {
      if ((lm[a].visibility ?? 1) < 0.4 || (lm[b].visibility ?? 1) < 0.4) continue
      ctx.beginPath()
      ctx.moveTo(lm[a].x * c.width, lm[a].y * c.height)
      ctx.lineTo(lm[b].x * c.width, lm[b].y * c.height)
      ctx.stroke()
    }
  }

  /** Split the tracked clip into movements and turn them into cards. */
  const runExtraction = (clip: TrackedClip, source: Analysis['source']) => {
    const log: DebugLog = { pieces: [], decisions: [] }
    setAnalysis({ clip, log, source })
    setManual({ start: round1(source.range.start), end: round1(source.range.end), error: '' })
    try {
      const movements = extractMovements(clip, `video-${Date.now().toString(36)}`, {
        videoDuration: source.duration,
        log,
        stretches: source.slow ? SLOW_STRETCHES : undefined,
      })
      movements.forEach((m) => registerAnimation(m.result.animation))
      const next: Item[] = []
      movements.forEach((m, i) => {
        const form = forNewMovement(formFor(m, draft.exercises.length + i + 1), uniform.active)
        // Both sides already in the video, back to back: label them as a pair.
        const prev = next[next.length - 1]
        if (m.bothSidesShown && prev?.movement.bothSidesShown && prev.side === 'left') {
          form.name = sideNames(prev.form.name.replace(/ \(Left\)$/, '')).copy
          next.push({ key: m.result.animation.id, movement: m, form, side: 'right', mirror: false, checkFirst: m.confidence === 'low' })
          return
        }
        if (m.bothSidesShown) form.name = `${form.name} (Left)`
        next.push({ key: m.result.animation.id, movement: m, form, side: m.bothSidesShown ? 'left' : 'none', mirror: false, checkFirst: m.confidence === 'low' })
      })
      setItems(next)
      setStatus({ kind: 'done' })
    } catch (err) {
      if (!(err instanceof ExtractError)) throw err
      setItems([])
      setStatus({ kind: 'error', message: err.message, step: 'Finding the moves', cause: err })
    }
  }

  const analyze = async (slowly = slow) => {
    const v = video.current
    if (!v || !file) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    reset()
    setStatus({ kind: 'analyzing', progress: 0 })
    const end = range.end > range.start ? range.end : duration
    try {
      const clip = await trackVideo(v, {
        start: range.start,
        end,
        fps: slowly ? SLOW_FPS : SAMPLE_FPS,
        signal: controller.signal,
        onFrame: drawOverlay,
        onProgress: (p) => setStatus({ kind: 'analyzing', progress: p }),
      })
      // Dev-only: lets you inspect raw tracking from the console (window.__pactClip).
      if (import.meta.env.DEV) (window as unknown as { __pactClip?: unknown }).__pactClip = clip
      runExtraction(clip, { name: file.name, duration, range: { start: range.start, end }, slow: slowly })
    } catch (err) {
      if (controller.signal.aborted) return
      console.warn('[pact] pose tracking failed:', err)
      setStatus({
        kind: 'error',
        message: "Body tracking didn't start. It downloads once, on first use, so check your connection and try again.",
        step: 'Following the movement (body tracking)',
        cause: err,
      })
    }
  }

  const cancel = () => {
    abort.current?.abort()
    reset()
  }

  /** What was detected so far, for a problem report. Never video frames or tracking. */
  const detectionSoFar = () =>
    analysis
      ? {
          range: analysis.source.range,
          frameCount: analysis.clip.frames.length,
          pieces: analysis.log.pieces,
          decisions: analysis.log.decisions,
          movements: movementSummary(),
        }
      : null

  /** Everything a problem report needs about this moment. */
  const ticketContext = (step: string, message?: string, cause?: unknown): TicketContext => {
    const e = cause instanceof Error ? cause : null
    const detail = e?.message ?? (cause === undefined ? undefined : describe(cause))
    return {
      step,
      error: message || detail ? { message: [message, detail].filter(Boolean).join(' | '), stack: e?.stack } : undefined,
      video: file
        ? { name: file.name, sizeBytes: file.size, durationSec: duration ? round1(duration) : null }
        : analysis
          ? { name: analysis.source.name, sizeBytes: null, durationSec: round1(analysis.source.duration) }
          : undefined,
      detection: detectionSoFar(),
    }
  }

  const movementSummary = () =>
    items.map((it) => ({
        name: it.form.name,
        start: round1(it.movement.start),
        end: round1(it.movement.end),
        kind: it.movement.kind,
        sets: it.movement.sets,
        secPerRep: it.movement.result.secPerRep,
        view: it.movement.result.view,
        confidence: it.movement.confidence,
        reasons: it.movement.reasons,
        oneSided: it.movement.oneSided,
        bothSidesShown: it.movement.bothSidesShown,
        side: it.side,
        copyOf: it.copyOf,
        addedByHand: it.addedByHand ?? false,
      }))

  /** Dev only: everything needed to see why the video was split the way it was. */
  const downloadDebug = () => {
    if (!analysis) return
    const { clip, log, source } = analysis
    const data = {
      app: 'pact-web',
      savedAt: new Date().toISOString(),
      video: source,
      sampling: { framesPerSecond: source.slow ? SLOW_FPS : SAMPLE_FPS, frameCount: clip.frames.length, timestamps: clip.frames.map((f) => f.t) },
      pieces: log.pieces,
      decisions: log.decisions,
      movements: movementSummary(),
      tracking: clip,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `pact-debug-${(source.name || 'video').replace(/\.[^.]+$/, '')}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  /** Dev only: re-run splitting on a saved debug file, without the video. */
  const loadDebug = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const data = JSON.parse(await f.text())
      const clip: TrackedClip = data.tracking ?? data // a debug file, or a raw window.__pactClip dump
      if (!Array.isArray(clip.frames)) throw new Error('no frames')
      setFile(null)
      const start = clip.frames[0]?.t ?? 0
      const end = clip.frames[clip.frames.length - 1]?.t ?? 0
      runExtraction(clip, { name: data.video?.name ?? f.name, duration: data.video?.duration ?? end, range: { start, end }, fromDebugFile: true, slow: !!data.video?.slow })
    } catch (err) {
      setStatus({ kind: 'error', message: "That file isn't a pact debug file.", step: 'Loading a debug file', cause: err })
    }
  }

  /** Play one movement's part of the source video, then stop (flipped if mirrored). */
  const watch = (it: Item) => {
    const v = video.current
    if (!v) return
    const m = it.movement
    v.style.transform = it.mirror ? 'scaleX(-1)' : ''
    v.currentTime = m.start
    const stop = () => {
      if (v.currentTime >= m.end) {
        v.pause()
        v.removeEventListener('timeupdate', stop)
      }
    }
    v.addEventListener('timeupdate', stop)
    void v.play().catch(() => v.removeEventListener('timeupdate', stop))
    v.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const update = (key: string, patch: Partial<Item>) => setItems((all) => all.map((it) => (it.key === key ? { ...it, ...patch } : it)))

  /** A card's own settings changed. Changing its plan (not its name or notes) makes it custom. */
  const setForm = (key: string, form: Form) => {
    setItems((all) => all.map((it) => (it.key === key ? { ...it, form, custom: it.custom || changesPlan(it.form, form) } : it)))
    setLastApply(null) // an undo now would also wipe this edit
  }

  /** "Apply to all" from the bar at the top of the list. */
  const applyUniform = (replaceCustom: boolean) => {
    const values = cleanUniform(uniform.values)
    const r = applyToAll(items, values, { replaceCustom })
    setItems(r.items)
    const parts = [`Applied to ${r.applied} move${r.applied === 1 ? '' : 's'}.`]
    if (r.keptCustom) parts.push(`${r.keptCustom} custom ${r.keptCustom === 1 ? 'one' : 'ones'} kept.`)
    if (r.timedKeptTime) parts.push(`${r.timedKeptTime} timed ${r.timedKeptTime === 1 ? 'move keeps its' : 'moves keep their'} time.`)
    setLastApply({ undo: r.undo, active: uniform.active, message: parts.join(' ') })
    onUniform({ values, active: values })
  }

  const undoUniform = () => {
    if (!lastApply) return
    setItems((all) => undoApply(all, lastApply.undo))
    onUniform({ ...uniform, active: lastApply.active })
    setLastApply(null)
  }

  /** Delete a card; deleting a movement also deletes its generated other side. */
  const removeItem = (key: string) => setItems((all) => all.filter((it) => it.key !== key && it.copyOf !== key))

  const addOtherSide = (key: string) =>
    setItems((all) => {
      const i = all.findIndex((it) => it.key === key)
      const it = all[i]
      if (!it || all.some((x) => x.copyOf === key)) return all
      const names = sideNames(it.form.name)
      const original: Item = { ...it, side: names.originalSide, form: { ...it.form, name: names.original } }
      const copy: Item = { ...it, key: `${key}-other`, side: names.copySide, copyOf: key, mirror: false, form: { ...it.form, name: names.copy } }
      return [...all.slice(0, i), original, copy, ...all.slice(i + 1)]
    })

  /** The next movement in the video (not counting generated other sides). */
  const nextOf = (key: string) => {
    const order = items.filter((x) => !x.copyOf)
    const i = order.findIndex((x) => x.key === key)
    return i >= 0 ? order[i + 1] : undefined
  }

  /** Two neighbouring cards that are really one movement: re-read them as one range. */
  const mergeWithNext = (key: string) => {
    const a = items.find((x) => x.key === key)
    const b = nextOf(key)
    if (!analysis || !a || !b) return
    const m = mergeMovements(analysis.clip, a.movement, b.movement, `${key}-m${Date.now().toString(36)}`)
    if (!m) {
      update(key, { rangeError: "Couldn't follow one movement across both. Try adjusting the ranges instead." })
      return
    }
    registerAnimation(m.result.animation)
    setItems((all) =>
      all
        .filter((x) => x.key !== b.key && x.copyOf !== b.key)
        .map((x) =>
          x.key === key || x.copyOf === key
            ? { ...x, movement: m, rangeError: undefined, form: { ...x.form, tempoSec: clamp(m.result.secPerRep, 0.5, 10) } }
            : x,
        ),
    )
  }

  /** One card that holds two movements: cut it in two at a time you choose. */
  const splitAt = (key: string, at: number) => {
    const it = items.find((x) => x.key === key)
    if (!analysis || !it) return
    const stamp = Date.now().toString(36)
    const parts = splitMovement(analysis.clip, it.movement, at, [`${key}-a${stamp}`, `${key}-b${stamp}`])
    if (!parts) {
      update(key, { rangeError: `Couldn't split there. Each part needs at least 1.5 s with the body in frame (this move runs ${round1(it.movement.start)}–${round1(it.movement.end)} s).` })
      return
    }
    parts.forEach((m) => registerAnimation(m.result.animation))
    const [m1, m2] = parts
    setItems((all) => {
      const i = all.findIndex((x) => x.key === key)
      const first: Item = { ...all[i], movement: m1, rangeError: undefined, form: { ...all[i].form, tempoSec: clamp(m1.result.secPerRep, 0.5, 10) } }
      const second: Item = {
        key: m2.result.animation.id,
        movement: m2,
        form: { ...forNewMovement(formFor(m2, 0), uniform.active), name: `${all[i].form.name} (part 2)` },
        side: 'none',
        mirror: false,
        addedByHand: true,
        checkFirst: all[i].checkFirst,
      }
      // A generated other side belonged to the whole; it's removed (add it again for either part).
      const rest = all.filter((x, j) => j !== i && x.copyOf !== key)
      rest.splice(i, 0, first, second)
      return rest
    })
  }

  /** Re-analyse a movement for a range you set by hand. */
  const setRangeFor = (key: string, start: number, end: number) => {
    if (!analysis) return
    const s = clamp(Math.min(start, end), analysis.source.range.start, analysis.source.range.end)
    const e = clamp(Math.max(start, end), analysis.source.range.start, analysis.source.range.end)
    const m = e - s >= 1.5 ? extractRange(analysis.clip, s, e, `${key}-r${Date.now().toString(36)}`) : null
    if (!m) {
      update(key, { rangeError: "Couldn't track a movement in that range. Try a longer range where the body is in frame." })
      return
    }
    registerAnimation(m.result.animation)
    setItems((all) =>
      all.map((it) =>
        it.key === key || it.copyOf === key
          ? { ...it, movement: m, rangeError: undefined, form: { ...it.form, tempoSec: clamp(m.result.secPerRep, 0.5, 10) } }
          : it,
      ),
    )
  }

  /** Add a movement the analysis missed, from a range you choose. */
  const addManual = () => {
    if (!analysis) return
    const s = clamp(Math.min(manual.start, manual.end), analysis.source.range.start, analysis.source.range.end)
    const e = clamp(Math.max(manual.start, manual.end), analysis.source.range.start, analysis.source.range.end)
    const m = e - s >= 1.5 ? extractRange(analysis.clip, s, e, `manual-${Date.now().toString(36)}`) : null
    if (!m) {
      setManual({ ...manual, error: "Couldn't track a movement in that range. Try a longer range where the body is in frame." })
      return
    }
    registerAnimation(m.result.animation)
    const item: Item = {
      key: m.result.animation.id,
      movement: m,
      form: forNewMovement(formFor(m, draft.exercises.length + items.length + 1), uniform.active),
      side: 'none',
      mirror: false,
      addedByHand: true,
    }
    setItems((all) => [...all, item].sort((a, b) => a.movement.start - b.movement.start || (a.copyOf ? 1 : 0) - (b.copyOf ? 1 : 0)))
    setManual({ ...manual, error: '' })
    setStatus({ kind: 'done' })
  }

  const add = () => {
    if (items.length === 0) return
    const exercises: Exercise[] = items.map((it, i) => {
      const { form, movement: m } = it
      const set =
        form.type === 'rep_based'
          ? { reps: clamp(Math.round(form.reps), 1, 200), restAfterSec: clamp(form.restSec, 0, 600) }
          : { holdSec: clamp(Math.round(form.holdSec), 1, 600), restAfterSec: clamp(form.restSec, 0, 600) }
      let animationId = m.result.animation.id
      if (it.mirror) {
        const mirrored = mirrorAnimation(m.result.animation)
        registerAnimation(mirrored)
        animationId = mirrored.id
      }
      return {
        id: `${it.key}-ex`,
        name: form.name.trim() || `Movement ${draft.exercises.length + i + 1}`,
        type: form.type,
        animationId,
        sets: Array.from({ length: clamp(Math.round(form.sets), 1, 20) }, () => ({ ...set })),
        tempoSec: form.type === 'rep_based' ? clamp(form.tempoSec, 0.5, 10) : undefined,
        clip: { startSec: round1(m.start), endSec: round1(m.end) },
        notes: form.notes.trim() || undefined,
        side: it.side,
        mirroredFrom: it.copyOf ? `${it.copyOf}-ex` : undefined,
        mirrorFigure: it.mirror || undefined,
      }
    })
    onChange({ ...draft, exercises: [...draft.exercises, ...exercises] })
    setFile(null)
    reset()
  }

  const remove = (id: string) =>
    onChange({ ...draft, exercises: draft.exercises.filter((e) => e.id !== id && e.mirroredFrom !== id) })

  const workout = (exercises: Exercise[], id: string, title: string): Workout => ({
    id,
    title,
    source: { platform: 'manual' },
    exercises,
  })
  const start = () => onStart(workout(draft.exercises, 'my-workout', draft.title.trim() || 'My workout'))
  // Play a single movement on its own (with the usual get-ready countdown).
  const playOne = (ex: Exercise) => onStart(workout([ex], `my-workout-${ex.id}`, ex.name))

  // Dev only, and only once there's tracking to save. Offered inside "Report a problem".
  const debugDownload = import.meta.env.DEV && analysis ? downloadDebug : undefined

  const analyzing = status.kind === 'analyzing'
  const lowCount = items.filter((it) => it.movement.confidence === 'low').length

  return (
    <main className="builder">
      <header className="builder-header">
        <button type="button" className="text-btn" onClick={onBack}>
          ← Back
        </button>
        <h1 className="builder-title">Make it from a video</h1>
        <p className="builder-note">Your video stays on this device. Nothing leaves it.</p>
      </header>

      <section className="overview-card builder-step">
        <h2 className="step-title">1. Choose a clip</h2>
        <p className="step-hint">
          One person, whole body in frame, side-on or facing the camera. A clip with several exercises is split into one
          entry per movement.
        </p>
        <label className={file ? 'file-btn' : 'file-btn is-empty'}>
          {!file && (
            <span className="upload-tile-icon" aria-hidden="true">
              <UploadIcon size={26} />
            </span>
          )}
          <span className="file-btn-title">{file ? 'Choose a different video' : 'Choose video'}</span>
          {!file && <span className="file-btn-hint">From this device. It stays here.</span>}
          <input type="file" accept="video/*" onChange={pick} hidden />
        </label>
        {import.meta.env.DEV && (
          <label className="text-btn debug-load">
            Load a debug file instead (dev)
            <input type="file" accept="application/json,.json" onChange={loadDebug} hidden />
          </label>
        )}

        {file && (
          <>
            <div className="video-wrap">
              <video
                ref={video}
                src={file.url}
                onLoadedMetadata={onMeta}
                controls={!analyzing}
                muted
                playsInline
                preload="auto"
              />
              <canvas ref={overlay} className="video-overlay" />
            </div>
            <p className="file-name">{file.name}</p>

            <div className="trim">
              <label>
                <span>Start (sec)</span>
                <input
                  type="number"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={range.start}
                  disabled={analyzing}
                  onChange={(e) => setRange((r) => ({ ...r, start: clamp(num(e), 0, duration) }))}
                />
                <button type="button" className="text-btn" disabled={analyzing} onClick={() => setRange((r) => ({ ...r, start: round1(video.current?.currentTime ?? 0) }))}>
                  Use current
                </button>
              </label>
              <label>
                <span>End (sec)</span>
                <input
                  type="number"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={range.end}
                  disabled={analyzing}
                  onChange={(e) => setRange((r) => ({ ...r, end: clamp(num(e), 0, duration) }))}
                />
                <button type="button" className="text-btn" disabled={analyzing} onClick={() => setRange((r) => ({ ...r, end: round1(video.current?.currentTime ?? duration) }))}>
                  Use current
                </button>
              </label>
            </div>

            {analyzing ? (
              <div className="analyze-progress" role="status">
                {/* The real stages, in order. "Finding the moves" runs after tracking, so it shows as next until the results appear. */}
                <ol className="analyze-steps">
                  <li className={status.progress === 0 ? 'is-active' : 'is-done'}>Getting body tracking ready</li>
                  <li className={status.progress === 0 ? '' : 'is-active'}>Following the movement</li>
                  <li>Finding the moves</li>
                </ol>
                <div className="progress-seg">
                  <div className="progress-fill" style={{ transform: `scaleX(${status.progress})` }} />
                </div>
                <span>{status.progress === 0 ? 'Getting body tracking ready…' : `Following the movement… ${Math.round(status.progress * 100)}%`}</span>
                <button type="button" className="text-btn" onClick={cancel}>
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <label className="check-label">
                  <input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} />
                  Slow analysis
                </label>
                <p className="step-hint">For fast videos, or when a move is missed: twice the frames and extra checks. Takes about twice as long.</p>
                <button type="button" className="secondary-button" onClick={() => void analyze()} disabled={!duration}>
                  {analysis ? 'Look again' : 'Find the moves'}
                </button>
              </>
            )}
          </>
        )}
        {status.kind === 'error' && (
          <>
            <p className="builder-error">{status.message}</p>
            <ReportProblem
              onDownloadDebug={debugDownload}
              context={() => ticketContext(status.step, status.message, status.cause)}
              onTryAgain={() => (file && duration ? void analyze() : reset())}
            />
          </>
        )}
        {analysis?.source.fromDebugFile && <p className="step-hint">Loaded from a debug file: there's no video to watch.</p>}
      </section>

      {analyzing && !analysis && (
        <section className="overview-card builder-step skeleton-step" aria-hidden="true">
          <div className="skeleton skeleton-title" />
          <div className="skeleton-card">
            <div className="skeleton skeleton-line short" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-block" />
          </div>
          <div className="skeleton-card">
            <div className="skeleton skeleton-line short" />
            <div className="skeleton skeleton-line" />
          </div>
        </section>
      )}

      {analysis && (
        <section className="overview-card builder-step">
          <div className="step-head">
            <h2 className="step-title">2. Check the {items.length === 1 ? 'move' : `${items.length} moves`}</h2>
          </div>
          {items.length > 0 && (
            <p className="step-hint">
              In the order they appear. Name each one, fix any range that's off, and delete anything that isn't an exercise.
              {lowCount > 0 && ` ${lowCount} ${lowCount === 1 ? 'needs' : 'need'} a check, so ${lowCount === 1 ? "it's" : "they're"} shown first.`}
            </p>
          )}
          {file && !analysis.source.slow && (lowCount > 0 || items.length === 0) && (
            <div className="report-inline">
              <p className="step-hint">Fast video, or a move missing? Slow analysis takes a closer look.</p>
              <button
                type="button"
                className="text-btn report-open"
                onClick={() => {
                  setSlow(true)
                  void analyze(true)
                }}
              >
                Look again with slow analysis
              </button>
            </div>
          )}
          {items.length > 0 && (
            <UniformBar
              values={uniform.values}
              onValues={(values) => onUniform({ ...uniform, values })}
              count={items.length}
              customCount={items.filter((it) => it.custom).length}
              onApply={applyUniform}
              done={lastApply?.message ?? null}
              onUndo={undoUniform}
            />
          )}
          <ol className="movement-list">
            {checkFirst(items).map(({ it, i }) => (
              <MovementCard
                key={it.key}
                index={i}
                item={it}
                originalIndex={it.copyOf ? items.findIndex((x) => x.key === it.copyOf) : -1}
                hasCopy={items.some((x) => x.copyOf === it.key)}
                canWatch={!!file}
                onForm={(form) => setForm(it.key, form)}
                onWatch={() => watch(it)}
                onRange={(s, e) => setRangeFor(it.key, s, e)}
                reportContext={() =>
                  ticketContext(`Updating the range of move ${i + 1}`, `${it.rangeError ?? ''} (move ${round1(it.movement.start)}–${round1(it.movement.end)} s)`)
                }
                onDismissError={() => update(it.key, { rangeError: undefined })}
                onDownloadDebug={debugDownload}
                onDelete={() => removeItem(it.key)}
                onOtherSide={() => addOtherSide(it.key)}
                onMergeNext={nextOf(it.key) ? () => mergeWithNext(it.key) : undefined}
                onSplit={(at) => splitAt(it.key, at)}
                onMirror={(mirror) => update(it.key, { mirror })}
              />
            ))}
          </ol>

          <details className="manual-add">
            <summary>Add a movement that was missed</summary>
            <p className="step-hint">Watch the video, note where the movement starts and ends, and enter the range.</p>
            <div className="trim">
              <label>
                <span>Start (sec)</span>
                <input type="number" step={0.1} value={manual.start} onChange={(e) => setManual({ ...manual, start: num(e) })} />
              </label>
              <label>
                <span>End (sec)</span>
                <input type="number" step={0.1} value={manual.end} onChange={(e) => setManual({ ...manual, end: num(e) })} />
              </label>
            </div>
            <button type="button" className="secondary-button" onClick={addManual}>
              Add this range as a movement
            </button>
            {manual.error && (
              <>
                <p className="builder-error">{manual.error}</p>
                <ReportProblem
                  onDownloadDebug={debugDownload}
                  compact
                  context={() => ticketContext('Adding a missed movement', `${manual.error} (range ${manual.start}–${manual.end} s)`)}
                  onTryAgain={() => setManual({ ...manual, error: '' })}
                />
              </>
            )}
          </details>

          <div className="report-inline">
            <p className="step-hint">Something look off in these results?</p>
            <ReportProblem
              onDownloadDebug={debugDownload}
              compact
              context={() => ticketContext('Checking the moves')}
              onTryAgain={() => (file && duration ? void analyze() : undefined)}
            />
          </div>

          <button type="button" className="start-button" onClick={add} disabled={items.length === 0}>
            {items.length === 1 ? 'Add to workout' : `Add ${items.length} movements to workout`}
          </button>
        </section>
      )}

      <section className="overview-card builder-step">
        <h2 className="step-title">Your workout</h2>
        {draft.exercises.length === 0 ? (
          <p className="step-hint">Nothing here yet. Add a clip or two, then press start. Small is fine.</p>
        ) : (
          <>
            <label className="workout-name">
              <span>Workout name</span>
              <input type="text" value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} />
            </label>
            <ol className="exercise-list">
              {draft.exercises.map((ex) => (
                <li key={ex.id}>
                  <button type="button" className="play-one-btn" aria-label={`Play ${ex.name} on its own`} onClick={() => playOne(ex)}>
                    ▶
                  </button>
                  <span className="exercise-main">
                    <span className="exercise-name">
                      {ex.name}
                      {ex.mirroredFrom && <span className="tag">other side</span>}
                    </span>
                    {(ex.clip || ex.notes) && (
                      <span className="exercise-meta">
                        {ex.clip && `${formatClock(ex.clip.startSec)}–${formatClock(ex.clip.endSec)} in video`}
                        {ex.clip && ex.notes && ' · '}
                        {ex.notes}
                      </span>
                    )}
                  </span>
                  <span className="exercise-rx">{prescription(ex)}</span>
                  <button type="button" className="remove-btn" aria-label={`Remove ${ex.name}`} onClick={() => remove(ex.id)}>
                    ×
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      {draft.exercises.length > 0 && (
        <div className="overview-actions">
          <button type="button" className="start-button" onClick={start}>
            Start workout
          </button>
          <p className="overview-hint">
            {draft.exercises.length} exercise{draft.exercises.length === 1 ? '' : 's'} · about{' '}
            {formatClock(estimateSec(draft.exercises))}
          </p>
        </div>
      )}
    </main>
  )
}

type CardProps = {
  index: number
  item: Item
  /** For a generated other side: the position of its original in the list. */
  originalIndex: number
  hasCopy: boolean
  canWatch: boolean
  onForm: (form: Form) => void
  onWatch: () => void
  onRange: (start: number, end: number) => void
  reportContext: () => TicketContext
  onDismissError: () => void
  onDownloadDebug?: () => void
  onDelete: () => void
  onOtherSide: () => void
  /** Present when there's a next movement to merge with. */
  onMergeNext?: () => void
  onSplit: (at: number) => void
  onMirror: (mirror: boolean) => void
}

/** Cards detected with low confidence first (to check), each keeping its number in the video's order. */
export function checkFirst(items: Item[]): { it: Item; i: number }[] {
  const low = (it: Item) => (it.checkFirst ? 0 : 1)
  return items.map((it, i) => ({ it, i })).sort((a, b) => low(a.it) - low(b.it) || a.i - b.i)
}

const CONFIDENCE_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' } as const

/** One movement: where it is in the video, how sure we are, a preview, and its settings. */
function MovementCard(p: CardProps) {
  const it = p.item
  const form = it.form
  const m = it.movement
  const r = m.result
  const copy = !!it.copyOf
  const set = (patch: Partial<Form>) => p.onForm({ ...form, ...patch })
  const [edit, setEdit] = useState({ start: round1(m.start), end: round1(m.end) })
  const [splitAtSec, setSplitAtSec] = useState(round1((m.start + m.end) / 2))
  useEffect(() => setSplitAtSec(round1((m.start + m.end) / 2)), [m.start, m.end])
  useEffect(() => setEdit({ start: round1(m.start), end: round1(m.end) }), [m.start, m.end])
  const detected =
    m.kind === 'reps'
      ? `${m.sets.length > 1 ? `${m.sets.length} sets · ` : ''}${m.sets.map((s) => s.reps).join(', ')} rep${
          m.sets.length === 1 && m.sets[0].reps === 1 ? '' : 's'
        } · ${r.secPerRep.toFixed(1)} s per rep`
      : m.kind === 'hold'
        ? `Hold · ${m.sets.map((s) => `${Math.round(s.end - s.start)} s`).join(', ')}`
        : `Moving, no steady rhythm · ${Math.round(m.end - m.start)} s`
  const suggestOtherSide = m.oneSided && !m.bothSidesShown && !copy && !p.hasCopy
  const animation = it.mirror ? mirrorAnimation(r.animation) : r.animation

  return (
    <li className={`movement-card${m.confidence === 'low' ? ' is-low' : ''}`}>
      <div className="movement-head">
        <span className="movement-index">{p.index + 1}.</span>
        {p.canWatch ? (
          <button type="button" className="text-btn movement-time" onClick={p.onWatch}>
            ▶ {formatClock(m.start)}–{formatClock(m.end)}
          </button>
        ) : (
          <span className="movement-time">
            {formatClock(m.start)}–{formatClock(m.end)}
          </span>
        )}
        <span className={`confidence confidence-${m.confidence}`}>
          <span className="confidence-dot" aria-hidden="true" />
          {CONFIDENCE_LABEL[m.confidence]}
        </span>
        {m.confidence === 'low' && <span className="tag tag-check">Check this one</span>}
        {it.custom && <span className="tag">Custom</span>}
        {it.addedByHand && <span className="tag">Added by you</span>}
        {copy && <span className="tag">Other side of {p.originalIndex + 1}</span>}
      </div>

      <div className="movement-summary">
        <h3 className="movement-name">{form.name.trim() || `Movement ${p.index + 1}`}</h3>
        <ul className="plan-chips" aria-label="Plan">
          <li>
            <strong>{form.sets}</strong> {form.sets === 1 ? 'set' : 'sets'}
          </li>
          {form.type === 'rep_based' ? (
            <li>
              <strong>{form.reps}</strong> reps
            </li>
          ) : (
            <li>
              <strong>{form.holdSec}</strong> sec
            </li>
          )}
          <li>
            <strong>{form.restSec}</strong> s rest
          </li>
        </ul>
      </div>

      <div className="movement-insight">
        <AnimationPreview key={animation.id} animation={animation} secPerLoop={form.type === 'rep_based' ? form.tempoSec : r.animation.defaultTempoSec} />
        <div className="movement-detected">
          <p className="result-summary">
            Detected: {detected} · {r.view} view
            {m.oneSided && !copy && (m.bothSidesShown ? ' · one-sided, both sides are in the video' : ' · works one side')}
          </p>
          {m.reasons.length > 0 && <p className="reasons">Why: {m.reasons.join('; ')}.</p>}
        </div>
      </div>

      {copy && (
        <div className="mirror-row">
          <label className="check-label">
            <input type="checkbox" checked={it.mirror} onChange={(e) => p.onMirror(e.target.checked)} />
            Mirror (show the other side)
          </label>
          <p className="step-hint">Flips the stick figure, and the video when you watch it here. On-screen text in the video will appear backwards.</p>
        </div>
      )}

      <div className="form-grid">
        <label className="span-2">
          <span>Exercise name</span>
          <input type="text" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <p className="group-label span-2">Plan</p>
        <div className="span-2 segmented" role="radiogroup" aria-label="Exercise type">
          {(['rep_based', 'time_based'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={form.type === t}
              className={form.type === t ? 'is-on' : ''}
              onClick={() => set({ type: t })}
            >
              {t === 'rep_based' ? 'Reps' : 'Timed'}
            </button>
          ))}
        </div>
        <label>
          <span>Sets</span>
          <input type="number" min={1} max={20} value={form.sets} onChange={(e) => set({ sets: num(e) })} />
        </label>
        {form.type === 'rep_based' ? (
          <label>
            <span>Reps per set</span>
            <input type="number" min={1} max={200} value={form.reps} onChange={(e) => set({ reps: num(e) })} />
          </label>
        ) : (
          <label>
            <span>Seconds per set</span>
            <input type="number" min={1} max={600} value={form.holdSec} onChange={(e) => set({ holdSec: num(e) })} />
          </label>
        )}
        <label>
          <span>Rest after each set (sec)</span>
          <input type="number" min={0} max={600} value={form.restSec} onChange={(e) => set({ restSec: num(e) })} />
        </label>
        {form.type === 'rep_based' && (
          <label>
            <span>Seconds per rep</span>
            <input type="number" min={0.5} max={10} step={0.1} value={form.tempoSec} onChange={(e) => set({ tempoSec: num(e) })} />
          </label>
        )}
        <label className="span-2">
          <span>Form cues / notes (optional)</span>
          <input type="text" value={form.notes} placeholder="e.g. chest up, knees out" onChange={(e) => set({ notes: e.target.value })} />
        </label>
        {!copy && <p className="group-label span-2">In the video</p>}
        {!copy && (
          <div className="span-2 range-edit">
            <label>
              <span>Starts at (sec)</span>
              <input type="number" step={0.1} value={edit.start} onChange={(e) => setEdit({ ...edit, start: num(e) })} />
            </label>
            <label>
              <span>Ends at (sec)</span>
              <input type="number" step={0.1} value={edit.end} onChange={(e) => setEdit({ ...edit, end: num(e) })} />
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={edit.start === round1(m.start) && edit.end === round1(m.end)}
              onClick={() => p.onRange(edit.start, edit.end)}
            >
              Update range
            </button>
            <label>
              <span>Split at (sec)</span>
              <input type="number" step={0.1} value={splitAtSec} onChange={(e) => setSplitAtSec(num(e))} />
            </label>
            <button type="button" className="secondary-button" onClick={() => p.onSplit(splitAtSec)}>
              Split into two here
            </button>
          </div>
        )}
        {it.rangeError && (
          <div className="span-2 card-error">
            <p className="builder-error">{it.rangeError}</p>
            <ReportProblem compact context={p.reportContext} onTryAgain={p.onDismissError} onDownloadDebug={p.onDownloadDebug} />
          </div>
        )}
      </div>

      <div className="card-actions">
        {!copy && (
          <button
            type="button"
            className={suggestOtherSide ? 'secondary-button is-suggested' : 'secondary-button'}
            onClick={p.onOtherSide}
            disabled={p.hasCopy}
          >
            {p.hasCopy ? 'Other side added' : 'Add other side (reverse)'}
          </button>
        )}
        {!copy && p.onMergeNext && (
          <button type="button" className="text-btn" onClick={p.onMergeNext}>
            Merge with the next move
          </button>
        )}
        <button type="button" className="text-btn danger" onClick={p.onDelete}>
          {copy ? 'Remove this copy' : p.hasCopy ? 'Delete (and its other side)' : 'Delete'}
        </button>
      </div>
    </li>
  )
}

function estimateSec(exercises: Exercise[]): number {
  return buildTimeline({ id: 'draft', title: '', exercises }, { loopSecFor }).duration
}
