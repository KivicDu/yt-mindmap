/**
 * Positions for the radial map families (spider, bubble, circle).
 *
 * This is pure geometry: it takes the same tree markmap renders and returns
 * boxes plus edge paths in map coordinates. Keeping it free of the DOM makes
 * the awkward part — angular allocation and ring radii — unit-testable without
 * a browser.
 *
 * The three families share one algorithm and differ in the parameters that
 * actually change how the map reads: how far apart the rings sit, how much air
 * a label needs, whether edges curve, and whether the rings are drawn.
 */

import { nodeIdOf, type MarkmapNode } from './mindmapTree'

export type RadialKind = 'spider' | 'bubble' | 'circle'

export interface RadialBox {
  id: string
  depth: number
  /** Index of the top-level branch this node belongs to; drives its colour. */
  branch: number
  content: string
  x: number
  y: number
  width: number
  height: number
}

export interface RadialEdge {
  d: string
  branch: number
  depth: number
}

export interface RadialBounds {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface RadialLayout {
  boxes: RadialBox[]
  edges: RadialEdge[]
  /** Ring radii, drawn as faint guides for the circle family. */
  rings: number[]
  bounds: RadialBounds
}

interface KindConfig {
  /** Minimum distance between two consecutive rings. */
  ringGap: number
  /** Horizontal air between two labels sharing a ring. */
  gapX: number
  /** 0 draws straight spokes, 1 pulls the control point to the parent radius. */
  curve: number
  showRings: boolean
}

const CONFIG: Record<RadialKind, KindConfig> = {
  // Spokes: long enough that the level-1 topics sit clearly outside the root.
  spider: { ringGap: 215, gapX: 30, curve: 0.55, showRings: false },
  // Bubbles: more air so each cluster reads as one blob.
  bubble: { ringGap: 190, gapX: 48, curve: 0.68, showRings: false },
  // Circle: tighter, evenly spaced rings you can trace with your eye.
  circle: { ringGap: 200, gapX: 22, curve: 0, showRings: true },
}

/** Rough advance width of the UI sans at 1em, measured against the real font. */
const CHAR_RATIO = 0.53
const LINE_RATIO = 1.45
const PAD_X = 12
const PAD_Y = 10
const MIN_WIDTH = 104
const MAX_WIDTH = 248
const ROOT_MIN_WIDTH = 150
const TWO_PI = Math.PI * 2
const START_ANGLE = -Math.PI / 2

interface Placed {
  node: MarkmapNode
  depth: number
  branch: number
  angle: number
  sector: number
  parent: Placed | null
  width: number
  height: number
  radius: number
}

/** `fold` is how markmap stores a collapsed branch; the radial map honours it. */
function isFolded(node: MarkmapNode): boolean {
  return Boolean((node.payload as Record<string, unknown> | undefined)?.fold)
}

function visibleChildren(node: MarkmapNode): MarkmapNode[] {
  return isFolded(node) ? [] : node.children || []
}

/** Leaves weigh 1, so a branch with ten sub-ideas gets ten times the arc. */
export function subtreeWeight(node: MarkmapNode): number {
  const children = visibleChildren(node)
  if (children.length === 0) return 1
  return children.reduce((total, child) => total + subtreeWeight(child), 0)
}

function plainText(html: string): string {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function fontSizeFor(depth: number): number {
  if (depth === 0) return 15
  if (depth === 1) return 14
  if (depth === 2) return 13.5
  return 13
}

/**
 * Estimate the box a label needs.
 *
 * The numbers only have to be close: the frame never clips (CSS keeps
 * `overflow: visible` on the foreignObject), so a small underestimate costs a
 * few pixels of overlap while a large overestimate would spread the whole map
 * out. Notes are counted as one extra line because they render as a block.
 */
export function measureNode(content: string, depth: number): { width: number; height: number } {
  const text = plainText(content)
  const fontSize = fontSizeFor(depth)
  const charWidth = fontSize * CHAR_RATIO
  const min = depth === 0 ? ROOT_MIN_WIDTH : MIN_WIDTH

  const width = Math.min(MAX_WIDTH, Math.max(min, text.length * charWidth + PAD_X * 2))
  const perLine = Math.max(6, Math.floor((width - PAD_X * 2) / charWidth))
  const labelLines = Math.max(1, Math.ceil(text.length / perLine))
  const noteLines = /class="mm-note"/.test(content) ? 1 : 0

  return {
    width: Math.round(width),
    height: Math.round((labelLines + noteLines) * fontSize * LINE_RATIO + PAD_Y * 2),
  }
}

/**
 * Lay the tree out around a centre point.
 *
 * Depth-1 branches take an arc proportional to their subtree weight; children
 * inherit a slice of their parent's arc, so crowded branches push their ring
 * outwards instead of stacking on top of each other.
 */
export function layoutRadial(root: MarkmapNode, kind: RadialKind): RadialLayout {
  const config = CONFIG[kind]
  const placed: Placed[] = []
  const byDepth = new Map<number, Placed[]>()

  const add = (entry: Placed) => {
    placed.push(entry)
    const bucket = byDepth.get(entry.depth)
    if (bucket) bucket.push(entry)
    else byDepth.set(entry.depth, [entry])
  }

  const rootSize = measureNode(root.content, 0)
  const rootPlaced: Placed = {
    node: root,
    depth: 0,
    branch: 0,
    angle: START_ANGLE,
    sector: TWO_PI,
    parent: null,
    width: rootSize.width,
    height: rootSize.height,
    radius: 0,
  }
  add(rootPlaced)

  const placeChildren = (parent: Placed) => {
    const children = visibleChildren(parent.node)
    if (children.length === 0) return

    const weights = children.map((child) => subtreeWeight(child))
    const total = weights.reduce((sum, value) => sum + value, 0) || 1
    let cursor = parent.angle - parent.sector / 2

    children.forEach((child, index) => {
      const sector = (parent.sector * weights[index]) / total
      const size = measureNode(child.content, parent.depth + 1)
      const entry: Placed = {
        node: child,
        depth: parent.depth + 1,
        // A depth-1 node opens its own branch; deeper nodes keep their root's.
        branch: parent.depth === 0 ? index : parent.branch,
        angle: cursor + sector / 2,
        sector,
        parent,
        width: size.width,
        height: size.height,
        radius: 0,
      }
      cursor += sector
      add(entry)
      placeChildren(entry)
    })
  }

  placeChildren(rootPlaced)

  // Ring radii: far enough from the previous ring, and far enough apart that
  // neighbours on the same arc cannot touch (2r·sin(Δ/2) ≥ label + gap).
  const maxDepth = Math.max(0, ...placed.map((entry) => entry.depth))
  const radii: number[] = [0]
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    let radius = radii[depth - 1] + config.ringGap
    for (const entry of byDepth.get(depth) || []) {
      const half = Math.min(entry.sector, Math.PI) / 2
      const chord = Math.max(Math.sin(half), 0.02)
      radius = Math.max(radius, (entry.width + config.gapX) / (2 * chord))
    }
    radii[depth] = radius
  }

  for (const entry of placed) {
    entry.radius = radii[entry.depth] ?? 0
  }

  const boxes: RadialBox[] = placed.map((entry) => ({
    id: nodeIdOf(entry.node) ?? `radial-${entry.depth}-${entry.angle.toFixed(4)}`,
    depth: entry.depth,
    branch: entry.branch,
    content: entry.node.content,
    x: entry.radius * Math.cos(entry.angle),
    y: entry.radius * Math.sin(entry.angle),
    width: entry.width,
    height: entry.height,
  }))

  const edges: RadialEdge[] = []
  for (const entry of placed) {
    if (!entry.parent) continue
    const parent = entry.parent
    const px = parent.radius * Math.cos(parent.angle)
    const py = parent.radius * Math.sin(parent.angle)
    const tx = entry.radius * Math.cos(entry.angle)
    const ty = entry.radius * Math.sin(entry.angle)

    let d: string
    if (config.curve <= 0) {
      d = `M ${round(px)} ${round(py)} L ${round(tx)} ${round(ty)}`
    } else {
      // Bend the edge towards the parent's spoke: the curve leaves the parent
      // straight out, then turns towards the child.
      const bendAngle = parent.parent ? parent.angle : entry.angle
      const bendRadius = parent.radius + (entry.radius - parent.radius) * config.curve
      const cx = bendRadius * Math.cos(bendAngle)
      const cy = bendRadius * Math.sin(bendAngle)
      d = `M ${round(px)} ${round(py)} Q ${round(cx)} ${round(cy)} ${round(tx)} ${round(ty)}`
    }

    edges.push({ d, branch: entry.branch, depth: entry.depth })
  }

  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const box of boxes) {
    x1 = Math.min(x1, box.x - box.width / 2)
    y1 = Math.min(y1, box.y - box.height / 2)
    x2 = Math.max(x2, box.x + box.width / 2)
    y2 = Math.max(y2, box.y + box.height / 2)
  }
  if (!Number.isFinite(x1)) {
    x1 = -1
    y1 = -1
    x2 = 1
    y2 = 1
  }

  return {
    boxes,
    edges,
    rings: config.showRings ? radii.slice(1) : [],
    bounds: { x1, y1, x2, y2 },
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
