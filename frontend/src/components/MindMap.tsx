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

  if (layout === 'tree') {
    return <TreeMap ref={ref} {...props} layout={layout} palette={palette} />
  }

  if (layout === 'tree-down') {
    return <TreeDownMap ref={ref} {...props} palette={palette} />
  }

  return <RadialMap ref={ref} kind={layout} palette={palette} {...props} />
})

MindMap.displayName = 'MindMap'

export default MindMap
export type { MindMapHandle, MindMapProps }
