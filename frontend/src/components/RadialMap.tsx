import { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  buildMapData,
  collapseOlderBranches,
  type MapNode,
} from '../lib/mindmapTree'
import { layoutRadial, type RadialKind } from '../lib/radialLayout'
import { branchColor, styleVars, type MapPalette } from '../lib/mapStyle'
import type { MindMapHandle } from '../lib/mapView'
import './MindMap.css'

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
const MIN_SCALE = 0.2
const MAX_SCALE = 4
/**
 * A dense radial map is wider than any panel. Below this scale the 13px labels
 * stop being words and become texture, so the automatic framing stops there and
 * lets the map overflow — panning to the rest beats an unreadable overview.
 * It is deliberately low: for a radial map, seeing the whole shape matters more
 * than reading every label at once, and a wheel turn zooms in.
 */
const READABLE_SCALE = 0.3
const FIT_PADDING = 44
const DRAG_THRESHOLD = 4

const RadialMap = forwardRef<MindMapHandle, RadialMapProps>(
  ({ kind, palette, onSeek, onSelect, selectedId, collapseOld, onReady }, ref) => {
    const refSvg = useRef<SVGSVGElement>(null)
    const [tree, setTree] = useState<{ title: string; nodes: MapNode[] }>({
      title: 'Lecture Mind Map',
      nodes: [],
    })
    const [view, setView] = useState({ k: 1, x: 0, y: 0 })
    const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
    const fittedKind = useRef<RadialKind | null>(null)
    const fittedEmpty = useRef(true)
    const onSeekRef = useRef(onSeek)
    const onSelectRef = useRef(onSelect)
    const onReadyRef = useRef(onReady)

    useEffect(() => {
      onSeekRef.current = onSeek
    }, [onSeek])

    useEffect(() => {
      onSelectRef.current = onSelect
    }, [onSelect])

    useEffect(() => {
      onReadyRef.current = onReady
    }, [onReady])

    const layout = useMemo(() => {
      const root = buildMapData(tree)
      if (collapseOld) collapseOlderBranches(root, COLLAPSE_KEEP_LAST)
      return layoutRadial(root, kind)
    }, [tree, kind, collapseOld])

    const fit = useCallback(() => {
      const svg = refSvg.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const { x1, y1, x2, y2 } = layout.bounds
      const width = Math.max(1, x2 - x1) + FIT_PADDING * 2
      const height = Math.max(1, y2 - y1) + FIT_PADDING * 2
      const raw = Math.min(rect.width / width, rect.height / height)
      const k = Math.min(MAX_SCALE, Math.max(READABLE_SCALE, raw))
      const cx = (x1 + x2) / 2
      const cy = (y1 + y2) / 2
      setView({ k, x: rect.width / 2 - cx * k, y: rect.height / 2 - cy * k })
    }, [layout])

    // Frame the map when it first gets content and when the learner switches
    // family — but never while they are reading an update. The first render is
    // the empty hint, so "has content" is tracked separately: otherwise the
    // camera would lock onto the placeholder and the real tree would overflow.
    useEffect(() => {
      if (layout.boxes.length === 0) return
      const hasContent = tree.nodes.length > 0
      const kindChanged = fittedKind.current !== kind
      const justGotContent = fittedEmpty.current && hasContent
      if (!kindChanged && !justGotContent) return
      fittedKind.current = kind
      fittedEmpty.current = !hasContent
      fit()
    }, [fit, kind, layout.boxes.length, tree.nodes.length])

    useEffect(() => {
      onReadyRef.current?.()
      // The owner pushes the tree it already holds once this mounts.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const zoom = useCallback((factor: number) => {
      const rect = refSvg.current?.getBoundingClientRect()
      const cx = (rect?.width ?? 0) / 2
      const cy = (rect?.height ?? 0) / 2
      setView((current) => {
        const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.k * factor))
        const ratio = k / current.k
        return { k, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio }
      })
    }, [])

    /** Put the centre of the map back in the middle without changing zoom. */
    const center = useCallback(() => {
      const rect = refSvg.current?.getBoundingClientRect()
      setView((current) => ({
        ...current,
        x: (rect?.width ?? 0) / 2,
        y: (rect?.height ?? 0) / 2,
      }))
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        updateTree: (title: string, nodes: MapNode[]) => setTree({ title, nodes }),
        zoom,
        fit,
        center,
        getSvg: () => refSvg.current,
        getBounds: () => {
          const { x1, y1, x2, y2 } = layout.bounds
          if (x2 <= x1 || y2 <= y1) return null
          return { x1, y1, x2, y2 }
        },
      }),
      [zoom, fit, center, layout],
    )

    const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
      // Only the primary button pans; a middle click keeps the browser default.
      if (event.button !== 0) return
      drag.current = { x: event.clientX, y: event.clientY, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
      const state = drag.current
      if (!state) return
      const dx = event.clientX - state.x
      const dy = event.clientY - state.y
      if (!state.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
      state.moved = true
      state.x = event.clientX
      state.y = event.clientY
      setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }))
    }

    const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
      if (drag.current?.moved) {
        // Swallow the click that follows a drag so panning never selects a node.
        event.preventDefault()
      }
      drag.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    }

    const handleWheel = useCallback((event: WheelEvent) => {
      // React attaches `wheel` to the root as a passive listener, so calling
      // preventDefault there is ignored and the browser still scrolls or
      // pinch-zooms the whole page. This handler is bound natively instead.
      event.preventDefault()
      const rect = refSvg.current?.getBoundingClientRect()
      if (!rect) return
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      // A trackpad pinch arrives as ctrl+wheel with tiny deltas, so it needs a
      // stronger factor than a normal scroll to feel the same.
      const step = event.ctrlKey ? 0.01 : 0.0015
      setView((current) => {
        const next = current.k * Math.exp(-event.deltaY * step)
        const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
        const ratio = k / current.k
        return { k, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio }
      })
    }, [])

    useEffect(() => {
      const svg = refSvg.current
      if (!svg) return
      svg.addEventListener('wheel', handleWheel, { passive: false })
      return () => svg.removeEventListener('wheel', handleWheel)
    }, [handleWheel])

    const handleClick = (event: React.MouseEvent<SVGSVGElement>) => {
      if (drag.current?.moved) return
      const target = event.target as HTMLElement | null
      const anchor = target?.closest?.('a')
      const holder = target?.closest?.('[data-node-id]') as HTMLElement | null
      const nodeId = holder?.getAttribute('data-node-id') || null

      if (anchor) {
        const match = (anchor.getAttribute('href') || '').match(/#seek-([\d.]+)/)
        if (match) {
          event.preventDefault()
          event.stopPropagation()
          onSeekRef.current?.(parseFloat(match[1]))
        }
      }
      if (nodeId) onSelectRef.current?.(nodeId)
    }

    const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
      const target = event.target
      const nodeTarget =
        target instanceof HTMLElement ? target.closest<HTMLElement>('[data-node-id]') : null
      if (nodeTarget && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault()
        nodeTarget.click()
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        zoom(1.2)
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        zoom(1 / 1.2)
      } else if (event.key === '0') {
        event.preventDefault()
        fit()
      } else if (
        event.key === 'ArrowRight' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowUp'
      ) {
        const nodes = Array.from(
          refSvg.current?.querySelectorAll<HTMLElement>(
            '[data-node-id][tabindex="0"], a[data-node-id]',
          ) ?? [],
        )
        const index = nodes.indexOf(target as HTMLElement)
        const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
        const nextIndex = index + direction
        if (index >= 0 && nextIndex >= 0 && nextIndex < nodes.length) {
          event.preventDefault()
          nodes[nextIndex].focus()
        }
      }
    }

    return (
      <svg
        ref={refSvg}
        className="mindmap mindmap--radial"
        style={{ width: '100%', height: '100%', ...styleVars({ layout: kind, palette }) }}
        tabIndex={0}
        role="group"
        aria-label="Sơ đồ tư duy. Dùng Tab hoặc phím mũi tên để duyệt nhánh, Enter hoặc Space để chọn; phím + và − để phóng to thu nhỏ, phím 0 để vừa khung."
        onKeyDown={handleKeyDown}
        onDoubleClick={fit}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {layout.rings.map((radius) => (
            <circle key={`ring-${radius}`} className="radial-ring" r={radius} />
          ))}

          <g className="radial-edges" aria-hidden="true">
            {layout.edges.map((edge, index) => (
              <path
                key={`edge-${index}`}
                className="radial-edge"
                d={edge.d}
                stroke={branchColor(palette, edge.branch)}
                strokeWidth={edge.depth === 1 ? 2 : 1.25}
              />
            ))}
          </g>

          {layout.boxes.map((box) => (
            <g
              key={box.id}
              className={`radial-node${box.depth === 0 ? ' is-root' : ''}${
                selectedId && box.id === selectedId ? ' mm-selected' : ''
              }`}
              data-depth={box.depth}
              transform={`translate(${box.x} ${box.y})`}
              style={{ '--branch': branchColor(palette, box.branch) } as React.CSSProperties}
            >
              <foreignObject
                x={-box.width / 2}
                y={-box.height / 2}
                width={box.width}
                height={box.height}
              >
                <div
                  className="radial-frame"
                  style={{ width: box.width, height: box.height }}
                  dangerouslySetInnerHTML={{ __html: box.content }}
                />
              </foreignObject>
            </g>
          ))}
        </g>
      </svg>
    )
  },
)

RadialMap.displayName = 'RadialMap'

export default RadialMap
