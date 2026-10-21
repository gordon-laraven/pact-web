import type { Timeline } from '../engine/timeline'
import { formatClock, prescription } from '../player/format'
import type { Theme } from '../theme/theme'
import { ThemeToggle } from './ThemeToggle'
import { Wordmark } from './Wordmark'

type Props = {
  timeline: Timeline
  theme: Theme
  onTheme: (t: Theme) => void
  onStart: () => void
  onPasteLink: () => void
  onMakeFromVideo: () => void
}

export function Overview({ timeline, theme, onTheme, onStart, onPasteLink, onMakeFromVideo }: Props) {
  const { workout } = timeline
  return (
    <main className="overview">
      <header className="overview-top">
        <Wordmark size={34} />
        <ThemeToggle theme={theme} onChange={onTheme} />
      </header>

      <section className="overview-hero">
        <h1>Keep the pact.</h1>
        <p className="tagline">No perfect conditions. Just a promise to yourself to move, wherever you are.</p>
        <hr className="glow-line" />
      </section>

      <section className="overview-card" aria-labelledby="workout-title">
        <h2 id="workout-title" className="overview-title">
          {workout.title}
        </h2>
        <p className="overview-meta">
          <span>{formatClock(timeline.duration)} total</span>
          <span aria-hidden="true">·</span>
          <span>{workout.exercises.length} exercises</span>
          <span aria-hidden="true">·</span>
          <span>no gear</span>
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
          Start where you are
        </button>
        <p className="overview-hint">Hands-free. Press start once and follow along. Ten minutes counts.</p>
      </div>

      <section className="other-ways" aria-labelledby="other-ways-title">
        <h2 id="other-ways-title">Saw a workout you liked?</h2>
        <p className="overview-hint">
          Bring it here and do it anywhere.
        </p>
        <div className="other-ways-buttons">
          <button type="button" className="secondary-button" onClick={onPasteLink}>
            Paste a link
          </button>
          <button type="button" className="secondary-button" onClick={onMakeFromVideo}>
            Upload a video
          </button>
        </div>
      </section>
    </main>
  )
}
