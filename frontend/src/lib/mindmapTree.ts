export interface MapNode {
  id: string
  parentId: string | null
  label: string
  time?: number | null
  children?: MapNode[]
}

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

function hasTime(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * One markmap node from one map node.
 *
 * The label keeps the `#seek-` link so the existing click handler works, and
 * carries `data-node-id` so a later click can also address the node in the
 * tree (pin, rename, comment).
 */
export function nodeToMarkmap(node: MapNode): MarkmapNode {
  const label = escapeHtml(cleanLabel(node.label))
  const id = escapeHtml(node.id)
  const content = hasTime(node.time)
    ? `<a href="${SEEK_PREFIX}${node.time.toFixed(1)}" data-node-id="${id}">${label}</a>`
    : `<span data-node-id="${id}">${label}</span>`

  const children = (node.children || []).map(nodeToMarkmap)
  return { content, children, payload: {} }
}

/** Convert the tree into the data markmap renders, including the map title. */
export function buildMapData(tree: MapTree): MarkmapNode {
  const children = tree.nodes.map(nodeToMarkmap)
  if (children.length === 0) {
    children.push({ content: EMPTY_HINT, children: [], payload: {} })
  }
  return { content: escapeHtml(tree.title || 'Mind map'), children, payload: {} }
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
    if (index < children.length - keepLast) {
      child.payload = { ...(child.payload || {}), fold: 1 }
    }
  })
}

/** Guard against a malformed tree from an older cache or a bad payload. */
export function normalizeTree(raw: unknown): MapNode[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((entry): entry is MapNode => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      id: typeof entry.id === 'string' && entry.id ? entry.id : crypto.randomUUID(),
      parentId: typeof entry.parentId === 'string' ? entry.parentId : null,
      label: cleanLabel(entry.label),
      time: hasTime(entry.time) ? entry.time : null,
      children: normalizeTree(entry.children),
    }))
    .filter((entry) => entry.label.length > 0)
}
