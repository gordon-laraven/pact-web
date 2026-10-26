/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VideoBuilder } from './VideoBuilder'

const noop = () => {}

describe('Upload a video screen', () => {
  it('has no debug download at the top of the screen', () => {
    const html = renderToStaticMarkup(<VideoBuilder draft={{ title: 'My workout', exercises: [] }} onChange={noop} onBack={noop} onStart={noop} />)
    expect(html).toContain('Choose a clip')
    expect(html).not.toContain('Download debug file')
  })

  it('only offers the debug download through Report a problem', () => {
    const src = readFileSync(new URL('./VideoBuilder.tsx', import.meta.url), 'utf8')
    expect(src).not.toContain('Download debug file') // the label lives in ReportProblem now
    const reports = src.match(/<ReportProblem[^>]*?(?:\/>|>)/gs) ?? []
    expect(reports.length).toBeGreaterThanOrEqual(4)
    for (const r of reports) expect(r).toMatch(/onDownloadDebug=/)
  })
})

describe('review order', () => {
  it('lists moves detected with low confidence first, each keeping its number in the video', async () => {
    const { checkFirst } = await import('./VideoBuilder')
    const item = (key: string, low: boolean) => ({ key, checkFirst: low }) as Parameters<typeof checkFirst>[0][number]
    const order = checkFirst([item('a', false), item('b', true), item('c', false), item('d', true)])
    expect(order.map(({ it, i }) => `${it.key}${i + 1}`)).toEqual(['b2', 'd4', 'a1', 'c3'])
  })
})
