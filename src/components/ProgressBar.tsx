import { useImperativeHandle, useRef, type Ref } from 'react'

// One segment per exercise. Fills are written directly each frame (no
// re-render): done = full and bright, current = live partial fill, upcoming = faint.

export type ProgressBarHandle = { update(fills: number[]): void }

export function ProgressBar({ ref, count }: { ref?: Ref<ProgressBarHandle>; count: number }) {
  const fills = useRef<(HTMLDivElement | null)[]>([])
  const last = useRef<number[]>([])

  useImperativeHandle(ref, () => ({
    update(values) {
      values.forEach((v, i) => {
        if (last.current[i] === v) return
        last.current[i] = v
        const el = fills.current[i]
        if (el) el.style.transform = `scaleX(${v})`
      })
    },
  }))

  return (
    <div className="progress" role="presentation">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="progress-seg">
          <div
            className="progress-fill"
            ref={(el) => {
              fills.current[i] = el
            }}
          />
        </div>
      ))}
    </div>
  )
}
