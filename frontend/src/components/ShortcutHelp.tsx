import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { SHORTCUTS } from '../lib/shortcuts'
import './ShortcutHelp.css'

/**
 * A quiet cheat sheet for the workspace keys. It behaves like a modal dialog:
 * focus moves inside, Tab stays there, and Escape or the backdrop closes it.
 */
export default function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreRef = useRef<Element | null>(null)

  useEffect(() => {
    restoreRef.current = document.activeElement
    closeRef.current?.focus()
    return () => {
      const previous = restoreRef.current
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="shortcut-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="shortcut-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-title"
        ref={panelRef}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header className="shortcut-dialog__head">
          <div>
            <span className="shortcut-dialog__eyebrow">Bàn phím</span>
            <h2 id="shortcut-title">Phím tắt</h2>
          </div>
          <button
            className="shortcut-dialog__close"
            type="button"
            ref={closeRef}
            aria-label="Đóng danh sách phím tắt"
            onClick={onClose}
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="m5.5 5.5 9 9m0-9-9 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <dl className="shortcut-list">
          {SHORTCUTS.map((shortcut) => (
            <div className="shortcut-row" key={shortcut.action}>
              <dt>
                {shortcut.keys.split(' / ').map((key) => (
                  <kbd className="shortcut-key" key={key}>
                    {key}
                  </kbd>
                ))}
              </dt>
              <dd>{shortcut.label}</dd>
            </div>
          ))}
        </dl>

        <p className="shortcut-dialog__note">
          Phím tắt không hoạt động khi bạn đang gõ trong ô nhập, để không cắt ngang ghi chú.
        </p>
      </div>
    </div>
  )
}
