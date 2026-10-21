import type { Workout } from '../types'

// Centre of the player's top bar. Without a creator it shows a fallback label
// ("Sample workout", or "From your videos"). When a workout carries a creator,
// this shows their name, linked to attributionUrl when there is one.

type Props = { creator?: Workout['creator']; /** shown when there's no creator */ fallback?: string }

export function AttributionBadge({ creator, fallback = 'Sample workout' }: Props) {
  if (!creator) return <span className="badge">{fallback}</span>
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
