import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { branchColor, styleVars, type MapStyle } from '../lib/mapStyle'
import type { SvgLayout } from '../lib/svgLayout'
import type { MindMapHandle } from '../lib/mapView'
import './MindMap.css'

interface SvgMapCanvasProps {
  /** Layout-specific classes, e.g. `mindmap mindmap--radial`. */
  className: string
  layout: SvgLayout
  style: MapStyle
  /** Whether a real tree has arrived; the empty hint must not be framed. */
  hasContent: boolean
  selectedId?: string | null
  onSeek?: (seconds: number) => void
  onSelect?: (nodeId: string) => void
}

const MIN_SCALE = 0.2
const MAX_SCALE = 4
const FIT_PADDING = 44
const DRAG_THRESHOLD = 4

/**
 * The interactive SVG surface shared by every custom layout.
 *
 * Pan, zoom, keyboard navigation, selection and framing are the same whether
 * the nodes were placed on rings or in rows, so they live here once. A layout
 * only has to hand over boxes and edges; it never sees the camera.
 */
const SvgMapCanvas = forwardRef<MindMapHandle, SvgMapCanvasProps>(
  ({ className, layout, style, hasContent, selectedId, onSeek, onSelect }, ref) => {
    const refSvg = useRef<SVGSVGElement>(null)
    const [view, setView] = useState({ k: 1, x: 0, y: 0 })
    const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
    const fittedLayout = useRef<string | null>(null)
    /** Once the learner pans or zooms, the camera is theirs, not ours. */
    const userMoved = useRef(false)
    const onSeekRef = useRef(onSeek)
    const onSelectRef = useRef(onSelect)

    useEffect(() => {
      onSeekRef.current = onSeek
    }, [onSeek])

    useEffect(() => {
      onSelectRef.current = onSelect
    }, [onSelect])

    const fit = useCallback(() => {
      const svg = refSvg.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const { x1, y1, x2, y2 } = layout.bounds
      const width = Math.max(1, x2 - x1) + FIT_PADDING * 2
      const height = Math.max(1, y2 - y1) + FIT_PADDING * 2
      const raw = Math.min(rect.width / width, rect.height / height)
      const k = Math.min(MAX_SCALE, Math.max(layout.fitScale, raw))
      const cx = (x1 + x2) / 2
      const cy = (y1 + y2) / 2
      setView({ k, x: rect.width / 2 - cx * k, y: rect.height / 2 - cy * k })
    }, [layout])

    // Frame the map while the learner has not touched the camera. A restored
    // tree arrives in stages (cache, then the session), so framing once on the
    // first render would lock onto a fragment and leave the rest off-screen.
    // The moment they pan or zoom, the view is theirs and updates stop moving
    // it. Switching layout is an explicit request, so it reframes.
    useEffect(() => {
      if (!hasContent || layout.boxes.length === 0) return
      const layoutChanged = fittedLayout.current !== style.layout
      if (!layoutChanged && userMoved.current) return
      if (layoutChanged) userMoved.current = false
      fittedLayout.current = style.layout
      fit()
    }, [fit, hasContent, layout.boxes.length, style.layout])

    const zoom = useCallback((factor: number) => {
      userMoved.current = true
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
      userMoved.current = true
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
        updateTree: () => {},
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
      userMoved.current = true
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
      userMoved.current = true
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
        className={className}
        style={{ width: '100%', height: '100%', ...styleVars(style) }}
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
                stroke={branchColor(style.palette, edge.branch)}
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
              style={{ '--branch': branchColor(style.palette, box.branch) } as React.CSSProperties}
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

SvgMapCanvas.displayName = 'SvgMapCanvas'

export default SvgMapCanvas
