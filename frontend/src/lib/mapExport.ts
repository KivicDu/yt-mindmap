/**
 * Export the study map without pulling in another library.
 *
 * Markdown is rebuilt from the tree (the same data the editor works on), while
 * SVG/PNG come from the live map SVG. The map draws its labels as HTML inside
 * `<foreignObject>`, which is a problem for both formats: rasterising it taints
 * the canvas ("Tainted canvases may not be exported"), and a standalone file
 * that still holds HTML looks nothing like the map in anything but a browser
 * that chooses to render it. So both formats get the same treatment: the HTML
 * boxes are measured and redrawn as real `<rect>`/`<text>` nodes, which also
 * means the PNG and the SVG are the same picture.
 *
 * Measurement happens on a temporary copy of the map at scale 1. Screen-space
 * rectangles from the live map are scaled by the current zoom while the CSS
 * font sizes are not, so measuring a zoomed map mixes units and the text drifts
 * off its edges. At scale 1 the two agree, and each line can be pinned to the
 * width the browser gave it.
 */

import mindMapCss from '../components/MindMap.css?raw'
import { formatTime, type MapNode } from './mindmapTree'

export type ExportFormat = 'svg' | 'png' | 'markdown'

export interface MapBounds {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface MapExportSource {
  title: string
  nodes: MapNode[]
  /** Live SVG from `MindMap`, or null when the map has not mounted yet. */
  svg: SVGSVGElement | null
  /** Content bounds in map coordinates (markmap's `state.rect`). */
  bounds: MapBounds | null
}

const EXPORT_PADDING = 28
const PNG_SCALE = 2
const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Theme variables the SVG and its foreignObject HTML read. Resolving them up
 * front means the exported file keeps the current light/dark palette even
 * though the original `var()` definitions lived on the page.
 */
const THEME_VARS = [
  '--paper',
  '--surface',
  '--paper-2',
  '--paper-3',
  '--ink',
  '--ink-2',
  '--ink-3',
  '--line',
  '--line-2',
  '--line-strong',
  '--accent',
  '--accent-soft',
  '--accent-soft-2',
  '--accent-line',
  '--accent-ink',
  '--hover',
  '--sans',
  '--mono',
  '--r-sm',
  '--r-xs',
  '--markmap-font',
  '--markmap-text-color',
  '--markmap-a-color',
  '--markmap-a-hover-color',
  '--markmap-highlight-bg',
  '--markmap-highlight-node-bg',
  '--markmap-circle-open-bg',
  '--markmap-code-bg',
  '--markmap-code-color',
]

/** Strip accents so "Tổng quan" becomes a safe `tong-quan` filename. */
export function exportSlug(value: string): string {
  const cleaned = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return cleaned || 'mindmap'
}

/** Nested bullet list, with timestamps and notes kept as study context. */
export function mapToMarkdown({ title, nodes }: Pick<MapExportSource, 'title' | 'nodes'>): string {
  const lines: string[] = [`# ${title || 'Mind map'}`, '']

  const walk = (items: MapNode[], depth: number) => {
    for (const node of items) {
      const indent = '  '.repeat(depth)
      const stamp = typeof node.time === 'number' ? `[${formatTime(node.time)}] ` : ''
      lines.push(`${indent}- ${stamp}${node.label}`)
      if (node.note) {
        for (const noteLine of node.note.split('\n')) {
          lines.push(`${indent}  > ${noteLine}`)
        }
      }
      walk(node.children || [], depth + 1)
    }
  }

  walk(nodes, 0)
  return `${lines.join('\n')}\n`
}

interface TextFragment {
  text: string
  x: number
  y: number
  width: number
  size: number
  weight: string
  family: string
  fill: string
}

/** A box the map draws behind its labels: node cards, pills, note rules. */
interface NodeShape {
  x: number
  y: number
  width: number
  height: number
  radius: number
  fill: string
  stroke: string
  strokeWidth: number
}

interface MeasuredNodes {
  shapes: NodeShape[]
  fragments: TextFragment[]
}

/** Large enough that even a wide map lays out inside the measuring copy. */
const MEASURE_SIZE = 4000
const NO_COLOR = /^rgba\([^)]*,\s*0\)$/

function fixed(value: number): string {
  return value.toFixed(2)
}

/**
 * `getComputedStyle` can hand back colours in any CSS colour space — a
 * `color-mix()` background comes back as `color(srgb 0.92 …)`. Older SVG
 * viewers only understand `rgb()`, so every colour is pushed through a canvas
 * and read back as plain sRGB.
 */
