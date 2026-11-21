import { useSyncExternalStore } from 'react'
import { formatTime } from '../lib/mindmapTree'
import type { PlaybackClock } from '../lib/playbackClock'

function usePlaybackTime(clock: PlaybackClock): number {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot)
}

export function PlaybackTime({
  clock,
  className,
}: {
  clock: PlaybackClock
  className?: string
}) {
  const time = usePlaybackTime(clock)
  return <span className={className}>{formatTime(time)}</span>
}

export function PlaybackProgress({
  clock,
  totalSeconds,
}: {
  clock: PlaybackClock
  totalSeconds: number
}) {
  const time = usePlaybackTime(clock)
  const progress = totalSeconds > 0 ? Math.min(100, (time / totalSeconds) * 100) : 0
  return <span className="player__track-fill" style={{ width: `${progress}%` }} />
}
