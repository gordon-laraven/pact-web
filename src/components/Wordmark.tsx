// The pact wordmark: lowercase, geometric, round stroke ends, and a small dot
// in the mode's glow color. Drawn as strokes (no font needed), so it is the
// same everywhere. This is the one place to swap in a final logo.
//
// mono: one color (the dot follows the text), for single-color uses.

type Props = { size?: number; mono?: boolean; className?: string }

export function Wordmark({ size = 40, mono = false, className }: Props) {
  return (
    <svg
      className={className ? `wordmark ${className}` : 'wordmark'}
      viewBox="0 30 248 102"
      height={size}
      width={(size * 248) / 102}
      role="img"
      aria-label="pact"
    >
      <g fill="none" stroke="currentColor" strokeWidth={13} strokeLinecap="round" strokeLinejoin="round">
        {/* p */}
        <path d="M10 56.5V124" />
        <circle cx={28.5} cy={75} r={18.5} />
        {/* a */}
        <circle cx={90.5} cy={75} r={18.5} />
        <path d="M109 56.5V93.5" />
        {/* c */}
        <path d="M165.6 61.9A18.5 18.5 0 1 0 165.6 88.1" />
        {/* t */}
        <path d="M202 37V82Q202 93.5 214 93.5M190.5 56.5H215" />
      </g>
      <circle cx={238} cy={93.5} r={7.5} fill={mono ? 'currentColor' : 'var(--glow)'} />
    </svg>
  )
}
