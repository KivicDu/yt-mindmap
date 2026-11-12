import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { Markmap } from 'markmap-view'
import { useTheme } from '../context/ThemeContext'
import {
  buildMapData,
  collapseOlderBranches,
  collectIds,
  findFirstNew,
  type MapNode,
  type MarkmapNode,
} from '../lib/mindmapTree'
import { styleVars, type MapPalette } from '../lib/mapStyle'
import type { MindMapHandle, MindMapProps } from '../lib/mapView'
import './MindMap.css'

interface TreeMapProps extends MindMapProps {
  palette: MapPalette
}

/**
 * How the viewport should react to new data.
 *
 * - `keep`  — leave the camera alone (background updates must not yank the map)
 * - `fit`   — frame the map, but never below the readable scale
 * - `focus` — pan just enough to show a freshly added node
 */
type ViewMode = 'keep' | 'fit' | 'focus'

const COLLAPSE_KEEP_LAST = 3
const INITIAL_TREE: MapNode[] = []
const MIN_SCALE = 0.15
const MAX_SCALE = 4
/**
 * A restored tree arrives as a burst of renders (cache → parser → SSE), so
 * "pan to the newest topic" would yank the camera to the bottom of the map
 * before the learner has read the first line. Focus panning only starts once
 * the burst has settled.
 */
const INITIAL_BURST_MS = 1500
/**
 * Below this zoom the 13.5px labels drop under ~11px on screen, which is where
 * a lecture map stops being readable. A 20-topic map is simply taller than a
 * laptop panel, so "show everything" and "show it legibly" cannot both win:
 * the automatic framing keeps the text legible and lets the map overflow
 * vertically, which the learner can pan. The 0 / "vừa khung" control still
 * offers the true overview, because there it is an explicit choice.
 */
const READABLE_SCALE = 0.8

/** Theme colours have to be literal values: markmap writes them into SVG attrs. */
function readColorVar(svg: SVGSVGElement | null, name: string, fallback: string): string {
  if (!svg) return fallback
  return getComputedStyle(svg).getPropertyValue(name).trim() || fallback
}

const SVG_STYLE = {
  width: '100%',
  height: '100%',
  // markmap injects its own .markmap rules after ours, so the theme variables
  // are set inline (inline style wins, and custom properties inherit down).
  '--markmap-font': '400 14px/1.45 var(--sans)',
  '--markmap-text-color': 'var(--ink)',
  '--markmap-a-color': 'var(--ink)',
  '--markmap-a-hover-color': 'var(--accent-ink)',
  '--markmap-highlight-bg': 'var(--accent-soft)',
  '--markmap-highlight-node-bg': 'var(--accent-soft-2)',
  '--markmap-circle-open-bg': 'var(--surface)',
  '--markmap-code-bg': 'var(--paper-2)',
  '--markmap-code-color': 'var(--ink-2)',
} as CSSProperties

