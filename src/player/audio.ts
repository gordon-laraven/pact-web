import type { Cue } from '../engine/cues'

// Spoken cues (speechSynthesis) and beeps (Web Audio). Every call is guarded:
// if a browser lacks either API, or it throws, the workout simply runs silent.

type AudioContextCtor = typeof AudioContext

export class CuePlayer {
  private ctx: AudioContext | null = null
  private _muted = false

  get muted() {
    return this._muted
  }

  setMuted(muted: boolean) {
    this._muted = muted
    if (muted) this.stop()
  }

  /** Call from a user gesture (the Start / Restart tap) so audio is allowed. */
  unlock() {
    try {
      if (!this.ctx) {
        const Ctor: AudioContextCtor | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
        if (Ctor) this.ctx = new Ctor()
      }
      void this.ctx?.resume().catch(() => {})
    } catch {
      this.ctx = null
    }
    // iOS only lets speech start from a gesture; a silent utterance unlocks it.
    this.say('', 0)
  }

  play(cue: Cue) {
    if (this._muted) return
    if (cue.beep) this.beep(cue.beep)
    if (cue.say) this.say(cue.say)
  }

  stop() {
    try {
      window.speechSynthesis?.cancel()
    } catch {
      /* unavailable */
    }
  }

  private say(text: string, volume = 1) {
    try {
      const synth = window.speechSynthesis
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return
      // Cues are time-critical: drop whatever is still being said.
      synth.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'en-US'
      u.rate = 1.05
      u.volume = volume
      synth.speak(u)
    } catch {
      /* speech unavailable: carry on silently */
    }
  }

  private beep(kind: 'tick' | 'go') {
    const ctx = this.ctx
    if (!ctx || ctx.state === 'closed') return
    try {
      const now = ctx.currentTime
      const dur = kind === 'go' ? 0.38 : 0.12
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = kind === 'go' ? 1320 : 880
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.35, now + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now)
      osc.stop(now + dur + 0.02)
    } catch {
      /* ignore */
    }
  }
}
