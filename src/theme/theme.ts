import { useEffect, useState } from 'react'

// Light · Cyan or Dark · Amber. Follows the system until someone picks one,
// then remembers the pick. index.html applies it before first paint (same
// storage key), so there's no flash.

export type Theme = 'light' | 'dark'

export const THEME_KEY = 'pact-theme'

/** Browser bar color per theme (matches --bg in tokens.css). */
const THEME_COLOR: Record<Theme, string> = { light: '#f4efe6', dark: '#3a3532' }

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

const system = (): Theme => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? system())

  useEffect(() => applyTheme(theme), [theme])

  // Until someone picks, follow the system as it changes.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = () => {
      if (!stored()) setTheme(mq.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const choose = (t: Theme) => {
    try {
      localStorage.setItem(THEME_KEY, t)
    } catch {
      // private mode: the choice lasts for this visit
    }
    setTheme(t)
  }
  return [theme, choose]
}
