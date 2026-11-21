/**
 * The contract every map renderer implements.
 *
 * Two renderers exist: `TreeMap` (markmap, left-to-right) and `RadialMap`
 * (spider/bubble/circle). Keeping the handle and props here means `MindMap`
 * can switch between them without the workspace knowing which one is mounted.
 */

import type { MapNode } from './mindmapTree'
import type { MapLayout, MapPalette } from './mapStyle'

export interface MindMapHandle {
  updateTree: (title: string, nodes: MapNode[], options?: { focusNew?: boolean }) => void
  /** `factor` multiplies the current scale: 1.2 zooms in, 1 / 1.2 zooms out. */
  zoom: (factor: number) => void
  fit: () => void
  center: () => void
  /** Live SVG element, used by the export menu. */
  getSvg: () => SVGSVGElement | null
  /** Content bounds in map coordinates, before the pan/zoom transform. */
  getBounds: () => { x1: number; y1: number; x2: number; y2: number } | null
}

export interface MindMapProps {
  onSeek?: (seconds: number) => void
  /** Fired for any click on a node, whether or not it also seeks. */
  onSelect?: (nodeId: string) => void
  selectedId?: string | null
  collapseOld?: boolean
  /**
   * Called once the renderer exists. The component is lazy-loaded, so a
   * transcript can arrive before this mounts; the owner uses this to push the
   * tree it already holds.
   */
  onReady?: () => void
  layout?: MapLayout
  palette?: MapPalette
}
