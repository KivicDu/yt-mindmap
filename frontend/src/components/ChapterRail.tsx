import { useSyncExternalStore } from 'react'
import { activeChapter, type Chapter } from '../lib/chapters'
import { formatTime } from '../lib/mindmapTree'
import type { PlaybackClock } from '../lib/playbackClock'

interface ChapterRailProps {
  chapters: Chapter[]
  clock: PlaybackClock
  onSeek: (seconds: number) => void
}

/**
 * The chapter rail is its own component so that following playback time only
 * re-renders the rail, not the whole workspace.
 */
export default function ChapterRail({ chapters, clock, onSeek }: ChapterRailProps) {
  const currentTime = useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot)
  const currentChapter = activeChapter(chapters, currentTime)

  return (
    <nav className="chapter-rail" aria-label="Chương theo chủ đề">
      <div className="chapter-rail__head">
        <span className="chapter-rail__title">Chương</span>
        <span className="chapter-rail__now">
          {currentChapter ? currentChapter.label : 'Chưa tới chương đầu'}
        </span>
      </div>
      <ol className="chapter-rail__list">
        {chapters.map((chapter) => {
          const isActive = currentChapter?.id === chapter.id
          return (
            <li key={chapter.id}>
              <button
                type="button"
                className={`chapter-rail__item${isActive ? ' is-active' : ''}`}
                aria-current={isActive ? 'true' : undefined}
                title={`Tua tới ${formatTime(chapter.start)}`}
                onClick={() => onSeek(chapter.start)}
              >
                <span className="chapter-rail__time">{formatTime(chapter.start)}</span>
                <span className="chapter-rail__label">{chapter.label}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
