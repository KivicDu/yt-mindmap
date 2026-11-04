export interface MapNode {
  id: string
  parentId: string | null
  label: string
  time?: number | null
  note?: string
  pinned?: boolean
  aliases?: string[]
  children?: MapNode[]
}

export const MAX_NOTE_CHARS = 2000

/** Shape markmap-view accepts for `setData`. */
export interface MarkmapNode {
  content: string
  children: MarkmapNode[]
  payload: Record<string, unknown>
}

export interface MapTree {
  title: string
  nodes: MapNode[]
}

const SEEK_PREFIX = '#seek-'
const EMPTY_HINT = 'Mind map will build as video plays...'

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function cleanLabel(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Notes keep their line breaks; only the edges are trimmed. */
export function cleanNote(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .slice(0, MAX_NOTE_CHARS)
}

function hasTime(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function formatTime(seconds: number): string {
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Deepest level that gets its own type style; deeper nodes reuse `mm-d4`. */
export const MAX_STYLED_DEPTH = 4

/** Class wrapper that lets CSS give each level of the map its own weight. */
function row(content: string, depth: number): string {
  const level = Math.min(Math.max(depth, 0), MAX_STYLED_DEPTH)
  return `<span class="mm-row mm-d${level}">${content}</span>`
}

/**
 * One markmap node from one map node.
 *
 * The label keeps the `#seek-` link so the existing click handler works, and
 * carries `data-node-id` so a click can also address the node in the tree
 * (rename, note, pin). A note renders as a second line under the label.
 *
 * `depth` (1 = top-level topic) drives the type scale: a lecture reads better
 * when the shape of the tree is visible without reading every word.
 */
export function nodeToMarkmap(node: MapNode, depth = 1): MarkmapNode {
  const label = escapeHtml(cleanLabel(node.label))
  const id = escapeHtml(node.id)
  const timeBadge = hasTime(node.time)
    ? `<span class="mm-time" title="Nhảy đến ${formatTime(node.time)}">[${escapeHtml(formatTime(node.time))}]</span>`
    : ''
  const title = hasTime(node.time)
    ? `<a href="${SEEK_PREFIX}${node.time.toFixed(1)}" data-node-id="${id}" title="${escapeHtml(label)}">${label}</a>`
    : `<span data-node-id="${id}" title="${escapeHtml(label)}">${label}</span>`

  const pin = node.pinned
    ? '<span class="mm-pin" title="Đã ghim" aria-hidden="true">📌</span>'
    : ''
  const note = cleanNote(node.note)
  const noteHtml = note ? `<span class="mm-note" title="${escapeHtml(note)}">${escapeHtml(note)}</span>` : ''

  const children = (node.children || []).map((child) => nodeToMarkmap(child, depth + 1))
  return {
    content: row(`${pin}${timeBadge}${title}${noteHtml}`, depth),
    children,
    payload: node.pinned ? { pinned: true } : {},
  }
}

/** Convert the tree into the data markmap renders, including the map title. */
export function buildMapData(tree: MapTree): MarkmapNode {
  const children = tree.nodes.map((node) => nodeToMarkmap(node, 1))
  if (children.length === 0) {
    children.push({ content: EMPTY_HINT, children: [], payload: {} })
  }
  return { content: row(escapeHtml(tree.title || 'Mind map'), 0), children, payload: {} }
}

/** Total number of topics, used for the "N ý" counter in the UI. */
export function countNodes(nodes: MapNode[] | null | undefined): number {
  if (!Array.isArray(nodes)) return 0
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0)
}

/** Every node id in the rendered data, used to detect freshly added nodes. */
export function collectIds(node: MarkmapNode | null | undefined, ids: Set<string>): void {
  if (!node) return
  const id = nodeIdOf(node)
  if (id) ids.add(id)
  for (const child of node.children || []) {
    collectIds(child, ids)
  }
}

function nodeIdOf(node: MarkmapNode): string | null {
  const match = /data-node-id="([^"]+)"/.exec(String(node.content ?? ''))
  return match ? match[1] : null
}

/**
 * First node that was not in the previous render (pre-order). The root is
 * skipped because it is the map title, not a generated topic.
 */
export function findFirstNew(
  node: MarkmapNode | null | undefined,
  known: Set<string>,
  root: MarkmapNode | null | undefined,
): MarkmapNode | null {
  if (!node) return null
  const id = nodeIdOf(node)
  if (node !== root && id && !known.has(id)) {
    return node
  }
  for (const child of node.children || []) {
    const found = findFirstNew(child, known, root)
    if (found) return found
  }
  return null
}

/**
 * Fold all but the newest `keepLast` top-level branches so a long lecture stays
 * readable in "focus recent" mode.
 */
export function collapseOlderBranches(
  root: MarkmapNode | null | undefined,
  keepLast: number,
): void {
  const children = root?.children || []
  if (children.length <= keepLast) return
  children.forEach((child, index) => {
    // A pinned branch is the user saying "keep this in view".
    if (child.payload?.pinned) return
    if (index < children.length - keepLast) {
      child.payload = { ...(child.payload || {}), fold: 1 }
    }
  })
}

/** Depth-first lookup, used by the editor panel. */
export function findNodeById(nodes: MapNode[], id: string): MapNode | null {
  for (const node of nodes || []) {
    if (node.id === id) return node
    const found = findNodeById(node.children || [], id)
    if (found) return found
  }
  return null
}

/** Guard against a malformed tree from an older cache or a bad payload. */
export function normalizeTree(raw: unknown): MapNode[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((entry): entry is MapNode => Boolean(entry) && typeof entry === 'object')
    .map((entry) => {
      const aliases = Array.isArray(entry.aliases)
        ? entry.aliases.filter((alias): alias is string => typeof alias === 'string')
        : []
      const node: MapNode = {
        id: typeof entry.id === 'string' && entry.id ? entry.id : crypto.randomUUID(),
        parentId: typeof entry.parentId === 'string' ? entry.parentId : null,
        label: cleanLabel(entry.label),
        time: hasTime(entry.time) ? entry.time : null,
        note: typeof entry.note === 'string' ? cleanNote(entry.note) : '',
        pinned: entry.pinned === true,
        children: normalizeTree(entry.children),
      }
      if (aliases.length > 0) node.aliases = aliases
      return node
    })
    .filter((entry) => entry.label.length > 0)
}
