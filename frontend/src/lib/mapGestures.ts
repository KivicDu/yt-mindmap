/**
 * Trackpad intent for the map canvas.
 *
 * A browser reports a two-finger pinch as `ctrlKey + wheel`, and an ordinary
 * two-finger scroll as a plain `wheel`. They must not share a handler: pinch
 * scales the map around the fingers, while a scroll moves the map by the same
 * distance the fingers travelled. Dragging with a mouse keeps working through
 * pointer events and never reaches this file.
 */

export interface WheelEventLike {
  readonly deltaX: number
  readonly deltaY: number
  readonly deltaMode?: number
  readonly ctrlKey: boolean
  readonly clientX: number
  readonly clientY: number
}

export interface ViewportRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export type MapWheelGesture =
  | { readonly type: 'zoom'; readonly factor: number; readonly px: number; readonly py: number }
  | { readonly type: 'pan'; readonly dx: number; readonly dy: number }

const LINE_HEIGHT_PX = 16
const PINCH_SENSITIVITY = 0.01
/** A mouse wheel with Ctrl sends large deltas; keep each step gentle. */
const MIN_STEP = 0.5
const MAX_STEP = 2

export function mapWheelGesture(event: WheelEventLike, rect: ViewportRect): MapWheelGesture {
  const horizontalUnit =
    event.deltaMode === 1
      ? LINE_HEIGHT_PX
      : event.deltaMode === 2
        ? rect.width
        : 1
  const verticalUnit =
    event.deltaMode === 1
      ? LINE_HEIGHT_PX
      : event.deltaMode === 2
        ? rect.height
        : 1
  const dx = event.deltaX * horizontalUnit
  const dy = event.deltaY * verticalUnit

  if (event.ctrlKey) {
    const factor = Math.exp(-dy * PINCH_SENSITIVITY)
    return {
      type: 'zoom',
      factor: Math.min(MAX_STEP, Math.max(MIN_STEP, factor)),
      px: event.clientX - rect.left,
      py: event.clientY - rect.top,
    }
  }

  return { type: 'pan', dx, dy }
}
