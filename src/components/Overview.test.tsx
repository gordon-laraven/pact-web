import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { loopSecFor } from '../animation/library'
import { sampleWorkout } from '../data/sampleWorkout'
import { buildTimeline } from '../engine/timeline'
import { ENABLE_LINK_IMPORT } from '../features'
import { Overview } from './Overview'

const timeline = buildTimeline(sampleWorkout, { loopSecFor })
const noop = () => {}
const render = (onPasteLink?: () => void) =>
  renderToStaticMarkup(
    <Overview timeline={timeline} theme="light" onTheme={noop} onStart={noop} onMakeFromVideo={noop} onPasteLink={onPasteLink} />,
  )

describe('home screen', () => {
  it('with link import off (as App wires it), only Upload a video shows', () => {
    const html = render(ENABLE_LINK_IMPORT ? noop : undefined)
    expect(html).toContain('Upload a video')
    expect(html).not.toMatch(/paste a link/i)
    expect(html).not.toMatch(/\breels?\b|\bshorts?\b|\blink\b/i)
    expect(html.match(/<button/g)).toHaveLength(4) // two theme chips, Start, Upload
  })

  it('shows Paste a link again when the flag is on', () => {
    const html = render(noop)
    expect(html).toContain('Paste a link')
    expect(html).toContain('Upload a video')
  })
})
