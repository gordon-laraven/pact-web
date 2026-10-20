import { useCallback, useMemo, useState } from 'react'
import { loopSecFor } from './animation/library'
import { Overview } from './components/Overview'
import { Player } from './components/Player'
import { sampleWorkout } from './data/sampleWorkout'
import { buildTimeline } from './engine/timeline'
import { CuePlayer } from './player/audio'
import { readSpeed } from './player/format'

export default function App() {
  const timeline = useMemo(() => buildTimeline(sampleWorkout, { loopSecFor }), [])
  const audio = useMemo(() => new CuePlayer(), [])
  const speed = useMemo(() => readSpeed(window.location.search, import.meta.env.DEV), [])
  const [screen, setScreen] = useState<'overview' | 'player'>('overview')

  const start = useCallback(() => {
    audio.unlock() // inside the tap, so browsers allow sound and speech
    setScreen('player')
  }, [audio])
  const exit = useCallback(() => setScreen('overview'), [])

  return screen === 'overview' ? (
    <Overview timeline={timeline} onStart={start} />
  ) : (
    <Player timeline={timeline} audio={audio} speed={speed} onExit={exit} />
  )
}
