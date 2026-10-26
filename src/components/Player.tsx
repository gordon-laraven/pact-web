import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { getAnimation, sharedFrame } from '../animation/library'
import { PlayerClock } from '../engine/clock'
import { buildCues, cuesBetween } from '../engine/cues'
import {
  getSegmentFills,
  getStateAt,
  nextExerciseTime,
  prevExerciseTime,
  type PlayerState,
  type Timeline,
} from '../engine/timeline'
import type { CuePlayer } from '../player/audio'
import { formatClock } from '../player/format'
import { exitFullscreen, fullscreenSupported, isFullscreen, toggleFullscreen } from '../player/fullscreen'
import { createWakeLock } from '../player/wakeLock'
import { AttributionBadge } from './AttributionBadge'
import {
  CloseIcon,
  ExitFullscreenIcon,
  FullscreenIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  RestartIcon,
  SoundOffIcon,
  SoundOnIcon,
} from './icons'
import { ProgressBar, type ProgressBarHandle } from './ProgressBar'
import { ProgressRing, type ProgressRingHandle } from './ProgressRing'
import { StickFigure, type StickFigureHandle } from './StickFigure'

/** Everything the HUD shows. Only re-rendered when one of these changes. */
type View = {
  kind: 'prep' | 'work' | 'rest' | 'done'
  playing: boolean
  title: string
  setLabel: string | null
  big: string
  bigSuffix: string | null
  sub: string | null
  /** During a set: what comes after it ("Squat, set 2"), for the Up next strip. */
  upNext: string | null
}

function toView(st: PlayerState, playing: boolean, activeSec: number): View {
  const base = { playing, setLabel: null, bigSuffix: null, sub: null, upNext: null }
  if (st.finished || !st.phase) {
    return { ...base, kind: 'done', playing: false, title: 'Pact kept.', big: formatClock(activeSec) }
  }
  const countdown = String(Math.max(1, Math.ceil(st.phaseRemaining - 1e-6)))
  const setLabel = st.totalSets > 1 ? `Set ${st.setNumber} / ${st.totalSets}` : null
  const n = st.nextUp
  switch (st.phase.kind) {
    case 'prep':
      return { ...base, kind: 'prep', title: 'Get ready', big: countdown, sub: n ? `First up: ${n.exercise.name}` : null }
    case 'rest': {
      // Kept short so it fits one line on a phone: the set is only named after set 1.
      const nextSet = n && n.setNumber > 1 ? `, set ${n.setNumber}` : ''
      return { ...base, kind: 'rest', title: 'Rest', big: countdown, sub: n ? `Up next: ${n.exercise.name}${nextSet}` : null }
    }
    case 'work': {
      const upNext = n ? `${n.exercise.name}${n.totalSets > 1 ? `, set ${n.setNumber}` : ''}` : null
      return st.targetReps != null
        ? {
            ...base,
            kind: 'work',
            title: st.exercise!.name,
            setLabel,
            big: String(st.repsDone),
            bigSuffix: `/ ${st.targetReps}`,
            sub: st.exercise!.notes ?? null,
            upNext,
          }
        : { ...base, kind: 'work', title: st.exercise!.name, setLabel, big: countdown, bigSuffix: 'sec', sub: st.exercise!.notes ?? null, upNext }
    }
  }
}

const sameView = (a: View, b: View) =>
  a.kind === b.kind &&
  a.playing === b.playing &&
  a.title === b.title &&
  a.setLabel === b.setLabel &&
  a.big === b.big &&
  a.bigSuffix === b.bigSuffix &&
  a.sub === b.sub &&
  a.upNext === b.upNext

type Props = {
  timeline: Timeline
  audio: CuePlayer
  /** Clock multiplier (dev-only ?speed=). */
  speed: number
  /** Top-bar label when the workout has no creator. */
  badge?: string
  onExit: () => void
}

