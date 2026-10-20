import type { Workout } from '../types'

// Centre of the player's top bar. Today every workout is hand-written, so it
// reads "Sample workout". When a workout carries a creator, this shows their
// name, linked to attributionUrl when there is one.

export function AttributionBadge({ creator }: { creator?: Workout['creator'] }) {
  if (!creator) return <span className="badge">Sample workout</span>
  if (!creator.attributionUrl) return <span className="badge">{creator.name}</span>
  return (
    <a
      className="badge"
      href={creator.attributionUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      {creator.name}
    </a>
  )
}
