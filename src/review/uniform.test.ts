import { describe, expect, it } from 'vitest'
import { applyToAll, applyToPlan, changesPlan, cleanUniform, forNewMovement, undoApply, type Plan } from './uniform'

type Card = { key: string; form: Plan & { name: string }; custom?: boolean; copyOf?: string }
const reps = (key: string, sets = 1, n = 8, custom = false): Card => ({ key, form: { name: key, type: 'rep_based', sets, reps: n, holdSec: 30, restSec: 15 }, custom })
const timed = (key: string, holdSec = 45): Card => ({ key, form: { name: key, type: 'time_based', sets: 1, reps: 10, holdSec, restSec: 15 } })
const u = { sets: 3, reps: 10, restSec: 30, holdSec: null }

describe('Set for all movements', () => {
  it('applies sets, reps and rest to every movement in one go', () => {
    const r = applyToAll([reps('a'), reps('b', 2, 12)], u, { replaceCustom: false })
    expect(r.items.map((i) => [i.form.sets, i.form.reps, i.form.restSec])).toEqual([
      [3, 10, 30],
      [3, 10, 30],
    ])
    expect(r.applied).toBe(2)
    expect(r.items[0].form.name).toBe('a') // names and other fields untouched
  })

  it('keeps movements edited by hand, by default', () => {
    const r = applyToAll([reps('a'), reps('mine', 5, 5, true)], u, { replaceCustom: false })
    expect(r.items[1].form).toMatchObject({ sets: 5, reps: 5, restSec: 15 })
    expect(r.items[1].custom).toBe(true)
    expect(r.keptCustom).toBe(1)
    expect(r.applied).toBe(1)
  })

  it('replaces custom ones too when asked, and they stop being custom', () => {
    const r = applyToAll([reps('mine', 5, 5, true)], u, { replaceCustom: true })
    expect(r.items[0].form).toMatchObject({ sets: 3, reps: 10, restSec: 30 })
    expect(r.items[0].custom).toBe(false)
  })

  it('timed moves get sets and rest, never reps, and keep their time', () => {
    const r = applyToAll([timed('plank', 45)], u, { replaceCustom: false })
    expect(r.items[0].form).toMatchObject({ type: 'time_based', sets: 3, restSec: 30, holdSec: 45, reps: 10 })
    expect(r.timedKeptTime).toBe(1)
  })

  it('timed moves take the uniform time when one is given', () => {
    const r = applyToAll([timed('plank', 45), reps('squat')], { ...u, holdSec: 40 }, { replaceCustom: false })
    expect(r.items[0].form.holdSec).toBe(40)
    expect(r.items[1].form.holdSec).toBe(30) // a rep move's time is left alone
    expect(r.timedKeptTime).toBe(0)
  })

  it('a generated other side follows the same values as its original', () => {
    const copy = { ...reps('lunge-other'), copyOf: 'lunge' }
    const r = applyToAll([reps('lunge'), copy], u, { replaceCustom: false })
    expect(r.items[1].form).toEqual(r.items[0].form ? { ...r.items[0].form, name: 'lunge-other' } : null)
  })

  it('undo puts every plan and custom mark back', () => {
    const start = [reps('a', 1, 8), reps('mine', 5, 5, true), timed('plank', 45)]
    const r = applyToAll(start, { ...u, holdSec: 20 }, { replaceCustom: true })
    expect(undoApply(r.items, r.undo)).toEqual(start)
  })

  it('undo leaves cards added since then alone', () => {
    const r = applyToAll([reps('a')], u, { replaceCustom: false })
    const added = [...r.items, reps('new', 2, 2)]
    expect(undoApply(added, r.undo)[1]).toEqual(reps('new', 2, 2))
  })

  it('new movements start from the uniform values once they have been applied', () => {
    expect(forNewMovement(reps('late').form, u)).toMatchObject({ sets: 3, reps: 10, restSec: 30 })
    expect(forNewMovement(timed('hold', 50).form, { ...u, holdSec: 25 })).toMatchObject({ sets: 3, holdSec: 25 })
    expect(forNewMovement(reps('late').form, null)).toEqual(reps('late').form) // nothing applied yet
  })

  it('an edit to sets, reps, time, rest or type makes a movement custom; a name or note does not', () => {
    const f = reps('a').form
    expect(changesPlan(f, { ...f, reps: 12 })).toBe(true)
    expect(changesPlan(f, { ...f, type: 'time_based' })).toBe(true)
    expect(changesPlan(f, { ...f, name: 'Squat' } as Plan)).toBe(false)
  })

  it('keeps values in range', () => {
    expect(cleanUniform({ sets: 0, reps: 999, restSec: -5, holdSec: 0 })).toEqual({ sets: 1, reps: 200, restSec: 0, holdSec: null })
    expect(applyToPlan(reps('a').form, { sets: 2.6, reps: 9.4, restSec: 20, holdSec: null })).toMatchObject({ sets: 3, reps: 9 })
  })
})
