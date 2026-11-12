import { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react'
import { buildMapData, collapseOlderBranches, type MapNode } from '../lib/mindmapTree'
import { layoutTreeDown } from '../lib/treeLayout'
import type { MapPalette } from '../lib/mapStyle'
import type { MindMapHandle } from '../lib/mapView'
import SvgMapCanvas from './SvgMapCanvas'

interface TreeDownMapProps {
  palette: MapPalette
  onSeek?: (seconds: number) => void
  onSelect?: (nodeId: string) => void
  selectedId?: string | null
  collapseOld?: boolean
  onReady?: () => void
}

const COLLAPSE_KEEP_LAST = 3

/**
 * The top-down tree: same tree as markmap draws, rotated a quarter turn.
 *
 * It is a custom renderer rather than a markmap option because markmap's d3
 * layout is hard-wired horizontal — there is no direction setting to flip.
 * Sharing `SvgMapCanvas` with the radial families means pan, zoom, keyboard
 * navigation and export all behave exactly the same here.
 */
const TreeDownMap = forwardRef<MindMapHandle, TreeDownMapProps>(
  ({ palette, onSeek, onSelect, selectedId, collapseOld, onReady }, ref) => {
    const canvas = useRef<MindMapHandle>(null)
    const [tree, setTree] = useState<{ title: string; nodes: MapNode[] }>({
      title: 'Lecture Mind Map',
      nodes: [],
    })

    const layout = useMemo(() => {
      const root = buildMapData(tree)
      if (collapseOld) collapseOlderBranches(root, COLLAPSE_KEEP_LAST)
      return layoutTreeDown(root)
    }, [tree, collapseOld])

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
        className="mindmap mindmap--radial mindmap--tree-down"
        layout={layout}
        style={{ layout: 'tree-down', palette }}
        hasContent={tree.nodes.length > 0}
        selectedId={selectedId}
        onSeek={onSeek}
        onSelect={onSelect}
      />
    )
  },
)

TreeDownMap.displayName = 'TreeDownMap'

export default TreeDownMap
