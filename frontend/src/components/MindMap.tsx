import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { Transformer } from 'markmap-lib'
import { Markmap } from 'markmap-view'
import { collapseOlderBranches, collectNames, findFirstNew } from '../lib/mindmapTree'

const transformer = new Transformer()

const initialData = `
# Lecture Mind Map
## Waiting for video...
`

interface MindMapHandle {
  updateMarkdown: (markdown: string, options?: { focusNew?: boolean }) => void
  updateRoot: (data: any) => void
}

interface MindMapProps {
  onSeek?: (seconds: number) => void
  collapseOld?: boolean
}

const COLLAPSE_KEEP_LAST = 3

const MindMap = forwardRef<MindMapHandle, MindMapProps>(({ onSeek, collapseOld }, ref) => {
  const refSvg = useRef<SVGSVGElement>(null)
  const mm = useRef<Markmap | null>(null)
  const lastMarkdown = useRef(initialData)
  const knownNames = useRef(new Set<string>())
  const onSeekRef = useRef(onSeek)
  const collapseRef = useRef(Boolean(collapseOld))
  const highlightTimer = useRef<number | null>(null)
  const skipFirstCollapseEffect = useRef(true)

  useEffect(() => {
    onSeekRef.current = onSeek
  }, [onSeek])

  const render = async (markdown: string, focusNew: boolean) => {
    const instance = mm.current
    if (!instance) return

    lastMarkdown.current = markdown
    const { root } = transformer.transform(markdown)
    if (collapseRef.current) {
      collapseOlderBranches(root, COLLAPSE_KEEP_LAST)
    }

    const currentNames = new Set<string>()
    collectNames(root, currentNames)
    const previousNames = knownNames.current
    knownNames.current = currentNames

    await instance.setData(root as any)

    if (!focusNew || previousNames.size === 0) {
      await instance.fit()
      return
    }

    const target = findFirstNew(root, previousNames, root)
    if (!target) {
      await instance.fit()
      return
    }

    try {
      await instance.ensureVisible(target as any)
      await instance.setHighlight(target as any)
      if (highlightTimer.current) {
        window.clearTimeout(highlightTimer.current)
      }
      highlightTimer.current = window.setTimeout(() => {
        instance.setHighlight(null)
      }, 4000)
    } catch {
      await instance.fit()
    }
  }

  useEffect(() => {
    if (refSvg.current && !mm.current) {
      mm.current = Markmap.create(refSvg.current)
      render(initialData, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (skipFirstCollapseEffect.current) {
      skipFirstCollapseEffect.current = false
      return
    }
    collapseRef.current = Boolean(collapseOld)
    render(lastMarkdown.current, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseOld])

  useEffect(() => {
    const svg = refSvg.current
    if (!svg) return
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest?.('a')
      if (!anchor) return
      const href = anchor.getAttribute('href') || ''
      const match = href.match(/#seek-([\d.]+)/)
      if (!match) return
      event.preventDefault()
      event.stopPropagation()
      onSeekRef.current?.(parseFloat(match[1]))
    }
    svg.addEventListener('click', handleClick, true)
    return () => {
      svg.removeEventListener('click', handleClick, true)
    }
  }, [])

  const updateMarkdown = (markdown: string, options?: { focusNew?: boolean }) => {
    render(markdown, options?.focusNew !== false)
  }

  const updateRoot = (data: any) => {
    if (mm.current) {
      mm.current.setData(data)
      mm.current.fit()
    }
  }

  useImperativeHandle(ref, () => ({
    updateMarkdown,
    updateRoot
  }))

  return (
    <svg
      ref={refSvg}
      style={{ width: '100%', height: '100%' }}
    />
  )
})

MindMap.displayName = 'MindMap'

export default MindMap
export type { MindMapHandle }
