import { useEffect, useRef, useState } from 'react'
import { loopSecFor } from '../animation/library'
import { buildTimeline } from '../engine/timeline'
import { detectPlatform, extractTyped, PLATFORM_NAME, runLinkPipeline, type PipelineStep } from '../link/client'
import { fallbackMessage } from '../link/messages'
import { blankRow, FIGURES, rowsFrom, rowsReady, toWorkout, type LinkMeta, type LinkRow } from '../link/toWorkout'
import type { LinkFailure, LinkPlatform, LinkPost, LinkWorkout } from '../link/types'
import { formatClock } from '../player/format'
import type { Workout } from '../types'

// "Paste a link": read which exercises are in a reel or Short, let the person
// check the list, then play it with the stick figure. The video itself is
// never downloaded or kept; only its public title and caption are read (and,
// for YouTube, a video model can watch it by URL).

/** The checked list. Kept by App so it survives a trip to the player. */
export type LinkDraft = { url: string; title: string; rows: LinkRow[]; meta: LinkMeta }

type Props = {
  draft: LinkDraft | null
  onChange: (draft: LinkDraft | null) => void
  onBack: () => void
  onUpload: () => void
  onStart: (workout: Workout) => void
}

type Phase =
  | { kind: 'input' }
  | { kind: 'working'; step: PipelineStep | 'typed' }
  | { kind: 'fallback'; reason: LinkFailure; platform: LinkPlatform | null; url: string | null; post: LinkPost | null; typedError?: boolean }

const STEP_TEXT: Record<PipelineStep | 'typed', string> = {
  reading: 'Reading the post…',
  watching: 'Watching the video…',
  typed: 'Reading your list…',
}

const SOURCE_TEXT = { caption: 'From the post’s caption', 'video-model': 'From watching the video', typed: 'From your list' } as const

export function LinkBuilder({ draft, onChange, onBack, onUpload, onStart }: Props) {
  const [url, setUrl] = useState(draft?.url ?? '')
  const [typed, setTyped] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'input' })
  const abort = useRef<AbortController | null>(null)
  const platform = detectPlatform(url)

  useEffect(() => () => abort.current?.abort(), [])

  const begin = () => {
    abort.current?.abort()
    abort.current = new AbortController()
    return abort.current.signal
  }

  const accept = (w: LinkWorkout, meta: Omit<LinkMeta, 'source' | 'confidence'>, link: string) =>
    onChange({ url: link, title: w.title, rows: rowsFrom(w), meta: { ...meta, source: w.source, confidence: w.confidence } })

  const read = async () => {
    if (!url.trim()) return
    const signal = begin()
    onChange(null)
    setPhase({ kind: 'working', step: 'reading' })
    try {
      const r = await runLinkPipeline(url, { signal, onStep: (step) => setPhase({ kind: 'working', step }) })
      if (r.kind === 'ok') {
        accept(r.workout, { platform: r.platform, url: r.url, post: r.post }, url)
        setPhase({ kind: 'input' })
      } else {
        setPhase({ kind: 'fallback', reason: r.reason, platform: r.platform ?? platform, url: r.url, post: r.post })
      }
    } catch {
      setPhase({ kind: 'input' }) // cancelled
    }
  }

  const readTyped = async () => {
    if (!typed.trim() || phase.kind !== 'fallback') return
    const from = phase
    const signal = begin()
    setPhase({ kind: 'working', step: 'typed' })
    try {
      const r = await extractTyped(typed, fetch, signal)
      if (r.ok) {
        accept({ ...r.workout, title: from.post?.title?.slice(0, 80) || r.workout.title }, { platform: from.platform, url: from.url, post: from.post }, url)
        setPhase({ kind: 'input' })
      } else {
        setPhase({ ...from, typedError: true })
      }
    } catch {
      setPhase(from)
    }
  }

  const cancel = () => {
    abort.current?.abort()
    setPhase({ kind: 'input' })
  }

  const startOver = () => {
    onChange(null)
    setTyped('')
    setPhase({ kind: 'input' })
  }

  const working = phase.kind === 'working'

  return (
    <main className="builder">
      <header className="builder-header">
        <button type="button" className="text-btn" onClick={onBack}>
          ← Back
        </button>
        <h1 className="builder-title">Paste a link</h1>
        <p className="builder-note">Saw a workout you liked? Bring it here and do it anywhere.</p>
      </header>

      <section className="card builder-step">
        <form
          className="link-form"
          onSubmit={(e) => {
            e.preventDefault()
            void read()
          }}
        >
          <label className="field">
            <span>Link to a reel, Short or post</span>
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://youtube.com/shorts/…"
              value={url}
              disabled={working}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <div className="link-row">
            {platform ? <span className="chip is-static">{PLATFORM_NAME[platform]}</span> : <span className="step-hint">YouTube, Instagram, Facebook or TikTok</span>}
          </div>
          {working ? (
            <div className="analyze-progress" role="status" aria-live="polite">
              <div className="progress-seg is-busy">
                <div className="progress-fill" />
              </div>
              <span>{STEP_TEXT[phase.step]}</span>
              <button type="button" className="text-btn" onClick={cancel}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="submit" className="primary-button" disabled={!url.trim()}>
              Read the link
            </button>
          )}
        </form>
        <p className="step-hint">We read the post’s public caption to find the moves. The video itself is never saved.</p>
      </section>

      {phase.kind === 'fallback' && (
        <Fallback
          phase={phase}
          typed={typed}
          onTyped={setTyped}
          onReadTyped={() => void readTyped()}
          onUpload={onUpload}
          onRetry={() => void read()}
        />
      )}

      {draft && !working && phase.kind !== 'fallback' && (
        <Review draft={draft} onChange={onChange} onStart={onStart} onStartOver={startOver} />
      )}
    </main>
  )
}

