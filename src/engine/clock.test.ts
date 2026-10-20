import { describe, expect, it } from 'vitest'
import { PlayerClock } from './clock'

describe('PlayerClock', () => {
  it('accumulates only while playing', () => {
    const c = new PlayerClock(100)
    expect(c.tick(1000)).toBe(0)
    c.play(1000)
    expect(c.tick(1500)).toBeCloseTo(0.5)
    expect(c.tick(3000)).toBeCloseTo(2)
  })

  it('is pause-safe: time while paused is ignored and nothing drifts', () => {
    const c = new PlayerClock(100)
    c.play(0)
    c.tick(1000)
    c.pause(2000) // counts up to the pause moment
    expect(c.elapsed).toBeCloseTo(2)
    expect(c.tick(60_000)).toBeCloseTo(2)
    c.play(60_000)
    expect(c.tick(61_000)).toBeCloseTo(3)
  })

  it('gives the same result regardless of frame rate', () => {
    const a = new PlayerClock(100)
    const b = new PlayerClock(100)
    a.play(0)
    b.play(0)
    for (let t = 0; t <= 10_000; t += 16.6667) a.tick(t)
    for (let t = 0; t <= 10_000; t += 33.3333) b.tick(t)
    a.tick(10_000)
    b.tick(10_000)
    expect(a.elapsed).toBeCloseTo(b.elapsed, 9)
    expect(a.elapsed).toBeCloseTo(10, 9)
  })

  it('applies the speed multiplier', () => {
    const c = new PlayerClock(100, 4)
    c.play(0)
    expect(c.tick(1000)).toBeCloseTo(4)
  })

  it('seeks within bounds while playing or paused', () => {
    const c = new PlayerClock(50)
    c.seek(20)
    expect(c.elapsed).toBe(20)
    c.play(0)
    c.tick(1000)
    expect(c.elapsed).toBeCloseTo(21)
    c.seek(-5)
    expect(c.elapsed).toBe(0)
    c.seek(999)
    expect(c.elapsed).toBe(50)
  })

  it('stops at the end, and play() after finishing restarts from zero', () => {
    const c = new PlayerClock(10)
    c.play(0)
    expect(c.tick(12_000)).toBe(10)
    expect(c.isPlaying).toBe(false)
    expect(c.isFinished).toBe(true)
    c.play(20_000)
    expect(c.elapsed).toBe(0)
    expect(c.tick(21_000)).toBeCloseTo(1)
  })

  it('ignores non-monotonic timestamps', () => {
    const c = new PlayerClock(10)
    c.play(1000)
    c.tick(900)
    expect(c.elapsed).toBe(0)
  })
})
