import { useEffect, useRef, useState } from 'react'
import { LIMITS, type Uniform } from '../review/uniform'

// "Set for all movements": sets, reps and rest once, applied to every card
// below. Cards edited by hand ("Custom") are kept unless the person chooses
// to replace them, and every apply can be undone.

type Props = {
  values: Uniform
  onValues: (u: Uniform) => void
  /** How many cards there are, and how many were edited by hand. */
  count: number
  customCount: number
  onApply: (replaceCustom: boolean) => void
  /** What the last apply did, while it can still be undone. */
  done: string | null
  onUndo: () => void
}

const toField = (n: number | null) => (n == null ? '' : String(n))

export function UniformBar({ values, onValues, count, customCount, onApply, done, onUndo }: Props) {
  // Text while typing (a field can be briefly empty); numbers go up as soon as they parse.
  const [text, setText] = useState(() => ({
    sets: toField(values.sets),
    reps: toField(values.reps),
    restSec: toField(values.restSec),
    holdSec: toField(values.holdSec),
  }))
  const [asking, setAsking] = useState(false)
  const keepButton = useRef<HTMLButtonElement>(null)
  const undoButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (asking) keepButton.current?.focus()
  }, [asking])
  useEffect(() => {
    if (done) undoButton.current?.focus()
  }, [done])

  const field = (k: keyof typeof text) => (v: string) => {
    setText((t) => ({ ...t, [k]: v }))
    const n = Number(v)
    if (k === 'holdSec') onValues({ ...values, holdSec: v.trim() === '' || !(n > 0) ? null : n })
    else if (v.trim() !== '' && Number.isFinite(n)) onValues({ ...values, [k]: n })
  }

  const apply = () => {
    if (customCount > 0) setAsking(true)
    else onApply(false)
  }
  const choose = (replaceCustom: boolean) => {
    setAsking(false)
    onApply(replaceCustom)
  }

  return (
    <form
      className="uniform-bar"
      aria-labelledby="uniform-title"
      onSubmit={(e) => {
        e.preventDefault()
        apply()
      }}
    >
      <div className="uniform-head">
        <h3 id="uniform-title" className="option-title">
          Set for all movements
        </h3>
        <p className="step-hint">
          One plan for every move below. Timed moves keep their time unless you set one. Moves you’ve changed by hand are marked
          Custom.
        </p>
      </div>
      <div className="uniform-fields">
        <label>
          <span>Sets</span>
          <input type="number" inputMode="numeric" min={LIMITS.sets[0]} max={LIMITS.sets[1]} required value={text.sets} onChange={(e) => field('sets')(e.target.value)} />
        </label>
        <label>
          <span>Reps</span>
          <input type="number" inputMode="numeric" min={LIMITS.reps[0]} max={LIMITS.reps[1]} required value={text.reps} onChange={(e) => field('reps')(e.target.value)} />
        </label>
        <label>
          <span>Rest between sets (sec)</span>
          <input type="number" inputMode="numeric" min={LIMITS.restSec[0]} max={LIMITS.restSec[1]} required value={text.restSec} onChange={(e) => field('restSec')(e.target.value)} />
        </label>
        <label>
          <span>Time for timed moves (sec, optional)</span>
          <input
            type="number"
            inputMode="numeric"
            min={LIMITS.holdSec[0]}
            max={LIMITS.holdSec[1]}
            placeholder="Keep each"
            value={text.holdSec}
            onChange={(e) => field('holdSec')(e.target.value)}
          />
        </label>
      </div>

      {asking ? (
        <div className="uniform-ask" role="group" aria-labelledby="uniform-ask-title">
          <p id="uniform-ask-title" className="uniform-ask-title">
            Replace custom changes too?
          </p>
          <p className="step-hint">
            {customCount} of {count} moves {customCount === 1 ? 'has' : 'have'} values you set by hand.
          </p>
          <div className="report-actions">
            <button ref={keepButton} type="button" className="primary-button" onClick={() => choose(false)}>
              Keep my custom ones
            </button>
            <button type="button" className="secondary-button" onClick={() => choose(true)}>
              Replace everything
            </button>
          </div>
        </div>
      ) : (
        <button type="submit" className="primary-button" disabled={count === 0}>
          Apply to all
        </button>
      )}

      {done && !asking && (
        <p className="uniform-done" role="status">
          <span>{done}</span>
          <button ref={undoButton} type="button" className="text-btn" onClick={onUndo}>
            Undo
          </button>
        </p>
      )}
    </form>
  )
}
