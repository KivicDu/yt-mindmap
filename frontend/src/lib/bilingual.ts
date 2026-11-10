export interface Cue {
  start: number
  duration: number
  text: string
}

/**
 * The line of a second caption track that is on screen at `seconds`.
 *
 * Tracks are timed independently, so a cue is matched by the last line that
 * has started rather than by index. Before the first cue the result is empty.
 */
export function cueTextAt(cues: Cue[], seconds: number): string {
  for (let index = cues.length - 1; index >= 0; index -= 1) {
    if (cues[index].start <= seconds) return cues[index].text
  }
  return ''
}
