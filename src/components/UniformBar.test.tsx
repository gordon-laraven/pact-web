import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { loadUniform, saveUniform } from '../review/session'
import { DEFAULT_UNIFORM } from '../review/uniform'
import { UniformBar } from './UniformBar'

const noop = () => {}
const render = (done: string | null = null) =>
  renderToStaticMarkup(
    <UniformBar values={DEFAULT_UNIFORM} onValues={noop} count={4} customCount={1} onApply={noop} done={done} onUndo={noop} />,
  )

describe('Set for all movements bar', () => {
  it('has labelled sets, reps, rest and optional time fields, and Apply to all', () => {
    const html = render()
    expect(html).toContain('Set for all movements')
    for (const label of ['Sets', 'Reps', 'Rest between sets (sec)', 'Time for timed moves (sec, optional)']) {
      expect(html).toMatch(new RegExp(`<label><span>${label.replace(/[()]/g, '\\$&')}</span><input`))
    }
    expect(html).toMatch(/<button type="submit"[^>]*>Apply to all<\/button>/)
    expect(html).toContain('value="3"')
    expect(html).toContain('value="10"')
    expect(html).toContain('value="30"')
  })

  it('offers Undo after applying', () => {
    expect(render('Applied to 4 moves.')).toMatch(/Applied to 4 moves\..*Undo/)
    expect(render()).not.toContain('Undo')
  })

  it('uses calm words', () => {
    expect(render('Applied to 4 moves.')).not.toMatch(/grind|crush|shred|punish/i)
  })
})

describe('session memory', () => {
  it('remembers the values and the last applied ones', () => {
    const data = new Map<string, string>()
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
    const u = { values: { sets: 4, reps: 8, restSec: 45, holdSec: 30 }, active: { sets: 4, reps: 8, restSec: 45, holdSec: 30 } }
    saveUniform(u, store)
    expect(loadUniform(store)).toEqual(u)
  })

  it('starts from 3 × 10 with 30 s rest, and survives broken storage', () => {
    expect(loadUniform(null)).toEqual({ values: DEFAULT_UNIFORM, active: null })
    expect(loadUniform({ getItem: () => '{nope' })).toEqual({ values: DEFAULT_UNIFORM, active: null })
  })
})
