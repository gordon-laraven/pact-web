import { useCallback, useMemo, useState } from 'react'
import { loopSecFor } from './animation/library'
import { LinkBuilder, type LinkDraft } from './components/LinkBuilder'
import { Overview } from './components/Overview'
import { Player } from './components/Player'
import { VideoBuilder, type Draft } from './components/VideoBuilder'
import { sampleWorkout } from './data/sampleWorkout'
import { buildTimeline } from './engine/timeline'
import { CuePlayer } from './player/audio'
import { readSpeed } from './player/format'
import { ENABLE_LINK_IMPORT } from './features'
import { useTheme } from './theme/theme'
import type { Workout } from './types'

type Screen = 'overview' | 'builder' | 'link' | 'player'

export default function App() {
  const sampleTimeline = useMemo(() => buildTimeline(sampleWorkout, { loopSecFor }), [])
  const audio = useMemo(() => new CuePlayer(), [])
  const speed = useMemo(() => readSpeed(window.location.search, import.meta.env.DEV), [])
  const [theme, setTheme] = useTheme()
  const [screen, setScreen] = useState<Screen>('overview')
  const [playing, setPlaying] = useState(sampleTimeline)
  // The workout being built from videos survives trips to the player and back.
  const [draft, setDraft] = useState<Draft>({ title: 'My workout', exercises: [] })
  // So does the list read from a link.
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null)
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
    const w = playing.workout
    const badge = w === sampleWorkout ? 'Sample workout' : w.source?.url ? 'From a link' : 'From your videos'
    return <Player key={w.id} timeline={playing} audio={audio} speed={speed} badge={badge} onExit={exit} />
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
  if (screen === 'link' && ENABLE_LINK_IMPORT) {
    return (
      <LinkBuilder
        draft={linkDraft}
        onChange={setLinkDraft}
        onBack={() => setScreen('overview')}
        onUpload={() => setScreen('builder')}
        onStart={(w) => play(w, 'link')}
      />
    )
  }
  return (
    <Overview
      timeline={sampleTimeline}
      theme={theme}
      onTheme={setTheme}
      onStart={() => play(sampleWorkout, 'overview')}
      onPasteLink={ENABLE_LINK_IMPORT ? () => setScreen('link') : undefined}
      onMakeFromVideo={() => setScreen('builder')}
    />
  )
}
