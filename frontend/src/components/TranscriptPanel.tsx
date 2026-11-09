import { useEffect, useMemo, useRef, useState } from 'react'
import { formatTime } from '../lib/mindmapTree'
import type { TranscriptLanguage } from '../lib/youtube'

export interface TranscriptCue {
  start: number
  duration: number
  text: string
}

interface TranscriptPanelProps {
  entries: TranscriptCue[]
  currentTime: number
  onSeek: (seconds: number) => void
  language: string | null
  languages: TranscriptLanguage[]
  languagesLoading: boolean
  languagesError: string
  onLoadLanguages: () => void
  onSelectLanguage: (code: string) => void
  languageBusy: boolean
  canEdit: boolean
}

/** Diacritic-insensitive search: "tong quan" still finds "Tổng quan". */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
}

function activeCueIndex(entries: TranscriptCue[], time: number): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].start <= time) return index
  }
  return -1
}

function TranscriptPanel({
  entries,
  currentTime,
  onSeek,
  language,
  languages,
  languagesLoading,
  languagesError,
  onLoadLanguages,
  onSelectLanguage,
  languageBusy,
  canEdit,
}: TranscriptPanelProps) {
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLOListElement>(null)
  const activeIndex = activeCueIndex(entries, currentTime)

  const filtered = useMemo(() => {
    const needle = normalize(query.trim())
    const items = entries.map((entry, index) => ({ entry, index }))
    if (!needle) return items
    return items.filter(({ entry }) => normalize(entry.text).includes(needle))
  }, [entries, query])

  const searching = query.trim().length > 0

  // Follow the playhead, but never yank the list while the learner is reading
  // search results.
  useEffect(() => {
    if (searching) return
    const list = listRef.current
    if (!list || activeIndex < 0) return
    const item = list.querySelector<HTMLElement>(`[data-cue-index="${activeIndex}"]`)
    if (!item) return
    const top = item.offsetTop
    const bottom = top + item.offsetHeight
    if (top < list.scrollTop) {
      list.scrollTop = top
    } else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight
    }
  }, [activeIndex, searching, filtered.length])

  const currentName =
    languages.find((item) => item.code === language)?.name || language || 'Tự động'

  return (
    <div className="transcript">
      <div className="transcript__toolbar">
        <label className="transcript__search">
          <span className="sr-only">Tìm trong phụ đề</span>
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="5.2" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="m13 13 3.2 3.2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="search"
            value={query}
            placeholder="Tìm đoạn phụ đề…"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <label className="transcript__lang" title="Chọn ngôn ngữ phụ đề">
          <span className="sr-only">Ngôn ngữ phụ đề</span>
          <select
            value={language ?? ''}
            disabled={!canEdit || languageBusy || entries.length === 0}
            onFocus={onLoadLanguages}
            onMouseDown={onLoadLanguages}
            onChange={(event) => {
              const code = event.target.value
              if (code && code !== language) onSelectLanguage(code)
            }}
          >
            {!language && <option value="">Tự động</option>}
            {language && !languages.some((item) => item.code === language) && (
              <option value={language}>{currentName}</option>
            )}
            {languages.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
                {item.generated ? ' (tự động)' : ''}
              </option>
            ))}
            {languagesLoading && <option value="">Đang tải…</option>}
          </select>
        </label>
      </div>

      {languagesError && (
        <p className="transcript__error" role="alert">
          {languagesError}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="transcript__empty">
          Chưa có phụ đề cho video này. Tải file .srt/.vtt hoặc chọn video khác.
        </p>
      ) : filtered.length === 0 ? (
        <p className="transcript__empty">Không tìm thấy đoạn nào khớp “{query.trim()}”.</p>
      ) : (
        <ol className="transcript__list" ref={listRef}>
          {filtered.map(({ entry, index }) => {
            const active = index === activeIndex
            return (
              <li key={`${entry.start}-${index}`}>
                <button
                  type="button"
                  className={`transcript__cue${active ? ' is-active' : ''}`}
                  data-cue-index={index}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onSeek(entry.start)}
                >
                  <span className="transcript__time">{formatTime(entry.start)}</span>
                  <span className="transcript__text">{entry.text}</span>
                </button>
              </li>
            )
          })}
        </ol>
      )}

      {entries.length > 0 && (
        <p className="transcript__meta">
          {searching
            ? `${filtered.length} / ${entries.length} đoạn khớp`
            : `${entries.length} đoạn · ${currentName}`}
        </p>
      )}
    </div>
  )
}

export default TranscriptPanel