function Fallback(p: {
  phase: Extract<Phase, { kind: 'fallback' }>
  typed: string
  onTyped: (t: string) => void
  onReadTyped: () => void
  onUpload: () => void
  onRetry: () => void
}) {
  const msg = fallbackMessage(p.phase.reason, p.phase.platform)
  const canRetry = p.phase.reason === 'timeout' || p.phase.reason === 'rate_limited' || p.phase.reason === 'too_many_requests' || p.phase.reason === 'upstream'
  return (
    <section className="card builder-step" aria-live="polite">
      <div>
        <h2 className="step-title">{msg.title}</h2>
        <p className="step-hint fallback-body">{msg.body}</p>
      </div>

      <div className="fallback-option">
        <h3 className="option-title">Type or paste the moves</h3>
        <p className="step-hint">One per line, like “Squats 3x12” or “Plank 30s”. Copying the caption works too.</p>
        <label className="field">
          <span className="sr-only">Exercise list</span>
          <textarea rows={5} value={p.typed} placeholder={'Squats 3x12\nPush-ups x10\nPlank 30s'} onChange={(e) => p.onTyped(e.target.value)} />
        </label>
        {p.phase.typedError && <p className="step-hint">Couldn’t spot any moves in that. Try one per line, with a number if you have one.</p>}
        <button type="button" className="primary-button" disabled={!p.typed.trim()} onClick={p.onReadTyped}>
          Use this list
        </button>
      </div>

      <div className="fallback-option">
        <h3 className="option-title">Have the video file?</h3>
        <p className="step-hint">Upload it and pact follows the movement on your device.</p>
        <button type="button" className="secondary-button" onClick={p.onUpload}>
          Upload the video
        </button>
      </div>

      {canRetry && (
        <button type="button" className="text-btn" onClick={p.onRetry}>
          Try the link again
        </button>
      )}
    </section>
  )
}

const CONFIDENCE_NOTE = {
  high: null,
  medium: 'Some numbers were missing, so we filled in steady defaults. Adjust anything that looks off.',
  low: 'This list is a best guess. Give it a quick look before you start.',
} as const

