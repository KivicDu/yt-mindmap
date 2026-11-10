export class PlaybackClock {
  private time = 0
  private readonly listeners = new Set<() => void>()

  getSnapshot = (): number => this.time

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  set(time: number, force = false): void {
    if (!Number.isFinite(time)) return
    if (!force && Math.floor(time) === Math.floor(this.time)) return
    this.time = time
    this.listeners.forEach((listener) => listener())
  }
}
