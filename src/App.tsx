import { useCallback, useMemo, useState } from 'react'
import { loopSecFor } from './animation/library'
import { Overview } from './components/Overview'
import { Player } from './components/Player'
import { VideoBuilder, type Draft } from './components/VideoBuilder'
import { sampleWorkout } from './data/sampleWorkout'
import { buildTimeline } from './engine/timeline'
import { CuePlayer } from './player/audio'
import { readSpeed } from './player/format'
import type { Workout } from './types'

type Screen = 'overview' | 'builder' | 'player'

export default function App() {
  const sampleTimeline = useMemo(() => buildTimeline(sampleWorkout, { loopSecFor }), [])
  const audio = useMemo(() => new CuePlayer(), [])
  const speed = useMemo(() => readSpeed(window.location.search, import.meta.env.DEV), [])
  const [screen, setScreen] = useState<Screen>('overview')
  const [playing, setPlaying] = useState(sampleTimeline)
  // The workout being built from videos survives trips to the player and back.
  const [draft, setDraft] = useState<Draft>({ title: 'My workout', exercises: [] })
  const [cameFrom, setCameFrom] = useState<Screen>('overview')

  const play = useCallback(
    (workout: Workout, from: Screen) => {
      audio.unlock() // inside the tap, so browsers allow sound and speech
      setPlaying(workout === sampleWorkout ? sampleTimeline : buildTimeline(workout, { loopSecFor }))
      setCameFrom(from)
      setScreen('player')
    },
    [audio, sampleTimeline],
  )
  const exit = useCallback(() => setScreen(cameFrom), [cameFrom])

  if (screen === 'player') {
    const badge = playing.workout === sampleWorkout ? 'Sample workout' : 'From your videos'
    return <Player key={playing.workout.id} timeline={playing} audio={audio} speed={speed} badge={badge} onExit={exit} />
  }
  if (screen === 'builder') {
    return (
      <VideoBuilder
        draft={draft}
        onChange={setDraft}
        onBack={() => setScreen('overview')}
        onStart={(w) => play(w, 'builder')}
      />
    )
  }
  return (
    <Overview
      timeline={sampleTimeline}
      onStart={() => play(sampleWorkout, 'overview')}
      onMakeFromVideo={() => setScreen('builder')}
    />
  )
}
