import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EMPTY_FORM } from '../support/tickets'
import { ReportFailed, ReportForm, ReportProblem, ReportSaved } from './ReportProblem'

const noop = () => {}

describe('Report a problem', () => {
  it('starts as a single "Report a problem" button', () => {
    const html = renderToStaticMarkup(<ReportProblem context={() => ({ step: 'x' })} onTryAgain={noop} />)
    expect(html).toContain('Report a problem')
    expect(html).not.toContain('<form')
  })

  it('the form asks for optional text and email, with technical details checked', () => {
    const html = renderToStaticMarkup(<ReportForm value={EMPTY_FORM} saving={false} onChange={noop} onSubmit={noop} onCancel={noop} />)
    expect(html).toContain('Something went sideways. Let’s get it sorted.')
    expect(html).toContain('What were you trying to do? (optional)')
    expect(html).toMatch(/<input type="email"[^>]*>/)
    expect(html).toMatch(/<input type="checkbox" checked=""/)
    expect(html).toContain('Include technical details')
    expect(html).toContain('Never the video itself')
  })

  it('after saving: a ticket id to copy and a way to try again', () => {
    const html = renderToStaticMarkup(<ReportSaved id="PACT-AB23-CD45" onTryAgain={noop} />)
    expect(html).toContain('PACT-AB23-CD45')
    expect(html).toContain('Copy')
    expect(html).toContain('Try again')
  })

  it('if saving fails: the details, a Copy details button, and try again', () => {
    const html = renderToStaticMarkup(<ReportFailed details="pact problem report PACT-X" onTryAgain={noop} />)
    expect(html).toContain('pact problem report PACT-X')
    expect(html).toContain('Copy details')
    expect(html).toContain('Try again')
  })

  it('uses no harsh words', () => {
    const all = [
      renderToStaticMarkup(<ReportForm value={EMPTY_FORM} saving={false} onChange={noop} onSubmit={noop} onCancel={noop} />),
      renderToStaticMarkup(<ReportSaved id="X" onTryAgain={noop} />),
      renderToStaticMarkup(<ReportFailed details="" onTryAgain={noop} />),
    ].join(' ')
    expect(all).not.toMatch(/grind|crush|shred|punish|no pain/i)
  })
})

describe('Download debug file (dev) lives in the report', () => {
  const form = (onDownloadDebug?: () => void) =>
    renderToStaticMarkup(<ReportForm value={EMPTY_FORM} saving={false} onChange={noop} onSubmit={noop} onCancel={noop} onDownloadDebug={onDownloadDebug} />)

  it('sits at the bottom of the form, below the fields, the checkbox and Send report', () => {
    const html = form(noop)
    const at = (text: string) => html.indexOf(text)
    expect(at('Download debug file (dev)')).toBeGreaterThan(at('Include technical details'))
    expect(at('Download debug file (dev)')).toBeGreaterThan(at('Send report'))
    expect(at('Download debug file (dev)')).toBeLessThan(at('</form>'))
  })

  it('is still there if saving the ticket fails', () => {
    expect(renderToStaticMarkup(<ReportFailed details="x" onTryAgain={noop} onDownloadDebug={noop} />)).toContain('Download debug file (dev)')
  })

  it("isn't shown when there's nothing to download (or outside dev)", () => {
    expect(form()).not.toContain('Download debug file')
  })
})
