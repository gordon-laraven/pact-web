import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { loopSecFor, registerAnimation } from '../animation/library'
import { buildTimeline } from '../engine/timeline'
import { ExtractError, type Landmark } from '../extract/extract'
import { OVERLAY_BONES, trackVideo } from '../extract/mediapipe'
import { extractMovements, type Movement } from '../extract/segment'
import { formatClock, prescription } from '../player/format'
import type { Exercise, Workout } from '../types'
import { AnimationPreview } from './AnimationPreview'

// "Make from video": pick a clip, track the body, split it into its movements,
// extract one clean rep of each, and add them to a workout. Everything happens
// in the browser; nothing is uploaded.

export type Draft = { title: string; exercises: Exercise[] }

type Props = {
  draft: Draft
  onChange: (draft: Draft) => void
  onBack: () => void
  onStart: (workout: Workout) => void
}

type Status =
  | { kind: 'idle' }
  | { kind: 'analyzing'; progress: number }
  | { kind: 'done'; movements: Movement[] }
  | { kind: 'error'; message: string }

type Form = {
  include: boolean
  name: string
  notes: string
  type: Exercise['type']
  sets: number
  reps: number
  holdSec: number
  restSec: number
  tempoSec: number
}

/** Starting values for a movement's form, from what was detected in the video. */
function formFor(m: Movement, n: number): Form {
  const hold = m.result.kind === 'hold'
  const reps = m.sets.map((s) => s.reps).filter((r) => r > 0)
  const durations = m.sets.map((s) => s.end - s.start)
  return {
    include: true,
    name: `Movement ${n}`,
    notes: '',
    type: hold ? 'time_based' : 'rep_based',
    sets: m.sets.length,
    reps: reps.length ? Math.max(...reps) : 10,
    holdSec: Math.max(5, Math.round(Math.max(...durations))),
    restSec: 15,
    tempoSec: clamp(m.result.secPerRep, 0.5, 10),
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (e: ChangeEvent<HTMLInputElement>) => Number(e.target.value)

export function VideoBuilder({ draft, onChange, onBack, onStart }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const abort = useRef<AbortController | null>(null)
  const [file, setFile] = useState<{ name: string; url: string } | null>(null)
  const [duration, setDuration] = useState(0)
  const [range, setRange] = useState({ start: 0, end: 0 })
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [forms, setForms] = useState<Form[]>([])

  // Release the video and stop any analysis when leaving the screen.
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => () => void (file && URL.revokeObjectURL(file.url)), [file])

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again
    if (!f) return
    abort.current?.abort()
    setFile({ name: f.name, url: URL.createObjectURL(f) })
    setStatus({ kind: 'idle' })
    setForms([])
    clearOverlay()
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
    const accent = getComputedStyle(c).getPropertyValue('--accent-tint').trim() || '#8fd6b0'
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

  const analyze = async () => {
    const v = video.current
    if (!v || !file) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setForms([])
    setStatus({ kind: 'analyzing', progress: 0 })
    try {
      const clip = await trackVideo(v, {
        start: range.start,
        end: range.end > range.start ? range.end : duration,
        signal: controller.signal,
        onFrame: drawOverlay,
        onProgress: (p) => setStatus({ kind: 'analyzing', progress: p }),
      })
      // Dev-only: lets you inspect raw tracking from the console (window.__pactClip).
      if (import.meta.env.DEV) (window as unknown as { __pactClip?: unknown }).__pactClip = clip
      const movements = extractMovements(clip, `video-${Date.now().toString(36)}`)
      movements.forEach((m) => registerAnimation(m.result.animation))
      setStatus({ kind: 'done', movements })
      setForms(movements.map((m, i) => formFor(m, draft.exercises.length + i + 1)))
    } catch (err) {
      if (controller.signal.aborted) return
      const message =
        err instanceof ExtractError
          ? err.message
          : "Couldn't run body tracking. Check your internet connection (the tracking model downloads on first use) and try again."
      if (!(err instanceof ExtractError)) console.warn('[pact] pose tracking failed:', err)
      setStatus({ kind: 'error', message })
    }
  }

  const cancel = () => {
    abort.current?.abort()
    setStatus({ kind: 'idle' })
    clearOverlay()
  }

  /** Play one movement's part of the source video, then stop. */
  const watch = (m: Movement) => {
    const v = video.current
    if (!v) return
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

  const add = () => {
    if (status.kind !== 'done') return
    const exercises: Exercise[] = []
    status.movements.forEach((m, i) => {
      const form = forms[i]
      if (!form?.include) return
      const set =
        form.type === 'rep_based'
          ? { reps: clamp(Math.round(form.reps), 1, 200), restAfterSec: clamp(form.restSec, 0, 600) }
          : { holdSec: clamp(Math.round(form.holdSec), 1, 600), restAfterSec: clamp(form.restSec, 0, 600) }
      exercises.push({
        id: `${m.result.animation.id}-ex`,
        name: form.name.trim() || `Movement ${draft.exercises.length + exercises.length + 1}`,
        type: form.type,
        animationId: m.result.animation.id,
        sets: Array.from({ length: clamp(Math.round(form.sets), 1, 20) }, () => ({ ...set })),
        tempoSec: form.type === 'rep_based' ? clamp(form.tempoSec, 0.5, 10) : undefined,
        clip: { startSec: round1(m.start), endSec: round1(m.end) },
        notes: form.notes.trim() || undefined,
      })
    })
    if (exercises.length === 0) return
    onChange({ ...draft, exercises: [...draft.exercises, ...exercises] })
    setFile(null)
    setStatus({ kind: 'idle' })
    setForms([])
  }

  const remove = (id: string) => onChange({ ...draft, exercises: draft.exercises.filter((e) => e.id !== id) })

  const workout = (exercises: Exercise[], id: string, title: string): Workout => ({
    id,
    title,
    source: { platform: 'manual' },
    exercises,
  })
  const start = () => onStart(workout(draft.exercises, 'my-workout', draft.title.trim() || 'My workout'))
  // Play a single movement on its own (with the usual get-ready countdown).
  const playOne = (ex: Exercise) => onStart(workout([ex], `my-workout-${ex.id}`, ex.name))

  const analyzing = status.kind === 'analyzing'
  const movements = status.kind === 'done' ? status.movements : null
  const included = forms.filter((f) => f.include).length
  const setForm = (i: number, f: Form) => setForms((all) => all.map((x, k) => (k === i ? f : x)))

  return (
    <main className="builder">
      <header className="builder-header">
        <button type="button" className="text-btn" onClick={onBack}>
          ← Back
        </button>
        <h1 className="builder-title">Make from video</h1>
        <p className="builder-note">Your video stays on this device. Nothing is uploaded.</p>
      </header>

      <section className="overview-card builder-step">
        <h2 className="step-title">1. Choose a clip</h2>
        <p className="step-hint">
          One person, whole body in frame, side-on or facing the camera. A clip with several exercises is split into one
          entry per movement.
        </p>
        <label className="file-btn">
          {file ? 'Choose a different video' : 'Choose video'}
          <input type="file" accept="video/*" onChange={pick} hidden />
        </label>

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
                <div className="progress-seg">
                  <div className="progress-fill" style={{ transform: `scaleX(${status.progress})` }} />
                </div>
                <span>{status.progress === 0 ? 'Loading body tracking…' : `Tracking body… ${Math.round(status.progress * 100)}%`}</span>
                <button type="button" className="text-btn" onClick={cancel}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className="secondary-button" onClick={analyze} disabled={!duration}>
                {movements ? 'Analyze again' : 'Analyze movement'}
              </button>
            )}
            {status.kind === 'error' && <p className="builder-error">{status.message}</p>}
          </>
        )}
      </section>

      {movements && (
        <section className="overview-card builder-step">
          <h2 className="step-title">
            2. Check the {movements.length === 1 ? 'move' : `${movements.length} moves`}
          </h2>
          {movements.length > 1 && (
            <p className="step-hint">
              Found {movements.length} movements, in the order they appear. Name each one, and untick any you don't want.
            </p>
          )}
          <ol className="movement-list">
            {movements.map((m, i) => (
              <MovementCard
                key={m.result.animation.id}
                index={i}
                count={movements.length}
                movement={m}
                form={forms[i]}
                onChange={(f) => setForm(i, f)}
                onWatch={() => watch(m)}
              />
            ))}
          </ol>
          <button type="button" className="start-button" onClick={add} disabled={included === 0}>
            {included === 1 ? 'Add to workout' : `Add ${included} movements to workout`}
          </button>
        </section>
      )}

      <section className="overview-card builder-step">
        <h2 className="step-title">Your workout</h2>
        {draft.exercises.length === 0 ? (
          <p className="step-hint">Movements you add appear here, in order. Add as many clips as you like, then press Start.</p>
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
                    <span className="exercise-name">{ex.name}</span>
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
  count: number
  movement: Movement
  form: Form
  onChange: (form: Form) => void
  onWatch: () => void
}

/** One detected movement: where it is in the video, a preview, and its settings. */
function MovementCard({ index, count, movement: m, form, onChange, onWatch }: CardProps) {
  const r = m.result
  const set = (patch: Partial<Form>) => onChange({ ...form, ...patch })
  const detected =
    r.kind === 'reps'
      ? `${m.sets.length > 1 ? `${m.sets.length} sets · ` : ''}${m.sets.map((s) => s.reps).join(', ')} rep${
          m.sets.length === 1 && m.sets[0].reps === 1 ? '' : 's'
        } · ${r.secPerRep.toFixed(1)} s per rep`
      : `Hold · ${m.sets.map((s) => `${Math.round(s.end - s.start)} s`).join(', ')}`
  return (
    <li className={`movement-card${form.include ? '' : ' is-excluded'}`}>
      <div className="movement-head">
        {count > 1 && (
          <label className="include">
            <input type="checkbox" checked={form.include} onChange={(e) => set({ include: e.target.checked })} />
            <span className="sr-only">Include movement {index + 1}</span>
          </label>
        )}
        <span className="movement-index">{count > 1 ? `${index + 1}.` : ''}</span>
        <button type="button" className="text-btn movement-time" onClick={onWatch}>
          ▶ {formatClock(m.start)}–{formatClock(m.end)}
        </button>
      </div>
      {form.include && (
        <>
          <AnimationPreview animation={r.animation} secPerLoop={form.type === 'rep_based' ? form.tempoSec : r.animation.defaultTempoSec} />
          <p className="result-summary">
            Detected: {detected} · {r.view} view
            {r.kind === 'reps' && r.confidence < 0.5 && ' · the reps were irregular, so check the preview'}
          </p>
          <div className="form-grid">
            <label className="span-2">
              <span>Exercise name</span>
              <input type="text" value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
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
              <input
                type="text"
                value={form.notes}
                placeholder="e.g. chest up, knees out"
                onChange={(e) => set({ notes: e.target.value })}
              />
            </label>
          </div>
        </>
      )}
    </li>
  )
}

const round1 = (x: number) => Math.round(x * 10) / 10

function estimateSec(exercises: Exercise[]): number {
  return buildTimeline({ id: 'draft', title: '', exercises }, { loopSecFor }).duration
}
