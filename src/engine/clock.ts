// The one player clock. It does not own a timer: the player's single
// requestAnimationFrame loop calls tick(performance.now()) every frame.
// Elapsed time only accumulates between play() and pause(), so pausing never
// drifts, and seeking is just setting a number.

export class PlayerClock {
  private elapsedSec = 0
  private lastNow: number | null = null
  private playing = false

  /** speed multiplies wall time (dev-only ?speed= param). */
  constructor(
    readonly durationSec: number,
    readonly speed = 1,
  ) {}

  get elapsed(): number {
    return this.elapsedSec
  }

  get isPlaying(): boolean {
    return this.playing
  }

  get isFinished(): boolean {
    return this.elapsedSec >= this.durationSec
  }

  play(now: number): void {
    if (this.playing) return
    if (this.isFinished) this.elapsedSec = 0
    this.playing = true
    this.lastNow = now
  }

  pause(now: number): void {
    if (!this.playing) return
    this.tick(now)
    this.playing = false
    this.lastNow = null
  }

  /** Advance to `now` (ms, from performance.now()) and return elapsed seconds. */
  tick(now: number): number {
    if (this.playing && this.lastNow != null) {
      const dtMs = now - this.lastNow
      if (dtMs > 0) {
        this.elapsedSec += (dtMs / 1000) * this.speed
        this.lastNow = now
      }
      if (this.elapsedSec >= this.durationSec) {
        this.elapsedSec = this.durationSec
        this.playing = false
        this.lastNow = null
      }
    }
    return this.elapsedSec
  }

  seek(sec: number): void {
    this.elapsedSec = Math.min(Math.max(sec, 0), this.durationSec)
  }
}
