import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { Markmap } from 'markmap-view'
import {
  buildMapData,
  collapseOlderBranches,
  collectIds,
  findFirstNew,
  type MapNode,
  type MarkmapNode,
} from '../lib/mindmapTree'

interface MindMapHandle {
  updateTree: (title: string, nodes: MapNode[], options?: { focusNew?: boolean }) => void
}

interface MindMapProps {
  onSeek?: (seconds: number) => void
  collapseOld?: boolean
  /**
   * Called once the markmap instance exists. The component is lazy-loaded, so
   * a transcript can arrive before this mounts; the owner uses this to push the
   * tree it already holds.
   */
  onReady?: () => void
}

const COLLAPSE_KEEP_LAST = 3
const INITIAL_TREE: MapNode[] = []

const MindMap = forwardRef<MindMapHandle, MindMapProps>(({ onSeek, collapseOld, onReady }, ref) => {
  const refSvg = useRef<SVGSVGElement>(null)
  const mm = useRef<Markmap | null>(null)
  const lastTree = useRef<{ title: string; nodes: MapNode[] }>({
    title: 'Lecture Mind Map',
    nodes: INITIAL_TREE,
  })
  const knownIds = useRef(new Set<string>())
  const onSeekRef = useRef(onSeek)
  const onReadyRef = useRef(onReady)
  const collapseRef = useRef(Boolean(collapseOld))
  const highlightTimer = useRef<number | null>(null)
  const skipFirstCollapseEffect = useRef(true)

  useEffect(() => {
    onSeekRef.current = onSeek
  }, [onSeek])

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  const render = async (title: string, nodes: MapNode[], focusNew: boolean) => {
    const instance = mm.current
    if (!instance) return

    lastTree.current = { title, nodes }

    const root = buildMapData({ title, nodes })
    if (collapseRef.current) {
      collapseOlderBranches(root, COLLAPSE_KEEP_LAST)
    }

    const currentIds = new Set<string>()
    collectIds(root, currentIds)
    const previousIds = knownIds.current
    knownIds.current = currentIds

    await instance.setData(root as any)

    if (!focusNew || previousIds.size === 0) {
      await instance.fit()
      return
    }

    const target = findFirstNew(root, previousIds, root)
    if (!target) {
      await instance.fit()
      return
    }

    try {
      await instance.ensureVisible(target as MarkmapNode as any)
      await instance.setHighlight(target as any)
      if (highlightTimer.current) {
        window.clearTimeout(highlightTimer.current)
      }
      highlightTimer.current = window.setTimeout(() => {
        instance.setHighlight(null)
      }, 4000)
    } catch {
      await instance.fit()
    }
  }

  useEffect(() => {
    if (refSvg.current && !mm.current) {
      mm.current = Markmap.create(refSvg.current)
      render(lastTree.current.title, lastTree.current.nodes, false).then(() =>
        onReadyRef.current?.(),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    if (highlightTimer.current) {
      window.clearTimeout(highlightTimer.current)
    }
    mm.current?.destroy()
    mm.current = null
  }, [])

  useEffect(() => {
    if (skipFirstCollapseEffect.current) {
      skipFirstCollapseEffect.current = false
      return
    }
    collapseRef.current = Boolean(collapseOld)
    render(lastTree.current.title, lastTree.current.nodes, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseOld])

  useEffect(() => {
    const svg = refSvg.current
    if (!svg) return
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest?.('a')
      if (!anchor) return
      const href = anchor.getAttribute('href') || ''
      const match = href.match(/#seek-([\d.]+)/)
      if (!match) return
      event.preventDefault()
      event.stopPropagation()
      onSeekRef.current?.(parseFloat(match[1]))
    }
    svg.addEventListener('click', handleClick, true)
    return () => {
      svg.removeEventListener('click', handleClick, true)
    }
  }, [])

  const updateTree = (title: string, nodes: MapNode[], options?: { focusNew?: boolean }) => {
    render(title, nodes, options?.focusNew !== false)
  }

  useImperativeHandle(ref, () => ({ updateTree }))

  return <svg ref={refSvg} style={{ width: '100%', height: '100%' }} />
})

MindMap.displayName = 'MindMap'

export default MindMap
export type { MindMapHandle }
