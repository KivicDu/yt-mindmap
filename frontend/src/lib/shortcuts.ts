/**
 * Keyboard shortcuts for the workspace.
 *
 * The map is the point of the page, so shortcuts stay out of the way: they are
 * single letters, never fire while the learner is typing, and ignore modifier
 * combos so browser shortcuts keep working.
 */

export type ShortcutAction =
  | 'toggle-help'
  | 'escape'
  | 'toggle-play'
  | 'seek-back'
  | 'seek-forward'
  | 'tab-session'
  | 'tab-transcript'
  | 'tab-history'
  | 'fit-map'

export interface ShortcutDefinition {
  /** Keys shown in the help dialog. */
  keys: string
  label: string
  action: ShortcutAction
}

/** The dialog lists these in the order they matter to a learner. */
export const SHORTCUTS: ShortcutDefinition[] = [
  { keys: 'K', label: 'Phát hoặc tạm dừng video', action: 'toggle-play' },
  { keys: 'J / L', label: 'Tua lùi hoặc tiến 5 giây', action: 'seek-back' },
  { keys: 'S', label: 'Mở tab Phiên học', action: 'tab-session' },
  { keys: 'T', label: 'Mở tab Phụ đề', action: 'tab-transcript' },
  { keys: 'H', label: 'Mở tab Lịch sử', action: 'tab-history' },
  { keys: 'F', label: 'Thu sơ đồ vừa khung', action: 'fit-map' },
  { keys: 'Esc', label: 'Đóng trình chỉnh sửa hoặc hộp thoại', action: 'escape' },
  { keys: '?', label: 'Mở danh sách phím tắt', action: 'toggle-help' },
]

/** True when a keystroke belongs to a field, not to the page. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.tagName !== 'string') return false
  const tag = element.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    element.isContentEditable === true
  )
}

/**
 * Map a keydown event to an action.
 *
 * `hasHistory` is false for drafts and read-only views, where the history tab
 * does not exist, so `h` should not silently do nothing.
 */
export function shortcutFor(
  event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
  options: { typing: boolean; hasHistory: boolean },
): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null

  // Escape closes whatever is open, even from inside a text field.
  if (event.key === 'Escape') return 'escape'
  if (options.typing) return null

  switch (event.key) {
    case '?':
      return 'toggle-help'
    case 'k':
    case 'K':
      return 'toggle-play'
    case 'j':
    case 'J':
      return 'seek-back'
    case 'l':
    case 'L':
      return 'seek-forward'
    case 's':
    case 'S':
      return 'tab-session'
    case 't':
    case 'T':
      return 'tab-transcript'
    case 'h':
    case 'H':
      return options.hasHistory ? 'tab-history' : null
    case 'f':
    case 'F':
      return 'fit-map'
    default:
      return null
  }
}