function colorReader(): (value: string) => string {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const cache = new Map<string, string>()

  return (value: string) => {
    const cached = cache.get(value)
    if (cached) return cached

    let result = value
    if (context) {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = '#000'
      context.fillStyle = value
      context.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
      result =
        a === 255
          ? `rgb(${r}, ${g}, ${b})`
          : `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`
    }

    cache.set(value, result)
    return result
  }
}

function shapeFrom(element: Element, origin: DOMRect): NodeShape | null {
  const style = getComputedStyle(element)
  const fill = style.backgroundColor
  const strokeWidth = Number.parseFloat(style.borderTopWidth) || 0
  const transparent = fill === 'transparent' || NO_COLOR.test(fill)
  if (transparent && strokeWidth <= 0) return null

  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null

  return {
    x: rect.left - origin.left,
    y: rect.top - origin.top,
    width: rect.width,
    height: rect.height,
    radius: Number.parseFloat(style.borderTopLeftRadius) || 0,
    fill: transparent ? 'none' : fill,
    stroke: strokeWidth > 0 ? style.borderTopColor : 'none',
    strokeWidth,
  }
}

/** The accent bar down the left edge of a note. */
function noteRules(frame: Element, origin: DOMRect): NodeShape[] {
  return Array.from(frame.querySelectorAll('.mm-note')).flatMap((element) => {
    const style = getComputedStyle(element)
    const width = Number.parseFloat(style.borderLeftWidth) || 0
    const rect = element.getBoundingClientRect()
    if (width <= 0 || rect.height <= 0) return []
    return [
      {
        x: rect.left - origin.left,
        y: rect.top - origin.top,
        width,
        height: rect.height,
        radius: 0,
        fill: style.borderLeftColor,
        stroke: 'none',
        strokeWidth: 0,
      },
    ]
  })
}

/**
 * One HTML node box turned into text lines in map coordinates.
 *
 * A text node can wrap across several lines, so every word is measured on its
 * own and words that share a line box are joined back together. This keeps the
 * line breaks the learner sees instead of re-implementing the wrapping.
 */
function textFragments(
  frame: Element,
  origin: DOMRect,
  context: CanvasRenderingContext2D | null,
): TextFragment[] {
  const fragments: TextFragment[] = []
  const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT)

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? ''
    if (!value.trim()) continue
    const parent = node.parentElement
    if (!parent) continue

    const style = getComputedStyle(parent)
    const size = Number.parseFloat(style.fontSize) || 13
    const weight = style.fontWeight || '400'
    const family = style.fontFamily || 'sans-serif'
    const fill = style.color || '#333'

    // `fontBoundingBoxAscent` is the distance the browser itself puts between
    // the top of a line box and the baseline. Guessing it from the em size
    // drifts a pixel or two per size, which is enough to make exported labels
    // look like they were pasted on instead of laid out.
    let ascent = 0
    if (context) {
      context.font = `${weight} ${size}px ${family}`
      ascent = context.measureText('Hg').fontBoundingBoxAscent || 0
    }
    if (!ascent) ascent = size * 0.8

    const tokens: { text: string; top: number; left: number; right: number }[] = []
    const wordPattern = /\S+/g
    let match: RegExpExecArray | null
    while ((match = wordPattern.exec(value))) {
      const range = document.createRange()
      range.setStart(node, match.index)
      range.setEnd(node, match.index + match[0].length)
      const rect = Array.from(range.getClientRects()).find(
        (candidate) => candidate.width > 0 && candidate.height > 0,
      )
      if (!rect) continue
      tokens.push({
        text: match[0],
        top: rect.top - origin.top,
        left: rect.left - origin.left,
        right: rect.right - origin.left,
      })
    }

    const lines: { top: number; left: number; right: number; text: string }[] = []
    for (const token of tokens) {
      // At scale 1 words on the same line share a top to well under a pixel,
      // while lines are ~19px apart, so a tight tolerance is safe.
      const line = lines.find((candidate) => Math.abs(candidate.top - token.top) < 1.5)
      if (line) {
        line.left = Math.min(line.left, token.left)
        line.right = Math.max(line.right, token.right)
        line.text = `${line.text} ${token.text}`
      } else {
        lines.push({ ...token })
      }
    }

    for (const line of lines) {
      fragments.push({
        text: line.text,
        x: line.left,
        y: line.top + ascent,
        width: line.right - line.left,
        size,
        weight,
        family,
        fill,
      })
    }
  }

  return fragments
}

/**
 * Lay the map out once at its natural scale, off-screen, and read the boxes and
 * baselines from that copy.
 */
