import { describe, expect, it } from 'vitest'
import {
  collapseOlderBranches,
  collectNames,
  findFirstNew,
  plainText,
  type MindMapNode,
} from './mindmapTree'

const node = (content: string, children: MindMapNode[] = []): MindMapNode => ({
  content,
  children,
})

describe('plainText', () => {
  it('strips html tags and entities', () => {
    expect(plainText('<strong>Arrays</strong> &amp; lists')).toBe('Arrays & lists')
    expect(plainText('&lt;T&gt; &quot;x&quot; &#39;y&#39;')).toBe('<T> "x" \'y\'')
  })

  it('collapses whitespace and trims', () => {
    expect(plainText('  a\n\tb   c  ')).toBe('a b c')
  })

  it('handles nullish content', () => {
    expect(plainText(undefined)).toBe('')
    expect(plainText(null)).toBe('')
  })
})

describe('collectNames', () => {
  it('walks the whole tree', () => {
    const tree = node('Root', [node('A', [node('A1')]), node('B')])
    const names = new Set<string>()
    collectNames(tree, names)
    expect([...names]).toEqual(['Root', 'A', 'A1', 'B'])
  })

  it('ignores empty labels', () => {
    const names = new Set<string>()
    collectNames(node('', [node('   '), node('Kept')]), names)
    expect([...names]).toEqual(['Kept'])
  })
})

describe('findFirstNew', () => {
  it('returns the first label missing from the known set (pre-order)', () => {
    const root = node('Root', [node('Old', [node('Old child')]), node('New', [node('New child')])])
    const found = findFirstNew(root, new Set(['Root', 'Old', 'Old child']), root)
    expect(found?.content).toBe('New')
  })

  it('never returns the root title', () => {
    const root = node('Fresh root')
    expect(findFirstNew(root, new Set(), root)).toBeNull()
  })

  it('returns null when everything is already known', () => {
    const root = node('Root', [node('A'), node('B')])
    expect(findFirstNew(root, new Set(['Root', 'A', 'B']), root)).toBeNull()
  })

  it('handles empty input', () => {
    expect(findFirstNew(null, new Set(), null)).toBeNull()
    expect(findFirstNew(node('Root', []), new Set(['Root']), undefined)).toBeNull()
  })
})

describe('collapseOlderBranches', () => {
  it('folds every branch except the newest keepLast', () => {
    const root = node('Root', [node('A'), node('B'), node('C'), node('D')])
    collapseOlderBranches(root, 2)
    expect(root.children?.map((child) => child.payload?.fold)).toEqual([1, 1, undefined, undefined])
  })

  it('does nothing when there are few branches', () => {
    const root = node('Root', [node('A'), node('B')])
    collapseOlderBranches(root, 3)
    expect(root.children?.every((child) => child.payload === undefined)).toBe(true)
  })

  it('keeps existing payload fields', () => {
    const root = node('Root', [node('A'), node('B')])
    root.children![0].payload = { color: 'red' }
    collapseOlderBranches(root, 1)
    expect(root.children![0].payload).toEqual({ color: 'red', fold: 1 })
  })

  it('tolerates a missing root', () => {
    expect(() => collapseOlderBranches(undefined, 1)).not.toThrow()
  })
})
