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
