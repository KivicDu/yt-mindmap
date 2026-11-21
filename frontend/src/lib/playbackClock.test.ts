import { describe, expect, it, vi } from 'vitest'
import { PlaybackClock } from './playbackClock'

describe('PlaybackClock', () => {
  it('notifies subscribers only when the displayed second changes', () => {
    const clock = new PlaybackClock()
    const listener = vi.fn()
    clock.subscribe(listener)

    clock.set(0.2)
    clock.set(0.8)
    clock.set(1.1)

    expect(clock.getSnapshot()).toBe(1.1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('can force a same-second update after a seek', () => {
    const clock = new PlaybackClock()
    const listener = vi.fn()
    clock.set(4.1)
    clock.subscribe(listener)

    clock.set(4.8, true)

    expect(clock.getSnapshot()).toBe(4.8)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
