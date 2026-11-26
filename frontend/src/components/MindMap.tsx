import { forwardRef } from 'react'
import TreeMap from './TreeMap'
import TreeDownMap from './TreeDownMap'
import RadialMap from './RadialMap'
import { DEFAULT_STYLE } from '../lib/mapStyle'
import type { MindMapHandle, MindMapProps } from '../lib/mapView'

/**
 * Picks a renderer for the chosen layout.
 *
 * `tree` is markmap's left-to-right tree, `tree-down` is our own top-down tree,
 * and the radial families share one SVG renderer that lays the same tree out
 * around a centre. All three implement `MindMapHandle`, so the workspace never
 * branches on the layout itself.
 */
const MindMap = forwardRef<MindMapHandle, MindMapProps>((props, ref) => {
  const layout = props.layout ?? DEFAULT_STYLE.layout
  const palette = props.palette ?? DEFAULT_STYLE.palette

  // The surface is its own scroll container: a wheel the map did not consume
  // stops here instead of chaining to the page. That keeps a swipe started
  // immediately after a previous one — while vertical momentum is still around
  // — from scrolling the whole workspace.
  let renderer
  if (layout === 'tree') {
    renderer = <TreeMap ref={ref} {...props} layout={layout} palette={palette} />
  } else if (layout === 'tree-down') {
    renderer = <TreeDownMap ref={ref} {...props} palette={palette} />
  } else {
    renderer = <RadialMap ref={ref} kind={layout} palette={palette} {...props} />
  }

  return <div className="mindmap-surface">{renderer}</div>
})

MindMap.displayName = 'MindMap'

export default MindMap
export type { MindMapHandle, MindMapProps }
