import { formatTime } from '../lib/mindmapTree'
import type { EmptyMinuteRange } from '../lib/coverage'
import './CoverageNotice.css'

interface CoverageNoticeProps {
  ranges: EmptyMinuteRange[]
  onSeek?: (seconds: number) => void
}

/** A navigation hint: where the timestamp index has no entry yet. */
export default function CoverageNotice({ ranges, onSeek }: CoverageNoticeProps) {
  if (ranges.length === 0) return null
  const total = ranges.reduce((sum, range) => sum + range.minutes, 0)

  return (
    <div className="coverage-notice" role="status">
      <span className="coverage-notice__label">Bản chỉ mục</span>
      <strong>{total} phút chưa có nhánh để nhảy tới</strong>
      <div className="coverage-notice__ranges">
        {ranges.slice(0, 4).map((range) => {
          const text = `${formatTime(range.start)}–${formatTime(range.end)}`
          return onSeek ? (
            <button
              key={range.start}
              type="button"
              className="coverage-notice__range"
              title={`Tua tới ${formatTime(range.start)}`}
              onClick={() => onSeek(range.start)}
            >
              {text}
            </button>
          ) : (
            <span key={range.start} className="coverage-notice__range">
              {text}
            </span>
          )
        })}
        {ranges.length > 4 && <span>… và {ranges.length - 4} đoạn khác</span>}
      </div>
      <p>Không có nhánh ở các đoạn này, nên bản đồ chưa tua video tới đó được.</p>
    </div>
  )
}