function measureNodes(svg: SVGSVGElement): MeasuredNodes | null {
  if (!document.body) return null

  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = `position:fixed;top:0;left:-20000px;width:${MEASURE_SIZE}px;height:${MEASURE_SIZE}px;pointer-events:none;opacity:0;`

  const natural = svg.cloneNode(true) as SVGSVGElement
  natural.querySelector(':scope > g')?.removeAttribute('transform')
  natural.style.width = `${MEASURE_SIZE}px`
  natural.style.height = `${MEASURE_SIZE}px`
  natural.style.overflow = 'visible'
  host.appendChild(natural)
  document.body.appendChild(host)

  try {
    const origin = natural.getBoundingClientRect()
    const context = document.createElement('canvas').getContext('2d')
    const shapes: NodeShape[] = []
    const fragments: TextFragment[] = []

    for (const frame of Array.from(natural.querySelectorAll('foreignObject'))) {
      // `.mm-time` sits inside `.mm-row`, so the pill is drawn after the card.
      for (const element of Array.from(frame.querySelectorAll('.mm-row, .mm-time'))) {
        const shape = shapeFrom(element, origin)
        if (shape) shapes.push(shape)
      }
      shapes.push(...noteRules(frame, origin))
      fragments.push(...textFragments(frame, origin, context))
    }

    return { shapes, fragments }
  } finally {
    host.remove()
  }
}

/**
 * Swap every `<foreignObject>` for measured `<rect>`/`<text>` so the file is a
 * real drawing: it renders the same in a browser, an image viewer or a design
 * tool, and it can be rasterised without tainting the canvas. Returns the box
 * the drawn content occupies, which can be wider than the declared bounds when
 * a label overflows the estimate the layout made for it.
 */
function replaceFramesWithText(svg: SVGSVGElement, clone: SVGSVGElement): MapBounds | null {
  const measured = measureNodes(svg)
  clone.querySelectorAll('foreignObject').forEach((node) => node.remove())
  if (!measured) return null

  const { shapes, fragments } = measured
  if (shapes.length === 0 && fragments.length === 0) return null

  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  const include = (left: number, top: number, right: number, bottom: number) => {
    x1 = Math.min(x1, left)
    y1 = Math.min(y1, top)
    x2 = Math.max(x2, right)
    y2 = Math.max(y2, bottom)
  }

  const toColor = colorReader()
  const layer = document.createElementNS(SVG_NS, 'g')
  layer.setAttribute('class', 'mm-export-nodes')

  for (const shape of shapes) {
    include(shape.x, shape.y, shape.x + shape.width, shape.y + shape.height)
    const rect = document.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('x', fixed(shape.x))
    rect.setAttribute('y', fixed(shape.y))
    rect.setAttribute('width', fixed(shape.width))
    rect.setAttribute('height', fixed(shape.height))
    if (shape.radius > 0) rect.setAttribute('rx', fixed(shape.radius))
    rect.setAttribute('fill', shape.fill === 'none' ? 'none' : toColor(shape.fill))
    if (shape.stroke !== 'none' && shape.strokeWidth > 0) {
      rect.setAttribute('stroke', toColor(shape.stroke))
      rect.setAttribute('stroke-width', String(shape.strokeWidth))
    }
    layer.appendChild(rect)
  }

  for (const fragment of fragments) {
    if (fragment.width <= 0) continue
    include(
      fragment.x,
      fragment.y - fragment.size * 0.9,
      fragment.x + fragment.width,
      fragment.y + fragment.size * 0.25,
    )
    const text = document.createElementNS(SVG_NS, 'text')
    text.setAttribute('x', fixed(fragment.x))
    text.setAttribute('y', fixed(fragment.y))
    text.setAttribute('font-size', String(fragment.size))
    text.setAttribute('font-weight', fragment.weight)
    text.setAttribute('font-family', fragment.family)
    text.setAttribute('fill', toColor(fragment.fill))
    // The browser already chose the line breaks and the advance width. Pinning
    // the line to that width keeps both when the reader's machine resolves the
    // font stack differently, instead of letting the text grow into its
    // neighbour.
    text.setAttribute('textLength', fixed(fragment.width))
    text.setAttribute('lengthAdjust', 'spacingAndGlyphs')
    text.textContent = fragment.text
    layer.appendChild(text)
  }

  clone.appendChild(layer)
  return Number.isFinite(x1) ? { x1, y1, x2, y2 } : null
}

/**
 * Build a standalone SVG document from the live map.
 *
 * The root `<g>` carries markmap's pan/zoom transform, so it is reset: the
 * export frames the whole map at its native size rather than the viewport the
 * learner happens to be looking at.
 */
export function buildMapSvg(source: MapExportSource): string {
  return buildDrawing(source).markup
}

interface MapDrawing {
  markup: string
  width: number
  height: number
}

