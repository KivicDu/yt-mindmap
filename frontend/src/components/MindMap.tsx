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
  /** Fired for any click on a node, whether or not it also seeks. */
  onSelect?: (nodeId: string) => void
  selectedId?: string | null
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

const MindMap = forwardRef<MindMapHandle, MindMapProps>(
  ({ onSeek, onSelect, selectedId, collapseOld, onReady }, ref) => {
  const refSvg = useRef<SVGSVGElement>(null)
  const mm = useRef<Markmap | null>(null)
  const lastTree = useRef<{ title: string; nodes: MapNode[] }>({
    title: 'Lecture Mind Map',
    nodes: INITIAL_TREE,
  })
  const knownIds = useRef(new Set<string>())
  const onSeekRef = useRef(onSeek)
  const onReadyRef = useRef(onReady)
  const onSelectRef = useRef(onSelect)
  const selectedIdRef = useRef<string | null>(selectedId ?? null)
  const collapseRef = useRef(Boolean(collapseOld))
  const selectionObserver = useRef<MutationObserver | null>(null)
  const highlightTimer = useRef<number | null>(null)
  const skipFirstCollapseEffect = useRef(true)

  useEffect(() => {
    onSeekRef.current = onSeek
  }, [onSeek])

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  /**
   * Outline the selected node without re-rendering: a full setData + fit on
   * every click would move the view the user is reading.
   *
   * Ids are compared in JS instead of interpolated into a selector, so an id
   * can never be read as CSS.
   */
  const applySelection = (id: string | null) => {
    const svg = refSvg.current
    if (!svg) return
    svg.querySelectorAll('g.markmap-node').forEach((group) => {
      const holder = group.querySelector('[data-node-id]')
      const selected = Boolean(id) && holder?.getAttribute('data-node-id') === id
      group.classList.toggle('mm-selected', selected)
    })
  }

  useEffect(() => {
    selectedIdRef.current = selectedId ?? null
    applySelection(selectedIdRef.current)
  }, [selectedId])

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
    } else {
      const target = findFirstNew(root, previousIds, root)
      if (!target) {
        await instance.fit()
      } else {
        try {
          await instance.ensureVisible(target as MarkmapNode as any)
          await instance.setHighlight(target as any)
          scheduleHighlightClear(instance)
        } catch {
          await instance.fit()
        }
      }
    }

    // markmap rewrites every node's `class` attribute on each render, so the
    // selection ring has to be re-applied after the render, not before it.
    applySelection(selectedIdRef.current)
  }

  const scheduleHighlightClear = (instance: Markmap) => {
    if (highlightTimer.current) {
      window.clearTimeout(highlightTimer.current)
    }
    highlightTimer.current = window.setTimeout(async () => {
      await instance.setHighlight(null)
      // Clearing the highlight renders again, which drops the selection class.
      applySelection(selectedIdRef.current)
    }, 4000)
  }

  useEffect(() => {
    if (refSvg.current && !mm.current) {
      mm.current = Markmap.create(refSvg.current)
      // markmap rewrites every node's `class` attribute on each render — and
      // it renders again from its own ResizeObserver, after `setData` has
      // resolved. Applying the ring once is therefore not enough: it can be
      // wiped by a render that happens later. Re-applying on class mutations
      // keeps the outline stable without an extra setData.
      selectionObserver.current = new MutationObserver(() => {
        applySelection(selectedIdRef.current)
      })
      selectionObserver.current.observe(refSvg.current, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class'],
      })
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
    selectionObserver.current?.disconnect()
    selectionObserver.current = null
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
      const holder = target?.closest?.('[data-node-id]') as HTMLElement | null
      const nodeId = holder?.getAttribute('data-node-id') || null

      if (anchor) {
        const href = anchor.getAttribute('href') || ''
        const match = href.match(/#seek-([\d.]+)/)
        if (match) {
          event.preventDefault()
          event.stopPropagation()
          onSeekRef.current?.(parseFloat(match[1]))
        }
      }

      // Selecting works for notes too, which have no seek link.
      if (nodeId) onSelectRef.current?.(nodeId)
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
