/**
 * Export the study map without pulling in another library.
 *
 * Markdown is rebuilt from the tree (the same data the editor works on), while
 * SVG/PNG come from the live markmap SVG. The live SVG already carries
 * markmap's own stylesheet, so the export only has to add this app's node
 * styles and resolve the theme custom properties to literal values.
 *
 * PNG needs one extra step. The map draws its labels as HTML inside
 * `<foreignObject>`, and rasterising that taints the canvas in every browser
 * ("Tainted canvases may not be exported" / "The operation is insecure"), so
 * the PNG path replaces those frames with real `<text>` lines measured from
 * the live DOM. The SVG path keeps the HTML, which browsers render perfectly.
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
  size: number
  weight: string
  family: string
  fill: string
}

interface BadgeBox {
  x: number
  y: number
  width: number
  height: number
  fill: string
  stroke: string
}

function toMap(inverse: DOMMatrix, x: number, y: number): { x: number; y: number } {
  const point = new DOMPoint(x, y).matrixTransform(inverse)
  return { x: point.x, y: point.y }
}

/**
 * One HTML node box turned into text lines in map coordinates.
 *
 * A text node can wrap across several lines, so every word is measured on its
 * own and words that share a line box are joined back together. This keeps the
 * line breaks the learner sees instead of re-implementing the wrapping.
 */
function fragmentsFromFrame(frame: Element, inverse: DOMMatrix): TextFragment[] {
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

    const tokens: { text: string; rect: DOMRect }[] = []
    const wordPattern = /\S+/g
    let match: RegExpExecArray | null
    while ((match = wordPattern.exec(value))) {
      const range = document.createRange()
      range.setStart(node, match.index)
      range.setEnd(node, match.index + match[0].length)
      const rect = Array.from(range.getClientRects()).find(
        (candidate) => candidate.width > 0 && candidate.height > 0,
      )
      if (rect) tokens.push({ text: match[0], rect })
    }

    const lines: { top: number; bottom: number; left: number; text: string }[] = []
    for (const token of tokens) {
      const line = lines.find((candidate) => Math.abs(candidate.top - token.rect.top) < 2)
      if (line) {
        line.left = Math.min(line.left, token.rect.left)
        line.bottom = Math.max(line.bottom, token.rect.bottom)
        line.text = `${line.text} ${token.text}`
      } else {
        lines.push({
          top: token.rect.top,
          bottom: token.rect.bottom,
          left: token.rect.left,
          text: token.text,
        })
      }
    }

    for (const line of lines) {
      const height = line.bottom - line.top
      // Centre the font box inside the line box, then sit the baseline at ~80%
      // of the em, which is close enough for a raster export.
      const baseline = line.top + (height - size) / 2 + size * 0.8
      const start = toMap(inverse, line.left, baseline)
      fragments.push({ text: line.text, x: start.x, y: start.y, size, weight, family, fill })
    }
  }

  return fragments
}

/** Timestamp pills are drawn with a border, so the raster needs their box too. */
function badgesFromFrame(frame: Element, inverse: DOMMatrix): BadgeBox[] {
  return Array.from(frame.querySelectorAll('.mm-time')).map((element) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const topLeft = toMap(inverse, rect.left, rect.top)
    const bottomRight = toMap(inverse, rect.right, rect.bottom)
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
      fill: style.backgroundColor || 'transparent',
      stroke: style.borderTopColor || 'transparent',
    }
  })
}

/**
 * Swap every `<foreignObject>` for measured `<text>` so the SVG can be drawn
 * into a canvas without tainting it.
 */
