// "Report a problem": turns an error (or a confusing result) into a ticket
// record, and saves it through one small interface so the destination can
// change later (email, a form service, a helpdesk) without touching the UI.
//
// The uploaded video itself is never included: only its name, size and length.

declare const __APP_VERSION__: string | undefined

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

/** What was going on when the person tapped "Report a problem". */
export type TicketContext = {
  /** Plain words for the step, e.g. "Finding the moves". */
  step: string
  error?: { message: string; stack?: string }
  video?: { name: string; sizeBytes: number | null; durationSec: number | null }
  /** Detection results at that point (movements, pieces, decisions). Never video frames. */
  detection?: unknown
}

export type TicketForm = {
  /** What they were trying to do (optional). */
  doing: string
  /** Optional, for a reply. */
  email: string
  /** Checked by default. */
  includeTechnical: boolean
}

export const EMPTY_FORM: TicketForm = { doing: '', email: '', includeTechnical: true }

export type DeviceInfo = { userAgent: string; platform: string; language: string; screen: string; viewport: string }

export type Ticket = {
  id: string
  createdAt: string
  appVersion: string
  step: string
  doing: string | null
  email: string | null
  /** null when "include technical details" was unchecked. */
  technical: {
    device: DeviceInfo
    error: { message: string; stack: string | null } | null
    video: TicketContext['video'] | null
    detection: unknown
  } | null
}

/** Where tickets go. Swap this for email, a form service or a helpdesk. */
export interface TicketStore {
  save(ticket: Ticket): Promise<void>
}

export function deviceInfo(): DeviceInfo {
  const nav = typeof navigator === 'undefined' ? null : navigator
  const win = typeof window === 'undefined' ? null : window
  return {
    userAgent: nav?.userAgent ?? 'unknown',
    platform: (nav as { userAgentData?: { platform?: string } } | null)?.userAgentData?.platform ?? nav?.platform ?? 'unknown',
    language: nav?.language ?? 'unknown',
    screen: win ? `${win.screen.width}×${win.screen.height} @${win.devicePixelRatio}x` : 'unknown',
    viewport: win ? `${win.innerWidth}×${win.innerHeight}` : 'unknown',
  }
}

/** "PACT-K3F9-7QXM": short, readable, no 0/O or 1/I mix-ups. */
export function newTicketId(random: () => number = Math.random): string {
  const abc = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  const pick = (n: number) => Array.from({ length: n }, () => abc[Math.floor(random() * abc.length)]).join('')
  return `PACT-${pick(4)}-${pick(4)}`
}

export function buildTicket(
  context: TicketContext,
  form: TicketForm,
  opts: { now?: Date; device?: DeviceInfo; id?: string } = {},
): Ticket {
  const trim = (s: string, max: number) => s.trim().slice(0, max) || null
  return {
    id: opts.id ?? newTicketId(),
    createdAt: (opts.now ?? new Date()).toISOString(),
    appVersion: APP_VERSION,
    step: context.step,
    doing: trim(form.doing, 2000),
    email: trim(form.email, 200),
    technical: form.includeTechnical
      ? {
          device: opts.device ?? deviceInfo(),
          error: context.error ? { message: context.error.message, stack: context.error.stack ?? null } : null,
          video: context.video ?? null,
          detection: context.detection ?? null,
        }
      : null,
  }
}

/** Plain text for "Copy details", when saving fails. */
export function ticketToText(t: Ticket): string {
  const lines = [
    `pact problem report ${t.id}`,
    `When: ${t.createdAt}`,
    `App version: ${t.appVersion}`,
    `Step: ${t.step}`,
    `Trying to: ${t.doing ?? '(not given)'}`,
    `Email: ${t.email ?? '(not given)'}`,
  ]
  if (t.technical) lines.push('', 'Technical details:', JSON.stringify(t.technical, null, 2))
  return lines.join('\n')
}

export type SubmitResult = { ok: true; ticket: Ticket } | { ok: false; ticket: Ticket; details: string }

export async function submitReport(context: TicketContext, form: TicketForm, store: TicketStore, opts?: Parameters<typeof buildTicket>[2]): Promise<SubmitResult> {
  const ticket = buildTicket(context, form, opts)
  try {
    await store.save(ticket)
    return { ok: true, ticket }
  } catch (e) {
    console.warn('[pact] could not save the ticket:', e)
    return { ok: false, ticket, details: ticketToText(ticket) }
  }
}

// ----- The store used for now: this browser's localStorage -----

export const TICKETS_KEY = 'pact-tickets'
const KEEP = 50

type KeyValue = Pick<Storage, 'getItem' | 'setItem'>

export function localTicketStore(storage: KeyValue | null = typeof localStorage === 'undefined' ? null : localStorage) {
  const list = (): Ticket[] => {
    try {
      const v = JSON.parse(storage?.getItem(TICKETS_KEY) ?? '[]')
      return Array.isArray(v) ? v : []
    } catch {
      return []
    }
  }
  return {
    async save(ticket: Ticket) {
      if (!storage) throw new Error('No local storage here')
      // Throws when storage is full or blocked; the UI then offers "Copy details".
      storage.setItem(TICKETS_KEY, JSON.stringify([...list(), ticket].slice(-KEEP)))
    },
    list,
  } satisfies TicketStore & { list(): Ticket[] }
}

/** The app's store. Change this line to send tickets somewhere else. */
export const ticketStore: TicketStore = localTicketStore()

/**
 * Reading tickets: in the browser console on the app's page,
 *   pactTickets.list()      every saved ticket, newest last
 *   pactTickets.download()  saves them all as pact-tickets.json
 */
export function exposeTicketsForReading(win: Window = window) {
  const store = localTicketStore()
  ;(win as unknown as { pactTickets: unknown }).pactTickets = {
    list: store.list,
    download() {
      const url = URL.createObjectURL(new Blob([JSON.stringify(store.list(), null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'pact-tickets.json'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
  }
}
