import type { Theme } from '../theme/theme'

// Light · Cyan / Dark · Amber, as two small chips.

export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Color mode">
      {(
        [
          ['light', 'Light · Cyan'],
          ['dark', 'Dark · Amber'],
        ] as const
      ).map(([t, label]) => (
        <button key={t} type="button" role="radio" aria-checked={theme === t} className={theme === t ? 'chip is-on' : 'chip'} onClick={() => onChange(t)}>
          <span className={`theme-dot theme-dot-${t}`} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  )
}
