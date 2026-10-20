import { useImperativeHandle, useRef, type Ref } from 'react'
import { BONES, DOT_R, DOTS, floorFor, HEAD_RADIUS, point, STROKE, viewBoxFor } from '../animation/figureGeometry'
import { makePose, samplePose } from '../animation/interpolate'
import type { Animation } from '../types'

// SVG stick figure. React renders the elements once; the player's frame loop
// calls draw() every frame, which writes attributes directly (no re-render),
// so it stays smooth at 60fps and scales crisply at any size.

export type StickFigureHandle = {
  draw(anim: Animation, t: number, mode: 'live' | 'preview'): void
}

type Props = {
  ref?: Ref<StickFigureHandle>
  /** Shared frame size so every exercise is drawn at the same scale. */
  frame: { w: number; h: number }
}

const f = (n: number) => n.toFixed(4)

export function StickFigure({ ref, frame }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const floor = useRef<SVGLineElement>(null)
  const bones = useRef<(SVGLineElement | null)[]>([])
  const dots = useRef<(SVGCircleElement | null)[]>([])
  const head = useRef<SVGCircleElement>(null)
  const pose = useRef(makePose())
  const current = useRef<Animation | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      draw(anim, t, mode) {
        const root = svg.current
        if (!root) return
        if (current.current !== anim) {
          current.current = anim
          const vb = viewBoxFor(anim, frame)
          root.setAttribute('viewBox', `${f(vb.x)} ${f(vb.y)} ${f(vb.w)} ${f(vb.h)}`)
          root.dataset.view = anim.view
          const fl = floorFor(anim)
          floor.current?.setAttribute('x1', f(fl.x1))
          floor.current?.setAttribute('x2', f(fl.x2))
          floor.current?.setAttribute('y1', f(fl.y))
          floor.current?.setAttribute('y2', f(fl.y))
        }
        if (root.dataset.mode !== mode) root.dataset.mode = mode

        const p = samplePose(anim, t, pose.current)
        BONES.forEach((b, i) => {
          const el = bones.current[i]
          if (!el) return
          const a = point(p, b.a)
          const c = point(p, b.b)
          el.setAttribute('x1', f(a.x))
          el.setAttribute('y1', f(a.y))
          el.setAttribute('x2', f(c.x))
          el.setAttribute('y2', f(c.y))
        })
        DOTS.forEach((d, i) => {
          const el = dots.current[i]
          if (!el) return
          el.setAttribute('cx', f(p[d.j].x))
          el.setAttribute('cy', f(p[d.j].y))
        })
        head.current?.setAttribute('cx', f(p.head.x))
        head.current?.setAttribute('cy', f(p.head.y))
      },
    }),
    [frame],
  )

  return (
    <svg
      ref={svg}
      className="figure"
      viewBox={`0 0 ${frame.w} ${frame.h}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <line ref={floor} className="figure-floor" strokeWidth={0.006} />
      {(['far', 'core', 'near'] as const).map((layer) => (
        <g key={layer} className={`figure-layer figure-${layer}`}>
          {BONES.map((b, i) =>
            b.layer === layer ? (
              <line
                key={i}
                ref={(el) => {
                  bones.current[i] = el
                }}
                className="figure-bone"
                strokeWidth={STROKE}
              />
            ) : null,
          )}
          {DOTS.map((d, i) =>
            d.layer === layer ? (
              <circle
                key={d.j}
                ref={(el) => {
                  dots.current[i] = el
                }}
                className="figure-dot"
                r={DOT_R}
              />
            ) : null,
          )}
        </g>
      ))}
      <circle ref={head} className="figure-head" r={HEAD_RADIUS} />
    </svg>
  )
}
