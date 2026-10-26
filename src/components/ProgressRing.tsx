import { useImperativeHandle, useRef, type ReactNode, type Ref } from 'react'

// A thin ring around the workout numerals showing how far through the current
// phase (get ready, a set, a rest) we are. Written directly each frame from the
// player's loop, like the progress bar, so it never causes a re-render.

export type ProgressRingHandle = { update(fraction: number): void }

const R = 46
const C = 2 * Math.PI * R

export function ProgressRing({ ref, children }: { ref?: Ref<ProgressRingHandle>; children: ReactNode }) {
  const arc = useRef<SVGCircleElement>(null)
  const last = useRef(-1)

  useImperativeHandle(ref, () => ({
    update(fraction) {
      const f = Math.min(1, Math.max(0, fraction))
      if (Math.abs(f - last.current) < 0.001) return
      last.current = f
      arc.current?.setAttribute('stroke-dashoffset', String(C * (1 - f)))
    },
  }))

  return (
    <div className="ring">
      <svg className="ring-svg" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="ring-track" cx="50" cy="50" r={R} />
        <circle ref={arc} className="ring-arc" cx="50" cy="50" r={R} strokeDasharray={C} strokeDashoffset={C} />
      </svg>
      <div className="ring-content">{children}</div>
    </div>
  )
}
