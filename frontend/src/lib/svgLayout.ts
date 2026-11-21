/**
 * The contract between a layout and the SVG canvas that draws it.
 *
 * A radial map and a top-down tree place nodes very differently, but the canvas
 * only ever needs three things: boxes centred on their point, edges as ready-to-
 * draw path data, and a bounding box to frame. Sharing this type is what lets
 * one interactive component serve every non-markmap layout without knowing
 * which geometry produced the numbers.
 */

export interface SvgBox {
  id: string
  depth: number
  /** Index of the top-level branch this node belongs to; drives its colour. */
  branch: number
  content: string
  /** Centre of the box, in map coordinates. */
  x: number
  y: number
  width: number
  height: number
}

export interface SvgEdge {
  d: string
  branch: number
  depth: number
}

export interface SvgBounds {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface SvgLayout {
  boxes: SvgBox[]
  edges: SvgEdge[]
  /** Faint guide circles; only the circle family draws them. */
  rings: number[]
  bounds: SvgBounds
  /**
   * Lower bound for the automatic framing. A radial map is worth seeing whole
   * even when the labels get small; a tree is read line by line, so it keeps
   * the text legible and lets the map overflow instead. The geometry knows
   * which it is, so the canvas does not have to be told.
   */
  fitScale: number
}
