/**
 * Positions for the top-down tree.
 *
 * The radial families spread one tree around a centre. This layout keeps the
 * order a lecture is written in instead: the root at the top, each level under
 * its parent, siblings side by side — the shape an org chart has, and the
 * shape the "Tree Map" of Thinking Maps is normally drawn in.
 *
 * It is the same tidy-tree idea markmap draws left to right, rotated a quarter
 * turn. Doing it here rather than inside markmap has two payoffs: the labels
 * stay horizontal, and the geometry is pure data, so it can be unit-tested
 * without a browser.
 */

import { nodeIdOf, visibleChildren, type MarkmapNode } from './mindmapTree'
import { measureNode } from './radialLayout'
import type { SvgBox, SvgEdge, SvgLayout } from './svgLayout'

/** Air between a parent's bottom edge and its children's top edge. */
const LEVEL_GAP = 56
/** Air between two neighbouring subtrees, so their labels never touch. */
const SIBLING_GAP = 22
/**
 * A top-down tree is as wide as its leaves, so a 25-topic lecture is far wider
 * than the panel. Framing it whole would shrink 13.5px labels to texture;
 * keeping them readable and letting the map overflow means the learner reads
 * the first branches and pans right for the rest, which is how the horizontal
 * tree already behaves.
 */
const FIT_SCALE = 0.75

interface Slot {
  node: MarkmapNode
  depth: number
  branch: number
  width: number
  height: number
  /** Total width this node's whole subtree needs. */
  span: number
  children: Slot[]
  /** Centre, filled in once the subtree's width is known. */
  x: number
  y: number
}

function build(node: MarkmapNode, depth: number, branch: number): Slot {
  const { width, height } = measureNode(node.content, depth)
  const children = visibleChildren(node).map((child, index) =>
    // A depth-1 node opens its own branch; deeper nodes keep their root's.
    build(child, depth + 1, depth === 0 ? index : branch),
  )

  const childrenWidth =
    children.reduce((total, child) => total + child.span, 0) +
    SIBLING_GAP * Math.max(0, children.length - 1)

  return {
    node,
    depth,
    branch,
    width,
    height,
    // A parent wider than its children still owns that width, and the children
    // are centred under it rather than starting at its left edge.
    span: Math.max(width, childrenWidth),
    children,
    x: 0,
    y: 0,
  }
}

/** Hand every slot the horizontal centre of the band its subtree owns. */
function place(slot: Slot, left: number): void {
  slot.x = left + slot.span / 2

  if (slot.children.length === 0) return
  const childrenWidth =
    slot.children.reduce((total, child) => total + child.span, 0) +
    SIBLING_GAP * (slot.children.length - 1)

  let cursor = left + (slot.span - childrenWidth) / 2
  for (const child of slot.children) {
    place(child, cursor)
    cursor += child.span + SIBLING_GAP
  }
}

/**
 * Lay the tree out from the top down.
 *
 * Rows are as tall as their tallest label, so a long wrapped label pushes the
 * whole level down instead of overlapping the one below it.
 */
export function layoutTreeDown(root: MarkmapNode): SvgLayout {
  const top = build(root, 0, 0)
  place(top, 0)

  const slots: Slot[] = []
  const walk = (slot: Slot) => {
    slots.push(slot)
    slot.children.forEach(walk)
  }
  walk(top)

  const maxDepth = Math.max(0, ...slots.map((slot) => slot.depth))
  const rowHeight: number[] = []
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    rowHeight[depth] = Math.max(
      0,
      ...slots.filter((slot) => slot.depth === depth).map((slot) => slot.height),
    )
  }

  const rowTop: number[] = [0]
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    rowTop[depth] = rowTop[depth - 1] + rowHeight[depth - 1] + LEVEL_GAP
  }

  for (const slot of slots) {
    // Centre the label in its row: a short label next to a wrapped sibling
    // should sit on the same line, not hang from the top of the row.
    slot.y = rowTop[slot.depth] + rowHeight[slot.depth] / 2
  }

  const boxes: SvgBox[] = slots.map((slot) => ({
    id: nodeIdOf(slot.node) ?? `tree-down-${slot.depth}-${slot.x.toFixed(2)}`,
    depth: slot.depth,
    branch: slot.branch,
    content: slot.node.content,
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
  }))

  const edges: SvgEdge[] = []
  const drawEdges = (slot: Slot) => {
    for (const child of slot.children) {
      const px = slot.x
      const py = slot.y + slot.height / 2
      const cx = child.x
      const cy = child.y - child.height / 2
      // An S-curve that leaves the parent downwards and arrives at the child
      // from above: the same reading markmap's curves give, rotated.
      const bend = Math.max(12, (cy - py) * 0.55)
      edges.push({
        d: `M ${round(px)} ${round(py)} C ${round(px)} ${round(py + bend)} ${round(cx)} ${round(
          cy - bend,
        )} ${round(cx)} ${round(cy)}`,
        branch: child.branch,
        depth: child.depth,
      })
      drawEdges(child)
    }
  }
  drawEdges(top)

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

  return { boxes, edges, rings: [], bounds: { x1, y1, x2, y2 }, fitScale: FIT_SCALE }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