function buildDrawing(source: MapExportSource): MapDrawing {
  const { svg, bounds } = source
  if (!svg || !bounds) {
    throw new Error('Sơ đồ chưa sẵn sàng để xuất.')
  }

  const clone = svg.cloneNode(true) as SVGSVGElement
  const computed = getComputedStyle(svg)
  for (const name of THEME_VARS) {
    const value = computed.getPropertyValue(name).trim()
    if (value) clone.style.setProperty(name, value)
  }

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.removeAttribute('tabindex')
  clone.removeAttribute('role')
  clone.removeAttribute('aria-label')

  // Reset pan/zoom and drop transient highlight/selection decorations.
  const rootGroup = clone.querySelector('g')
  rootGroup?.removeAttribute('transform')
  clone.querySelectorAll('g.markmap-highlight').forEach((node) => node.remove())
  clone.querySelectorAll('.mm-selected').forEach((node) => node.classList.remove('mm-selected'))

  // The labels live in HTML, which neither rasterises cleanly nor survives a
  // trip through an image viewer. Both formats get the measured vector copy.
  const drawn = replaceFramesWithText(svg, clone)

  // The declared bounds come from the layout's estimate of each label, so the
  // measured text can stick out a little. Frame whatever was actually drawn.
  const frame = drawn
    ? {
        x1: Math.min(bounds.x1, drawn.x1),
        y1: Math.min(bounds.y1, drawn.y1),
        x2: Math.max(bounds.x2, drawn.x2),
        y2: Math.max(bounds.y2, drawn.y2),
      }
    : bounds

  const viewWidth = Math.max(1, frame.x2 - frame.x1) + EXPORT_PADDING * 2
  const viewHeight = Math.max(1, frame.y2 - frame.y1) + EXPORT_PADDING * 2
  const viewX = frame.x1 - EXPORT_PADDING
  const viewY = frame.y1 - EXPORT_PADDING

  clone.style.width = `${viewWidth}px`
  clone.style.height = `${viewHeight}px`
  clone.style.backgroundColor = computed.getPropertyValue('--paper').trim() || '#ffffff'
  clone.setAttribute('width', String(viewWidth))
  clone.setAttribute('height', String(viewHeight))
  clone.setAttribute('viewBox', `${viewX} ${viewY} ${viewWidth} ${viewHeight}`)

  const background = document.createElementNS(SVG_NS, 'rect')
  background.setAttribute('x', String(viewX))
  background.setAttribute('y', String(viewY))
  background.setAttribute('width', String(viewWidth))
  background.setAttribute('height', String(viewHeight))
  background.setAttribute('fill', computed.getPropertyValue('--paper').trim() || '#ffffff')
  clone.insertBefore(background, clone.firstChild)

  const style = document.createElementNS(SVG_NS, 'style')
  style.textContent = mindMapCss
  clone.appendChild(style)

  const serialized = new XMLSerializer().serializeToString(clone)
  return {
    markup: `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`,
    width: viewWidth,
    height: viewHeight,
  }
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

async function svgToPngBlob(markup: string, width: number, height: number): Promise<Blob> {
  const svgBlob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)

  try {
    const image = new Image()
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Không dựng được ảnh PNG từ sơ đồ.'))
      image.src = url
    })

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * PNG_SCALE))
    canvas.height = Math.max(1, Math.round(height * PNG_SCALE))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Trình duyệt không hỗ trợ xuất PNG.')
    context.scale(PNG_SCALE, PNG_SCALE)
    context.drawImage(image, 0, 0, width, height)

    let blob: Blob | null = null
    try {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    } catch {
      // A tainted canvas throws here; the text-only SVG should never cause it,
      // but a clear message beats a raw SecurityError in the status bar.
      throw new Error(
        'Trình duyệt chặn xuất PNG cho sơ đồ này. Hãy thử xuất SVG hoặc Markdown.',
      )
    }
    if (!blob) throw new Error('Không tạo được file PNG.')
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Save the map as SVG, PNG or Markdown. Throws a Vietnamese error on failure. */
export async function exportMap(format: ExportFormat, source: MapExportSource): Promise<void> {
  const base = exportSlug(source.title)

  if (format === 'markdown') {
    const markdown = mapToMarkdown(source)
    download(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), `${base}.md`)
    return
  }

  const drawing = buildDrawing(source)
  if (format === 'svg') {
    download(
      new Blob([drawing.markup], { type: 'image/svg+xml;charset=utf-8' }),
      `${base}.svg`,
    )
    return
  }

  const blob = await svgToPngBlob(drawing.markup, drawing.width, drawing.height)
  download(blob, `${base}.png`)
}
