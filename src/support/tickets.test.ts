import { describe, expect, it } from 'vitest'
import { buildTicket, EMPTY_FORM, localTicketStore, newTicketId, submitReport, TICKETS_KEY, type TicketContext, type TicketStore } from './tickets'

const device = { userAgent: 'UA', platform: 'Windows', language: 'en-US', screen: '1920×1080 @1x', viewport: '400×800' }
const context: TicketContext = {
  step: 'Following the movement (body tracking)',
  error: { message: 'Body tracking didn’t start', stack: 'Error: boom\n  at trackVideo' },
  video: { name: 'legs.mp4', sizeBytes: 12_345_678, durationSec: 83.2 },
  detection: { movements: [{ name: 'Movement 1', start: 5.2, end: 12.5 }] },
}
const opts = { now: new Date('2026-10-25T10:00:00Z'), device, id: 'PACT-TEST-0001' }

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data }
}

describe('buildTicket', () => {
  it('records the moment, the device, the error and the video facts', () => {
    const t = buildTicket(context, { doing: ' split my clip ', email: 'me@example.com', includeTechnical: true }, opts)
    expect(t).toMatchObject({
      id: 'PACT-TEST-0001',
      createdAt: '2026-10-25T10:00:00.000Z',
      step: 'Following the movement (body tracking)',
      doing: 'split my clip',
      email: 'me@example.com',
      technical: {
        device,
        error: { message: 'Body tracking didn’t start', stack: 'Error: boom\n  at trackVideo' },
        video: { name: 'legs.mp4', sizeBytes: 12_345_678, durationSec: 83.2 },
        detection: { movements: [{ name: 'Movement 1' }] },
      },
    })
    expect(typeof t.appVersion).toBe('string')
  })

  it('leaves technical details out when unchecked, and blank fields as null', () => {
    const t = buildTicket(context, { ...EMPTY_FORM, includeTechnical: false }, opts)
    expect(t.technical).toBeNull()
    expect(t.doing).toBeNull()
    expect(t.email).toBeNull()
    expect(JSON.stringify(t)).not.toContain('legs.mp4')
  })

  it('has "include technical details" checked by default', () => {
    expect(EMPTY_FORM.includeTechnical).toBe(true)
  })

  it('makes short readable ids', () => {
    expect(newTicketId()).toMatch(/^PACT-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/)
  })
})

describe('submitReport', () => {
  it('saves to the store and returns the ticket', async () => {
    const storage = memoryStorage()
    const store = localTicketStore(storage)
    const r = await submitReport(context, EMPTY_FORM, store, opts)
    expect(r.ok).toBe(true)
    expect(store.list().map((t) => t.id)).toEqual(['PACT-TEST-0001'])
    expect(JSON.parse(storage.data.get(TICKETS_KEY)!)).toHaveLength(1)
  })

  it('keeps only the latest 50 tickets', async () => {
    const store = localTicketStore(memoryStorage())
    for (let i = 0; i < 55; i++) await store.save(buildTicket(context, EMPTY_FORM, { ...opts, id: `T${i}` }))
    expect(store.list()).toHaveLength(50)
    expect(store.list()[0].id).toBe('T5')
  })

  it('when saving fails, offers the details as plain text to copy', async () => {
    const failing: TicketStore = { save: async () => Promise.reject(new Error('QuotaExceededError')) }
    const r = await submitReport(context, { doing: 'split my clip', email: '', includeTechnical: true }, failing, opts)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.details).toContain('PACT-TEST-0001')
    expect(r.details).toContain('Step: Following the movement (body tracking)')
    expect(r.details).toContain('Trying to: split my clip')
    expect(r.details).toContain('legs.mp4')
  })

  it('a blocked localStorage counts as a failure, not a crash', async () => {
    const blocked = localTicketStore({ getItem: () => null, setItem: () => { throw new Error('blocked') } })
    expect((await submitReport(context, EMPTY_FORM, blocked, opts)).ok).toBe(false)
    expect((await submitReport(context, EMPTY_FORM, localTicketStore(null), opts)).ok).toBe(false)
  })
})
