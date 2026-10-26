export interface MindMapNode {
  content?: unknown
  children?: MindMapNode[]
  payload?: Record<string, unknown>
}

/**
 * markmap nodes keep their label as HTML in `content`; strip tags and entities
 * so labels can be compared and matched reliably.
 */
export function plainText(content: unknown): string {
  return String(content ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Collect every label in the tree, used to detect freshly added nodes. */
export function collectNames(node: MindMapNode | null | undefined, names: Set<string>): void {
  if (!node) return
  const text = plainText(node.content)
  if (text) names.add(text)
  for (const child of node.children || []) {
    collectNames(child, names)
  }
}

/**
 * First label that was not present before this render (pre-order). The root is
 * skipped because it is the map title, not a generated topic.
 */
export function findFirstNew(
  node: MindMapNode | null | undefined,
  known: Set<string>,
  root: MindMapNode | null | undefined,
): MindMapNode | null {
  if (!node) return null
  const text = plainText(node.content)
  if (node !== root && text && !known.has(text)) {
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
  root: MindMapNode | null | undefined,
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