function replaceFramesWithText(svg: SVGSVGElement, clone: SVGSVGElement): void {
  const matrix = svg.getScreenCTM()
  if (!matrix) return
  const inverse = matrix.inverse()

  const frames = Array.from(svg.querySelectorAll('foreignObject'))
  const fragments: TextFragment[] = []
  const badges: BadgeBox[] = []
  for (const frame of frames) {
    fragments.push(...fragmentsFromFrame(frame, inverse))
    badges.push(...badgesFromFrame(frame, inverse))
  }

  clone.querySelectorAll('foreignObject').forEach((node) => node.remove())
  if (fragments.length === 0) return

  const layer = document.createElementNS(SVG_NS, 'g')
  layer.setAttribute('class', 'mm-export-text')

  for (const badge of badges) {
    const rect = document.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('x', String(badge.x))
    rect.setAttribute('y', String(badge.y))
    rect.setAttribute('width', String(badge.width))
    rect.setAttribute('height', String(badge.height))
    rect.setAttribute('rx', '3')
    rect.setAttribute('fill', badge.fill)
    rect.setAttribute('stroke', badge.stroke)
    layer.appendChild(rect)
  }

  for (const fragment of fragments) {
    const text = document.createElementNS(SVG_NS, 'text')
    text.setAttribute('x', String(fragment.x))
    text.setAttribute('y', String(fragment.y))
    text.setAttribute('font-size', String(fragment.size))
    text.setAttribute('font-weight', fragment.weight)
    text.setAttribute('font-family', fragment.family)
    text.setAttribute('fill', fragment.fill)
    text.textContent = fragment.text
    layer.appendChild(text)
  }

  clone.appendChild(layer)
}

/**
 * Build a standalone SVG document from the live map.
 *
 * The root `<g>` carries markmap's pan/zoom transform, so it is reset: the
 * export frames the whole map at its native size rather than the viewport the
 * learner happens to be looking at.
 */
export function buildMapSvg(
  source: MapExportSource,
  options: { rasterSafe?: boolean } = {},
): string {
  const { svg, bounds } = source
  if (!svg || !bounds) {
    throw new Error('Sơ đồ chưa sẵn sàng để xuất.')
  }

  const width = Math.max(1, bounds.x2 - bounds.x1)
  const height = Math.max(1, bounds.y2 - bounds.y1)
  const viewWidth = width + EXPORT_PADDING * 2
  const viewHeight = height + EXPORT_PADDING * 2
  const viewX = bounds.x1 - EXPORT_PADDING
  const viewY = bounds.y1 - EXPORT_PADDING

  const clone = svg.cloneNode(true) as SVGSVGElement
  const computed = getComputedStyle(svg)
  for (const name of THEME_VARS) {
    const value = computed.getPropertyValue(name).trim()
    if (value) clone.style.setProperty(name, value)
  }
  clone.style.width = `${viewWidth}px`
  clone.style.height = `${viewHeight}px`
  clone.style.backgroundColor = computed.getPropertyValue('--paper').trim() || '#ffffff'

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.setAttribute('width', String(viewWidth))
  clone.setAttribute('height', String(viewHeight))
  clone.setAttribute('viewBox', `${viewX} ${viewY} ${viewWidth} ${viewHeight}`)
  clone.removeAttribute('tabindex')
  clone.removeAttribute('role')
  clone.removeAttribute('aria-label')

  // Reset pan/zoom and drop transient highlight/selection decorations.
  const rootGroup = clone.querySelector('g')
  rootGroup?.removeAttribute('transform')
  clone.querySelectorAll('g.markmap-highlight').forEach((node) => node.remove())
  clone.querySelectorAll('.mm-selected').forEach((node) => node.classList.remove('mm-selected'))

  const background = document.createElementNS(SVG_NS, 'rect')
  background.setAttribute('x', String(viewX))
  background.setAttribute('y', String(viewY))
  background.setAttribute('width', String(viewWidth))
  background.setAttribute('height', String(viewHeight))
  background.setAttribute('fill', computed.getPropertyValue('--paper').trim() || '#ffffff')
  clone.insertBefore(background, clone.firstChild)

  // Rasterising an SVG that still holds foreignObject HTML taints the canvas,
  // so the PNG path gets measured text lines instead.
  if (options.rasterSafe) {
    replaceFramesWithText(svg, clone)
  }

  const style = document.createElementNS(SVG_NS, 'style')
  style.textContent = mindMapCss
  clone.appendChild(style)

  const serialized = new XMLSerializer().serializeToString(clone)
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`
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

  const markup = buildMapSvg(source, { rasterSafe: format === 'png' })
  if (format === 'svg') {
    download(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }), `${base}.svg`)
    return
  }

  const { bounds } = source
  if (!bounds) throw new Error('Sơ đồ chưa sẵn sàng để xuất.')
  const width = bounds.x2 - bounds.x1 + EXPORT_PADDING * 2
  const height = bounds.y2 - bounds.y1 + EXPORT_PADDING * 2
  const blob = await svgToPngBlob(markup, width, height)
  download(blob, `${base}.png`)
}