function Review({ draft, onChange, onStart, onStartOver }: { draft: LinkDraft; onChange: (d: LinkDraft) => void; onStart: (w: Workout) => void; onStartOver: () => void }) {
  const { rows } = draft
  const setRows = (next: LinkRow[]) => onChange({ ...draft, rows: next })
  const update = (key: string, patch: Partial<LinkRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const move = (i: number, by: -1 | 1) => {
    const next = rows.slice()
    const [r] = next.splice(i, 1)
    next.splice(i + by, 0, r)
    setRows(next)
  }
  const note = CONFIDENCE_NOTE[draft.meta.confidence]
  const workout = rowsReady(rows) ? toWorkout(draft.title, rows, draft.meta) : null
  const ready = rows.length > 0 && workout !== null

  return (
    <>
      <section className="card builder-step">
        <div className="step-head">
          <h2 className="step-title">Check the moves</h2>
          <span className="chip is-static">{SOURCE_TEXT[draft.meta.source]}</span>
        </div>
        {note && <p className={draft.meta.confidence === 'low' ? 'notice' : 'step-hint'}>{note}</p>}
        <label className="field">
          <span>Workout name</span>
          <input type="text" value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} />
        </label>

        <ol className="movement-list">
          {rows.map((r, i) => (
            <RowCard
              key={r.key}
              row={r}
              index={i}
              count={rows.length}
              onChange={(patch) => update(r.key, patch)}
              onMove={(by) => move(i, by)}
              onRemove={() => setRows(rows.filter((x) => x.key !== r.key))}
            />
          ))}
        </ol>
        {rows.length === 0 && <p className="step-hint">No moves yet. Add one below.</p>}

        <button type="button" className="secondary-button" onClick={() => setRows([...rows, blankRow()])}>
          Add a move
        </button>
      </section>

      <div className="overview-actions">
        <button type="button" className="primary-button is-large" disabled={!ready} onClick={() => workout && onStart(workout)}>
          Start workout
        </button>
        <p className="overview-hint">
          {ready && workout
            ? `${rows.length} move${rows.length === 1 ? '' : 's'} · about ${formatClock(buildTimeline(workout, { loopSecFor }).duration)}. Short or long, it counts.`
            : 'Give every move a name to start.'}
        </p>
        <button type="button" className="text-btn" onClick={onStartOver}>
          Start over with a new link
        </button>
      </div>
    </>
  )
}

function RowCard(p: { row: LinkRow; index: number; count: number; onChange: (patch: Partial<LinkRow>) => void; onMove: (by: -1 | 1) => void; onRemove: () => void }) {
  const { row: r } = p
  const n = (v: string) => Math.max(0, Number(v) || 0)
  const label = r.name.trim() || `move ${p.index + 1}`
  return (
    <li className="movement-card">
      <div className="movement-head">
        <span className="movement-index">{p.index + 1}.</span>
        <span className="exercise-rx">{rx(r)}</span>
        <span className="row-tools">
          <button type="button" className="icon-chip" aria-label={`Move ${label} up`} disabled={p.index === 0} onClick={() => p.onMove(-1)}>
            ↑
          </button>
          <button type="button" className="icon-chip" aria-label={`Move ${label} down`} disabled={p.index === p.count - 1} onClick={() => p.onMove(1)}>
            ↓
          </button>
          <button type="button" className="icon-chip" aria-label={`Remove ${label}`} onClick={p.onRemove}>
            ×
          </button>
        </span>
      </div>

      <div className="form-grid">
        <label className="span-2">
          <span>Exercise name</span>
          <input type="text" value={r.name} placeholder="Name this move" onChange={(e) => p.onChange({ name: e.target.value })} />
        </label>
        <div className="span-2 segmented" role="radiogroup" aria-label="Exercise type">
          {(['rep_based', 'time_based'] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={r.type === t} className={r.type === t ? 'is-on' : ''} onClick={() => p.onChange({ type: t })}>
              {t === 'rep_based' ? 'Reps' : 'Timed'}
            </button>
          ))}
        </div>
        <label>
          <span>Sets</span>
          <input type="number" min={1} max={20} value={r.sets} onChange={(e) => p.onChange({ sets: n(e.target.value) })} />
        </label>
        {r.type === 'rep_based' ? (
          <label>
            <span>Reps per set</span>
            <input type="number" min={1} max={300} value={r.reps} onChange={(e) => p.onChange({ reps: n(e.target.value) })} />
          </label>
        ) : (
          <label>
            <span>Seconds per set</span>
            <input type="number" min={1} max={3600} value={r.holdSec} onChange={(e) => p.onChange({ holdSec: n(e.target.value) })} />
          </label>
        )}
        <label>
          <span>Rest after each set (sec)</span>
          <input type="number" min={0} max={600} value={r.restSec} onChange={(e) => p.onChange({ restSec: n(e.target.value) })} />
        </label>
        <label>
          <span>Stick figure</span>
          <select value={r.animationId} onChange={(e) => p.onChange({ animationId: e.target.value })}>
            {FIGURES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          <span>Form cues / notes (optional)</span>
          <input type="text" value={r.notes} onChange={(e) => p.onChange({ notes: e.target.value })} />
        </label>
      </div>
    </li>
  )
}

/** "3 × 12", "1 × 30 sec" */
const rx = (r: LinkRow) => `${Math.max(1, r.sets)} × ${r.type === 'rep_based' ? r.reps : `${r.holdSec} sec`}`
