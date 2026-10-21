import { useEffect, useMemo, useRef } from 'react'
import { sharedFrame } from '../animation/library'
import type { Animation } from '../types'
import { StickFigure, type StickFigureHandle } from './StickFigure'

/** A stick figure looping one animation on its own clock (for previews). */
export function AnimationPreview({ animation, secPerLoop }: { animation: Animation; secPerLoop: number }) {
  const figure = useRef<StickFigureHandle>(null)
  const frame = useMemo(() => sharedFrame([animation]), [animation])

  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const loop = () => {
      const t = ((performance.now() - start) / 1000 / secPerLoop) % 1
      figure.current?.draw(animation, t, 'live')
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [animation, secPerLoop])

  return (
    <div className="preview-figure">
      <StickFigure ref={figure} frame={frame} />
    </div>
  )
}
