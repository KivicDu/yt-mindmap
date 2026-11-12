import { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react'
import { buildMapData, collapseOlderBranches, type MapNode } from '../lib/mindmapTree'
import { layoutRadial, type RadialKind } from '../lib/radialLayout'
import type { MapPalette } from '../lib/mapStyle'
import type { MindMapHandle } from '../lib/mapView'
import SvgMapCanvas from './SvgMapCanvas'

interface RadialMapProps {
  kind: RadialKind
  palette: MapPalette
  onSeek?: (seconds: number) => void
  onSelect?: (nodeId: string) => void
  selectedId?: string | null
  collapseOld?: boolean
  onReady?: () => void
}

const COLLAPSE_KEEP_LAST = 3

/**
 * The radial families. All the interaction lives in `SvgMapCanvas`; this
 * component only turns the tree into rings of boxes and keeps the tree state
 * the workspace pushes into it.
 */
const RadialMap = forwardRef<MindMapHandle, RadialMapProps>(
  ({ kind, palette, onSeek, onSelect, selectedId, collapseOld, onReady }, ref) => {
    const canvas = useRef<MindMapHandle>(null)
    const [tree, setTree] = useState<{ title: string; nodes: MapNode[] }>({
      title: 'Lecture Mind Map',
      nodes: [],
    })

    const layout = useMemo(() => {
      const root = buildMapData(tree)
      if (collapseOld) collapseOlderBranches(root, COLLAPSE_KEEP_LAST)
      return layoutRadial(root, kind)
    }, [tree, kind, collapseOld])

    useEffect(() => {
      onReady?.()
      // The owner pushes the tree it already holds once this mounts.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        updateTree: (title: string, nodes: MapNode[]) => setTree({ title, nodes }),
        zoom: (factor: number) => canvas.current?.zoom(factor),
        fit: () => canvas.current?.fit(),
        center: () => canvas.current?.center(),
        getSvg: () => canvas.current?.getSvg() ?? null,
        getBounds: () => canvas.current?.getBounds() ?? null,
      }),
      [],
    )

    return (
      <SvgMapCanvas
        ref={canvas}
        className="mindmap mindmap--radial"
        layout={layout}
        style={{ layout: kind, palette }}
        hasContent={tree.nodes.length > 0}
        selectedId={selectedId}
        onSeek={onSeek}
        onSelect={onSelect}
      />
    )
  },
)

RadialMap.displayName = 'RadialMap'

export default RadialMap
