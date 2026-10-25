import { useState } from 'react'
import { EMPTY_FORM, submitReport, ticketStore, type TicketContext, type TicketForm, type TicketStore } from '../support/tickets'

// "Report a problem": a button that opens a short form, saves a ticket, and
// shows its ID. If saving fails, the details can be copied instead.

type Props = {
  /** Called when the form is sent, so it captures what's true at that moment. */
  context: () => TicketContext
  /** What "Try again" does after reporting (e.g. run the analysis again). */
  onTryAgain: () => void
  store?: TicketStore
  /** Shorter wording inside a movement card. */
  compact?: boolean
}

type View =
  | { kind: 'closed' }
  | { kind: 'form'; saving: boolean }
  | { kind: 'saved'; id: string }
  | { kind: 'failed'; details: string }

export function ReportProblem({ context, onTryAgain, store = ticketStore, compact = false }: Props) {
  const [view, setView] = useState<View>({ kind: 'closed' })
  const [form, setForm] = useState<TicketForm>(EMPTY_FORM)

  const send = async () => {
    setView({ kind: 'form', saving: true })
    const r = await submitReport(context(), form, store)
    setView(r.ok ? { kind: 'saved', id: r.ticket.id } : { kind: 'failed', details: r.details })
  }
  const tryAgain = () => {
    setView({ kind: 'closed' })
    setForm(EMPTY_FORM)
    onTryAgain()
  }

  switch (view.kind) {
    case 'closed':
      return (
        <button type="button" className={compact ? 'text-btn report-open' : 'secondary-button report-open'} onClick={() => setView({ kind: 'form', saving: false })}>
          Report a problem
        </button>
      )
    case 'form':
      return <ReportForm value={form} saving={view.saving} onChange={setForm} onSubmit={() => void send()} onCancel={() => setView({ kind: 'closed' })} />
    case 'saved':
      return <ReportSaved id={view.id} onTryAgain={tryAgain} />
    case 'failed':
      return <ReportFailed details={view.details} onTryAgain={tryAgain} />
  }
}

export function ReportForm(p: { value: TicketForm; saving: boolean; onChange: (f: TicketForm) => void; onSubmit: () => void; onCancel: () => void }) {
  const f = p.value
  return (
    <form
      className="report"
      onSubmit={(e) => {
        e.preventDefault()
        p.onSubmit()
      }}
    >
      <div>
        <h3 className="option-title">Something went sideways. Let’s get it sorted.</h3>
        <p className="step-hint">A few words help, but everything here is optional.</p>
      </div>
      <label className="field">
        <span>What were you trying to do? (optional)</span>
        <textarea rows={3} value={f.doing} placeholder="For example: split a 2-minute clip into its moves" onChange={(e) => p.onChange({ ...f, doing: e.target.value })} />
      </label>
      <label className="field">
        <span>Your email, if you’d like a reply (optional)</span>
        <input type="email" autoComplete="email" value={f.email} onChange={(e) => p.onChange({ ...f, email: e.target.value })} />
      </label>
      <label className="check-label">
        <input type="checkbox" checked={f.includeTechnical} onChange={(e) => p.onChange({ ...f, includeTechnical: e.target.checked })} />
        Include technical details
      </label>
      <p className="step-hint">
        Your browser and device, the error, what was detected so far, and the video’s name, size and length. Never the video itself.
      </p>
      <div className="report-actions">
        <button type="submit" className="primary-button" disabled={p.saving}>
          {p.saving ? 'Sending…' : 'Send report'}
        </button>
        <button type="button" className="text-btn" onClick={p.onCancel} disabled={p.saving}>
          Not now
        </button>
      </div>
    </form>
  )
}

export function ReportSaved({ id, onTryAgain }: { id: string; onTryAgain: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="report" role="status">
      <h3 className="option-title">Got it. Thanks for telling us.</h3>
      <p className="step-hint">If you get in touch about this, mention this ticket:</p>
      <p className="ticket-id">
        <code>{id}</code>
        <button type="button" className="chip" onClick={() => void copyText(id).then(setCopied)}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </p>
      <button type="button" className="secondary-button" onClick={onTryAgain}>
        Try again
      </button>
    </div>
  )
}

export function ReportFailed({ details, onTryAgain }: { details: string; onTryAgain: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="report" role="status">
      <h3 className="option-title">The report didn’t save</h3>
      <p className="step-hint">No problem. Copy the details below and send them along however suits you.</p>
      <label className="field">
        <span className="sr-only">Report details</span>
        <textarea readOnly rows={6} value={details} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <div className="report-actions">
        <button type="button" className="primary-button" onClick={() => void copyText(details).then(setCopied)}>
          {copied ? 'Copied' : 'Copy details'}
        </button>
        <button type="button" className="text-btn" onClick={onTryAgain}>
          Try again
        </button>
      </div>
    </div>
  )
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false // the text stays visible and selectable
  }
}
