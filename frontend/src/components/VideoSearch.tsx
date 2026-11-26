import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  formatDuration,
  searchYouTube,
  type VideoSearchResult,
} from '../lib/youtubeSearch'
import './VideoSearch.css'

interface VideoSearchProps {
  /** Receives a canonical watch URL and starts loading it in the Workspace. */
  onPick: (url: string) => void
  disabled?: boolean
}

/**
 * ADR 0016: search → pick → study. The panel is a selection surface only; the
 * existing URL box stays as the fallback when search is not configured.
 */
export default function VideoSearch({ onPick, disabled = false }: VideoSearchProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [results, setResults] = useState<VideoSearchResult[]>([])
  const [nextPage, setNextPage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => () => abortRef.current?.abort(), [])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) {
      setError('')
      window.setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      abortRef.current?.abort()
      setLoading(false)
    }
  }

  const runSearch = async (term: string, pageToken?: string, append = false) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError('')
    try {
      const data = await searchYouTube(term, pageToken, controller.signal)
      if (controller.signal.aborted) return
      if (data.unavailable) {
        setResults([])
        setNextPage(null)
        setError(data.message ?? 'Tìm kiếm chưa sẵn sàng. Bạn vẫn có thể dán link YouTube.')
        return
      }
      setResults((current) => (append ? [...current, ...data.items] : data.items))
      setNextPage(data.next_page_token)
      setNotice(
        data.items.length === 0 && !append
          ? 'Không tìm thấy video. Thử từ khóa khác hoặc dán link YouTube.'
          : '',
      )
    } catch {
      if (!controller.signal.aborted) {
        setError('Không kết nối được với YouTube. Bạn vẫn có thể dán link video.')
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const term = query.trim()
    if (term.length < 2) {
      setError('Nhập ít nhất 2 ký tự để tìm video.')
      return
    }
    setSearchedQuery(term)
    setNotice('')
    void runSearch(term)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
      abortRef.current?.abort()
    }
  }

  const pick = (result: VideoSearchResult) => {
    onPick(result.url)
    setOpen(false)
    abortRef.current?.abort()
  }

  return (
    <div className="video-search" ref={wrapperRef} onKeyDown={onKeyDown}>
      <button
        className={`video-search__toggle${open ? ' is-open' : ''}`}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls="video-search-panel"
        onClick={toggle}
      >
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="8.6" cy="8.6" r="5.4" stroke="currentColor" strokeWidth="1.5" />
          <path d="m12.7 12.7 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span>Tìm video</span>
      </button>

      {open && (
        <section
          className="video-search__panel"
          id="video-search-panel"
          role="region"
          aria-label="Tìm video để học"
        >
          <form className="video-search__form" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor="video-search-query">
              Từ khóa video cần học
            </label>
            <input
              id="video-search-query"
              ref={inputRef}
              type="search"
              value={query}
              maxLength={100}
              placeholder="Tìm bài giảng, ví dụ: đạo hàm,React,nấu ăn…"
              onChange={(event) => setQuery(event.target.value)}
            />
            <button className="btn btn--primary btn--sm" type="submit" disabled={loading}>
              {loading ? 'Đang tìm…' : 'Tìm'}
            </button>
          </form>

          {error && <p className="video-search__error">{error}</p>}
          {notice && !error && <p className="video-search__notice">{notice}</p>}

          {results.length > 0 && (
            <ul className="video-search__results">
              {results.map((result) => (
                <li key={result.video_id}>
                  <button type="button" onClick={() => pick(result)}>
                    <span className="video-search__thumb" aria-hidden="true">
                      {result.thumbnail ? (
                        <img src={result.thumbnail} alt="" loading="lazy" />
                      ) : (
                        '▶'
                      )}
                    </span>
                    <span className="video-search__info">
                      <span className="video-search__title">{result.title}</span>
                      <span className="video-search__meta">
                        {result.channel}
                        {formatDuration(result.duration_seconds) &&
                          ` · ${formatDuration(result.duration_seconds)}`}
                      </span>
                      <span className="video-search__badges">
                        <span className={`video-search__topic video-search__topic--${result.topic_code}`}>
                          {result.topic_label}
                        </span>
                        <span
                          className={`video-search__fit video-search__fit--${result.fit}`}
                          title={result.fit_reason ?? undefined}
                        >
                          {result.fit_label}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {nextPage && !error && (
            <button
              className="video-search__more"
              type="button"
              disabled={loading}
              onClick={() => void runSearch(searchedQuery, nextPage, true)}
            >
              {loading ? 'Đang tải…' : 'Xem thêm video'}
            </button>
          )}

          <p className="video-search__hint">Bấm một video để mở và tải vào workspace.</p>
        </section>
      )}
    </div>
  )
}
