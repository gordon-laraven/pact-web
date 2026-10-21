import type { Timeline } from '../engine/timeline'
import { formatClock, prescription } from '../player/format'

type Props = { timeline: Timeline; onStart: () => void; onMakeFromVideo: () => void }

export function Overview({ timeline, onStart, onMakeFromVideo }: Props) {
  const { workout } = timeline
  return (
    <main className="overview">
      <header className="overview-brand">
        <h1 className="wordmark">PACT</h1>
        <p className="tagline">a promise to yourself</p>
      </header>

      <section className="overview-card" aria-labelledby="workout-title">
        <h2 id="workout-title" className="overview-title">
          {workout.title}
        </h2>
        <p className="overview-meta">
          <span>{formatClock(timeline.duration)} total</span>
          <span aria-hidden="true">·</span>
          <span>{workout.exercises.length} exercises</span>
        </p>

        <ol className="exercise-list">
          {workout.exercises.map((ex) => (
            <li key={ex.id}>
              <span className="exercise-name">{ex.name}</span>
              <span className="exercise-rx">{prescription(ex)}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="overview-actions">
        <button type="button" className="start-button" onClick={onStart}>
          Start
        </button>
        <p className="overview-hint">Hands-free. Press play once and follow along.</p>
        <button type="button" className="secondary-button" onClick={onMakeFromVideo}>
          Make a workout from video
        </button>
      </div>
    </main>
  )
}
