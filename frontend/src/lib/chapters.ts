import { cleanLabel, type MapNode } from './mindmapTree'

export interface Chapter {
  id: string
  label: string
  /** Seconds into the video where the topic starts. */
  start: number
  /** Where the next chapter starts, or null for the last one. */
  end: number | null
  /** How many map nodes sit under this topic. */
  nodeCount: number
}

function timed(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function countBranch(node: MapNode): number {
  return 1 + (node.children ?? []).reduce((total, child) => total + countBranch(child), 0)
}

/**
 * Chapters are the map's top-level topics, in the order they were discussed.
 * A topic without a timestamp cannot anchor a chapter, so it is skipped; when
 * fewer than two topics are timed, the map simply has no timeline yet.
 */
export function buildChapters(nodes: MapNode[]): Chapter[] {
  const anchors = nodes
    .filter((node) => timed(node.time))
    .map((node) => ({
      id: node.id,
      label: cleanLabel(node.label) || 'Chủ đề',
      start: node.time as number,
      nodeCount: countBranch(node),
    }))
    .sort((a, b) => a.start - b.start)

  // Two topics can share a timestamp; keep the first and drop the duplicate
  // so the rail does not show two chapters that start at the same second.
  const unique = anchors.filter(
    (chapter, index) => index === 0 || chapter.start !== anchors[index - 1].start,
  )

  if (unique.length < 2) return []

  return unique.map((chapter, index) => ({
    ...chapter,
    end: unique[index + 1]?.start ?? null,
  }))
}

/** The chapter that contains `seconds`, or null before the first one. */
export function activeChapter(chapters: Chapter[], seconds: number): Chapter | null {
  let current: Chapter | null = null
  for (const chapter of chapters) {
    if (chapter.start <= seconds) current = chapter
    else break
  }
  return current
}
