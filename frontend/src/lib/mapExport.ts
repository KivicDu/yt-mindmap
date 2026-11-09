/**
 * Export the study map without pulling in another library.
 *
 * Markdown is rebuilt from the tree (the same data the editor works on), while
 * SVG/PNG come from the live markmap SVG. The live SVG already carries
 * markmap's own stylesheet, so the export only has to add this app's node
 * styles and resolve the theme custom properties to literal values.
 */

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

/** CSS rules that style map nodes. Markmap's base sheet is already in the SVG. */
function collectMapCss(): string {
  const parts: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      // A cross-origin sheet cannot be read; it never contains map styles.
      continue
    }
    for (const rule of Array.from(rules)) {
      const text = rule.cssText
      if (text.includes('.mindmap') || text.includes('.mm-')) parts.push(text)
    }
  }
  return parts.join('\n')
}

/**
 * Build a standalone SVG document from the live map.
 *
 * The root `<g>` carries markmap's pan/zoom transform, so it is reset: the
 * export frames the whole map at its native size rather than the viewport the
 * learner happens to be looking at.
 */
export function buildMapSvg(source: MapExportSource): string {
  const { svg, bounds, title } = source
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

  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  background.setAttribute('x', String(viewX))
  background.setAttribute('y', String(viewY))
  background.setAttribute('width', String(viewWidth))
  background.setAttribute('height', String(viewHeight))
  background.setAttribute('fill', computed.getPropertyValue('--paper').trim() || '#ffffff')
  clone.insertBefore(background, clone.firstChild)

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = collectMapCss()
  clone.appendChild(style)

  const serialized = new XMLSerializer().serializeToString(clone)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${title || 'Mind map'} -->\n${serialized}`
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

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    )
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

  const markup = buildMapSvg(source)
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