const TreeMap = forwardRef<MindMapHandle, TreeMapProps>(
  ({ onSeek, onSelect, selectedId, collapseOld, onReady, palette }, ref) => {
    const refSvg = useRef<SVGSVGElement>(null)
    const mm = useRef<Markmap | null>(null)
    const lastTree = useRef<{ title: string; nodes: MapNode[] }>({
      title: 'Lecture Mind Map',
      nodes: INITIAL_TREE,
    })
    const knownIds = useRef(new Set<string>())
    const hasFitted = useRef(false)
    const fittedAt = useRef(0)
    const onSeekRef = useRef(onSeek)
    const onReadyRef = useRef(onReady)
    const onSelectRef = useRef(onSelect)
    const selectedIdRef = useRef<string | null>(selectedId ?? null)
    const collapseRef = useRef(Boolean(collapseOld))
    const selectionObserver = useRef<MutationObserver | null>(null)
    const highlightTimer = useRef<number | null>(null)
    const skipFirstCollapseEffect = useRef(true)
    const skipFirstThemeEffect = useRef(true)
    const renderQueue = useRef<Promise<void>>(Promise.resolve())
    const { resolved: theme } = useTheme()

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
     * Outline the selected node without re-rendering: a full setData on every
     * click would move the view the user is reading.
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

    /**
     * Frame the whole map, then undo the zoom-out if it went below the
     * readable floor.
     *
     * A big lecture map does not fit at a legible size, so something has to be
     * cut. Framing the root — offset to the left third, because the tree only
     * grows rightwards — keeps the starting point and its nearest branches on
     * screen; the rest is a pan or a `0` away.
     */
    const fitReadable = async (instance: Markmap) => {
      await instance.fit()
      const svg = refSvg.current
      const rect = svg?.getBoundingClientRect()
      const root = instance.state.data
      if (!svg || !rect || !root) return

      const scale = (svg as any).__zoom?.k ?? 1
      if (scale >= READABLE_SCALE) return

      // `rescale()` multiplies the current zoom, it does not set it, so the
      // target has to be expressed as a ratio of whatever fit() produced.
      await instance.rescale(READABLE_SCALE / scale)
      try {
        await instance.centerNode(root, {
          left: 0,
          right: rect.width * 0.55,
          top: 0,
          bottom: 0,
        })
      } catch {
        // Panning is cosmetic; the legible scale above is what matters.
      }
    }

    const doRender = async (title: string, nodes: MapNode[], mode: ViewMode) => {
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
      const becameNonEmpty = previousIds.size === 0 && currentIds.size > 0

      await instance.setData(root as any)

      // The empty map is only the placeholder line: framing it would leave the
      // camera fitted to one sentence, so the first real tree starts from a
      // clean slate instead.
      if (currentIds.size === 0) {
        hasFitted.current = false
        applySelection(selectedIdRef.current)
        return
      }

      if (!hasFitted.current || mode === 'fit' || becameNonEmpty) {
        hasFitted.current = true
        fittedAt.current = Date.now()
        await fitReadable(instance)
      } else if (mode === 'focus' && Date.now() - fittedAt.current > INITIAL_BURST_MS) {
        // A new topic is added while someone is reading; only pan if it is
        // actually off-screen, never rescale. Auto-fitting here is what made
        // the map unreadable (0.34 scale with 84 nodes).
        const target = findFirstNew(root, previousIds, root)
        if (target) {
          try {
            await instance.ensureVisible(target as MarkmapNode as any, {
              left: 56,
              right: 56,
              top: 40,
              bottom: 56,
            })
            await instance.setHighlight(target as any)
            scheduleHighlightClear(instance)
          } catch {
            // ensureVisible is best-effort; never break a render over it.
          }
        }
      }

      // markmap rewrites every node's `class` attribute on each render, so the
      // selection ring has to be re-applied after the render, not before it.
      applySelection(selectedIdRef.current)
    }

    /**
     * Renders are async and arrive in bursts (mount, lazy `onReady`, SSE,
     * editor save). Queueing them means the newest tree is always the one left
     * on screen, and the camera moves once, in order — instead of an older
     * `setData` resolving last and reframing the map behind the user's back.
     */
    const render = (title: string, nodes: MapNode[], mode: ViewMode) => {
      const next = renderQueue.current.then(() => doRender(title, nodes, mode)).catch(() => {})
      renderQueue.current = next
      return next
    }

    /**
     * Branch colour: the palette entry belonging to the node's top-level
     * branch. `state.path` looks like "0.3.1", where the second segment is the
     * branch index, so a whole branch shares one colour.
     */
    const colorFor = (node: any) => {
      const depth = node?.state?.depth ?? 0
      const svg = refSvg.current
      if (depth === 0) return readColorVar(svg, '--ink-3', '#6f6b61')
      const branch = Number(String(node?.state?.path ?? '').split('.')[1] ?? 0)
      const index = Number.isFinite(branch) ? (branch % 6) + 1 : 1
      return readColorVar(svg, `--mm-b${index}`, '#c4bcab')
    }

    useEffect(() => {
      if (refSvg.current && !mm.current) {
        const svg = refSvg.current
        mm.current = Markmap.create(svg, {
          // The map should stay where the learner left it. Fitting every
          // update shrinks the text below the readable floor.
          autoFit: false,
          duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260,
          // markmap turns the wheel into panning on a Mac (`scrollForPan` is
          // true for "Macintosh" user agents) and only zooms with ctrl+wheel.
          // A trackpad scroll then looks like the map jumping around while the
          // zoom never changes. The wheel zooms here, like everywhere else in
          // the app, and panning stays on drag.
          scrollForPan: false,
          pan: false,
          fitRatio: 0.9,
          maxInitialScale: 1.5,
          maxWidth: 280,
          nodeMinHeight: 20,
          paddingX: 10,
          spacingHorizontal: 72,
          spacingVertical: 10,
          color: colorFor,
          lineWidth: (node: any) => ((node?.state?.depth ?? 0) <= 1 ? 2 : 1.25),
        })
        // markmap rewrites every node's `class` attribute on each render — and
        // it renders again from its own ResizeObserver, after `setData` has
        // resolved. Applying the ring once is therefore not enough: it can be
        // wiped by a render that happens later. Re-applying on class mutations
        // keeps the outline stable without an extra setData.
        selectionObserver.current = new MutationObserver(() => {
          applySelection(selectedIdRef.current)
        })
        selectionObserver.current.observe(svg, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['class'],
        })
        // Tell the owner the renderer exists straight away. Waiting for the
        // empty placeholder render to finish would couple "ready" to markmap's
        // animation frame, which is throttled while the tab is in the
        // background — and the owner's tree would then never be pushed.
        onReadyRef.current?.()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(
      () => () => {
        if (highlightTimer.current) {
          window.clearTimeout(highlightTimer.current)
        }
        selectionObserver.current?.disconnect()
        selectionObserver.current = null
        mm.current?.destroy()
        mm.current = null
      },
      [],
    )

    useEffect(() => {
      if (skipFirstCollapseEffect.current) {
        skipFirstCollapseEffect.current = false
        return
      }
      collapseRef.current = Boolean(collapseOld)
      render(lastTree.current.title, lastTree.current.nodes, 'fit')
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collapseOld])

    // Link colours are SVG attributes, not CSS, so a theme switch has to
    // re-render the tree. The camera transform lives on the <svg> and survives.
    useEffect(() => {
      if (skipFirstThemeEffect.current) {
        skipFirstThemeEffect.current = false
        return
      }
      const instance = mm.current
      const svg = refSvg.current
      if (!instance || !svg) return
      instance.setOptions({ color: colorFor })
      render(lastTree.current.title, lastTree.current.nodes, 'keep')
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [theme, palette])

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
      render(title, nodes, options?.focusNew === false ? 'keep' : 'focus')
    }

    const zoom = (factor: number) => {
      const instance = mm.current
      const svg = refSvg.current
      if (!instance || !svg) return
      const current = (svg as any).__zoom?.k ?? 1
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current * factor))
      if (Math.abs(next - current) < 0.001) return
      // `rescale()` is a multiplier, not a setter: hand it the ratio.
      void instance.rescale(next / current)
    }

    const fit = () => {
      const instance = mm.current
      const rect = instance?.state.rect
      // With no data the rect is empty, and markmap's fit() divides by zero
      // and clamps up to maxInitialScale — i.e. it zooms *in* on an empty map.
      if (!instance || !instance.state.data || !rect) return
      if (rect.x2 <= rect.x1 || rect.y2 <= rect.y1) return
      void instance.fit()
    }

    /** Re-centre the root without touching the zoom level. */
    const center = () => {
      const instance = mm.current
      const root = instance?.state.data
      if (!instance || !root) return
      void instance.centerNode(root, { left: 0, right: 0, top: 0, bottom: 0 })
    }

    const getSvg = () => refSvg.current

    const getBounds = () => {
      const rect = mm.current?.state.rect
      if (!rect) return null
      if (rect.x2 <= rect.x1 || rect.y2 <= rect.y1) return null
      return { x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: rect.y2 }
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

    useImperativeHandle(ref, () => ({ updateTree, zoom, fit, center, getSvg, getBounds }))

    return (
      <svg
        ref={refSvg}
        className="mindmap mindmap--tree"
        style={{ ...SVG_STYLE, ...styleVars({ layout: 'tree', palette }) }}
        tabIndex={0}
        role="group"
        aria-label="Sơ đồ tư duy. Dùng Tab hoặc phím mũi tên để duyệt nhánh, Enter hoặc Space để chọn; phím + và − để phóng to thu nhỏ, phím 0 để vừa khung."
        onKeyDown={handleKeyDown}
        onDoubleClick={fit}
      />
    )
  },
)

TreeMap.displayName = 'TreeMap'

export default TreeMap