export function Player({ timeline, audio, speed, badge, onExit }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const figure = useRef<StickFigureHandle>(null)
  const progress = useRef<ProgressBarHandle>(null)
  const ring = useRef<ProgressRingHandle>(null)
  const clock = useMemo(() => new PlayerClock(timeline.duration, speed), [timeline, speed])
  const cues = useMemo(() => buildCues(timeline), [timeline])
  // One scale for every move in this workout, so the figure never changes size.
  const frame = useMemo(
    () => sharedFrame(timeline.workout.exercises.map((e) => getAnimation(e.animationId))),
    [timeline],
  )
  const cueCursor = useRef(-1e-6) // cues at or before this time have fired
  const lastElapsed = useRef(0)
  const activeSec = useRef(0) // time actually worked through (excludes skips)
  const wake = useRef<ReturnType<typeof createWakeLock> | null>(null)

  const [view, setView] = useState<View>(() => toView(getStateAt(timeline, 0), true, 0))
  const [muted, setMuted] = useState(audio.muted)
  const [fullscreen, setFullscreen] = useState(false)
  const canFullscreen = useMemo(fullscreenSupported, [])

  // The one frame loop. Clock -> state -> figure, progress, cues, HUD.
  useEffect(() => {
    let raf = 0
    const frame = () => {
      // performance.now() rather than the rAF timestamp, so play/pause/tick all
      // share exactly one time base.
      const wasPlaying = clock.isPlaying
      const elapsed = clock.tick(performance.now())
      if (elapsed > lastElapsed.current) activeSec.current += elapsed - lastElapsed.current
      lastElapsed.current = elapsed

      if (wasPlaying) {
        for (const cue of cuesBetween(cues, cueCursor.current, elapsed)) audio.play(cue)
        cueCursor.current = elapsed
      }

      const st = getStateAt(timeline, elapsed)
      if (st.figure) figure.current?.draw(getAnimation(st.figure.animationId), st.figure.t, st.figure.mode)
      progress.current?.update(getSegmentFills(timeline, elapsed))
      ring.current?.update(st.phase ? st.phaseElapsed / st.phase.duration : 1)
      const next = toView(st, clock.isPlaying, activeSec.current)
      setView((prev) => (sameView(prev, next) ? prev : next))
      raf = requestAnimationFrame(frame)
    }
    clock.play(performance.now())
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [audio, clock, cues, timeline])

  // Wake lock follows play state; speech and fullscreen are cleaned up on exit.
  useEffect(() => {
    const w = createWakeLock()
    wake.current = w
    return () => {
      w.dispose()
      audio.stop()
      exitFullscreen()
    }
  }, [audio])
  useEffect(() => {
    wake.current?.set(view.playing)
  }, [view.playing])

  useEffect(() => {
    const onChange = () => setFullscreen(isFullscreen())
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const togglePlay = useCallback(() => {
    if (clock.isFinished) return
    const now = performance.now()
    if (clock.isPlaying) {
      clock.pause(now)
      audio.stop()
    } else {
      clock.play(now)
    }
  }, [audio, clock])

  const seek = useCallback(
    (t: number) => {
      clock.seek(t)
      lastElapsed.current = clock.elapsed
      cueCursor.current = clock.elapsed - 1e-6 // so the cue at the target fires
      audio.stop()
    },
    [audio, clock],
  )
  const next = useCallback(() => seek(nextExerciseTime(timeline, clock.elapsed)), [clock, seek, timeline])
  const prev = useCallback(() => seek(prevExerciseTime(timeline, clock.elapsed)), [clock, seek, timeline])

  const restart = useCallback(() => {
    audio.unlock()
    seek(0)
    activeSec.current = 0
    clock.play(performance.now())
  }, [audio, clock, seek])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat) togglePlay()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prev()
      } else if (e.key === 'Escape') {
        onExit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, onExit, prev, togglePlay])

  /** Buttons act on their own and never count as the "tap anywhere" pause. */
  const button = (fn: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.currentTarget.blur() // keep Space for play/pause, not for the last-clicked button
    fn()
  }

  const done = view.kind === 'done'

  return (
    <div className="player" ref={root}>
      <div
        className={`stage stage-${view.kind}${view.playing || done ? '' : ' is-paused'}`}
        onClick={done ? undefined : togglePlay}
      >
        <header className="topbar">
          <button type="button" className="icon-btn" aria-label="Close workout" onClick={button(onExit)}>
            <CloseIcon />
          </button>
          <AttributionBadge creator={timeline.workout.creator} fallback={badge} />
          <div className="topbar-right">
            {canFullscreen && (
              <button
                type="button"
                className="icon-btn"
                aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                onClick={button(() => root.current && toggleFullscreen(root.current))}
              >
                {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label={muted ? 'Unmute' : 'Mute'}
              aria-pressed={muted}
              onClick={button(() => {
                audio.setMuted(!muted)
                setMuted(!muted)
              })}
            >
              {muted ? <SoundOffIcon /> : <SoundOnIcon />}
            </button>
          </div>
        </header>

        <ProgressBar ref={progress} count={timeline.workout.exercises.length} />
        <p className={`up-next${view.upNext ? '' : ' is-empty'}`} aria-hidden={!view.upNext}>
          {view.upNext && (
            <>
              <span className="up-next-label">Up next</span>
              <span className="up-next-name">{view.upNext}</span>
            </>
          )}
        </p>

        {done ? (
          <section className="finish">
            <svg className="finish-mark" viewBox="0 0 100 100" aria-hidden="true">
              <circle className="finish-mark-ring" cx="50" cy="50" r="44" />
              <path className="finish-mark-check" d="M33 51 L45 63 L68 39" />
            </svg>
            <h2 className="finish-title">Pact kept.</h2>
            <p className="finish-note">You showed up. That's the whole point.</p>
            <dl className="finish-summary">
              <div>
                <dt>Workout</dt>
                <dd>{timeline.workout.title}</dd>
              </div>
              <div>
                <dt>Moved today</dt>
                <dd className="finish-time-value">{view.big}</dd>
              </div>
            </dl>
            <button type="button" className="restart-button" onClick={button(restart)}>
              <RestartIcon size={22} />
              Go again
            </button>
          </section>
        ) : (
          <>
            <div className="figure-area">
              <StickFigure ref={figure} frame={frame} />
              {!view.playing && <div className="paused-chip">Paused · tap to keep going</div>}
            </div>

            <section className="panel">
              <div className="panel-row">
                <div className="panel-text">
                  {view.kind === 'work' ? (
                    <>
                      <h2 className="panel-title">{view.title}</h2>
                      <p className="panel-set">{view.setLabel ?? ' '}</p>
                    </>
                  ) : (
                    <p className="panel-kicker">{view.title}</p>
                  )}
                  <p className="panel-sub">{view.sub ?? ' '}</p>
                </div>
                <ProgressRing ref={ring}>
                  <p className="panel-big" aria-label={`${view.big} ${view.bigSuffix ?? ''}`}>
                    <span className="panel-big-value">{view.big}</span>
                    {view.bigSuffix && <span className="panel-big-suffix">{view.bigSuffix}</span>}
                  </p>
                </ProgressRing>
              </div>

              <div className="controls">
                <button type="button" className="ctrl" aria-label="Previous exercise" onClick={button(prev)}>
                  <PrevIcon size={26} />
                </button>
                <button
                  type="button"
                  className="ctrl ctrl-main"
                  aria-label={view.playing ? 'Pause' : 'Play'}
                  onClick={button(togglePlay)}
                >
                  {view.playing ? <PauseIcon size={30} /> : <PlayIcon size={30} />}
                </button>
                <button type="button" className="ctrl" aria-label="Next exercise" onClick={button(next)}>
                  <NextIcon size={26} />
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
