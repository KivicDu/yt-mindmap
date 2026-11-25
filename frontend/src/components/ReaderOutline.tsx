import type { CSSProperties } from 'react'
import { formatTime } from '../lib/mindmapTree'
import { parseStudyOutline } from '../lib/mapExport'
import './ReaderOutline.css'

interface ReaderOutlineProps {
  /** The same markdown the export menu downloads. */
  markdown: string
  onSeek?: (seconds: number) => void
}

/**
 * A linear study view for someone who did not build the map: every idea, its
 * timestamp and its notes, in reading order. It is deliberately not a second
 * editor — clicking a timestamp only moves the player.
 */
export default function ReaderOutline({ markdown, onSeek }: ReaderOutlineProps) {
  const items = parseStudyOutline(markdown)
  if (items.length === 0) {
    return <p className="reader-outline__empty">Chủ dự án chưa thêm ý nào.</p>
  }

  return (
    <ol className="reader-outline__list">
      {items.map((item, index) => (
        <li
          key={`${index}-${item.label}`}
          style={{ '--outline-depth': item.depth } as CSSProperties}
        >
          <div className="reader-outline__row">
            {item.seconds !== null && onSeek ? (
              <button
                type="button"
                className="reader-outline__stamp"
                title={`Tua tới ${formatTime(item.seconds)}`}
                onClick={() => onSeek(item.seconds as number)}
              >
                {formatTime(item.seconds)}
              </button>
            ) : item.seconds !== null ? (
              <span className="reader-outline__stamp">{formatTime(item.seconds)}</span>
            ) : null}
            <span className="reader-outline__label">{item.label}</span>
          </div>
          {item.notes.length > 0 && (
            <p className="reader-outline__notes">{item.notes.join(' · ')}</p>
          )}
        </li>
      ))}
    </ol>
  )
}
