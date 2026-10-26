/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Checks every text and button color pair in tokens.css against WCAG AA:
// 4.5:1 for text, 3:1 for borders and shapes people need to see.

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}

const light = block(':root')
const themes = { light, dark: { ...light, ...block(":root[data-theme='dark']") } }

function resolve(vars: Record<string, string>, name: string, depth = 0): string {
  const v = vars[name]
  if (!v) throw new Error(`No token --${name}`)
  const ref = v.match(/^var\(--([\w-]+)\)$/)
  return ref && depth < 5 ? resolve(vars, ref[1], depth + 1) : v
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** [foreground, background, minimum ratio] */
const PAIRS: [string, string, number][] = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'surface-sunk', 4.5],
  ['text-muted', 'bg', 4.5],
  ['text-muted', 'surface', 4.5],
  ['text-muted', 'surface-sunk', 4.5],
  ['accent', 'bg', 4.5],
  ['accent', 'surface', 4.5],
  ['accent', 'surface-sunk', 4.5],
  ['on-accent', 'accent', 4.5],
  ['error', 'error-bg', 4.5],
  ['error', 'surface', 4.5],
  ['error', 'bg', 4.5],
  ['line-strong', 'bg', 3],
  ['line-strong', 'surface', 3],
  ['figure', 'bg', 3],
  ['figure-joint', 'bg', 3],
  ['focus', 'bg', 3],
  ['focus', 'surface', 3],
  // The workout player's dark stage
  ['stage-text', 'stage-bg', 4.5],
  ['stage-text', 'stage-surface', 4.5],
  ['stage-muted', 'stage-bg', 4.5],
  ['stage-muted', 'stage-surface', 4.5],
  ['stage-accent', 'stage-bg', 4.5],
  ['stage-accent', 'stage-surface', 4.5],
  ['stage-on-accent', 'stage-accent', 4.5],
  ['stage-figure', 'stage-bg', 3],
  ['stage-joint', 'stage-bg', 3],
  ['stage-muted', 'stage-deep', 4.5],
]

describe.each(Object.entries(themes))('%s theme', (_, vars) => {
  it.each(PAIRS)('%s on %s is at least %s:1', (fg, bg, min) => {
    const ratio = contrast(resolve(vars, fg), resolve(vars, bg))
    expect(ratio).toBeGreaterThanOrEqual(min)
  })
})
