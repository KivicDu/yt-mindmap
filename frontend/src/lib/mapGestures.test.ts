import { describe, expect, it } from 'vitest'
import { mapWheelGesture, type ViewportRect, type WheelEventLike } from './mapGestures'

const rect: ViewportRect = { left: 100, top: 40, width: 800, height: 600 }

function wheel(overrides: Partial<WheelEventLike> = {}): WheelEventLike {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    clientX: 300,
    clientY: 240,
    ...overrides,
  }
}

describe('mapWheelGesture', () => {
  it('pans when two fingers move together, in both directions', () => {
    expect(mapWheelGesture(wheel({ deltaY: 120 }), rect)).toEqual({ type: 'pan', dx: 0, dy: 120 })
    expect(mapWheelGesture(wheel({ deltaY: -80 }), rect)).toEqual({ type: 'pan', dx: 0, dy: -80 })
    expect(mapWheelGesture(wheel({ deltaX: 45 }), rect)).toEqual({ type: 'pan', dx: 45, dy: 0 })
  })

  it('keeps the fingers’ distance for a plain scroll, whatever the delta unit', () => {
    expect(mapWheelGesture(wheel({ deltaY: 3, deltaMode: 1 }), rect)).toEqual({
      type: 'pan',
      dx: 0,
      dy: 48,
    })
    expect(mapWheelGesture(wheel({ deltaY: 0.5, deltaMode: 2 }), rect)).toEqual({
      type: 'pan',
      dx: 0,
      dy: 300,
    })
  })

  it('zooms around the fingers when a pinch arrives as ctrl+wheel', () => {
    const gesture = mapWheelGesture(wheel({ deltaY: -20, ctrlKey: true }), rect)
    expect(gesture.type).toBe('zoom')
    if (gesture.type !== 'zoom') return
    expect(gesture.factor).toBeGreaterThan(1)
    expect(gesture.px).toBe(200)
    expect(gesture.py).toBe(200)

    const out = mapWheelGesture(wheel({ deltaY: 20, ctrlKey: true }), rect)
    expect(out.type).toBe('zoom')
    if (out.type !== 'zoom') return
    expect(out.factor).toBeLessThan(1)
  })

  it('clamps a coarse ctrl+wheel notch so one step stays gentle', () => {
    const gesture = mapWheelGesture(wheel({ deltaY: -400, ctrlKey: true }), rect)
    expect(gesture.type).toBe('zoom')
    if (gesture.type !== 'zoom') return
    expect(gesture.factor).toBe(2)

    const inGesture = mapWheelGesture(wheel({ deltaY: 400, ctrlKey: true }), rect)
    expect(inGesture.type).toBe('zoom')
    if (inGesture.type !== 'zoom') return
    expect(inGesture.factor).toBe(0.5)
  })
})
