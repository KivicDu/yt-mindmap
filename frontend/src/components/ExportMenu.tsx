import { useEffect, useRef, useState } from 'react'
import type { ExportFormat } from '../lib/mapExport'

interface ExportMenuProps {
  onExport: (format: ExportFormat) => void
  disabled?: boolean
  busy?: ExportFormat | null
}

const ITEMS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: 'svg', label: 'SVG', hint: 'Sơ đồ vector, mở bằng trình duyệt hoặc công cụ thiết kế' },
  { format: 'png', label: 'PNG', hint: 'Ảnh để chia sẻ nhanh' },
  { format: 'markdown', label: 'Markdown', hint: 'Dàn ý để ghi chú hoặc in' },
]

function ExportMenu({ onExport, disabled, busy }: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="export-menu" ref={rootRef}>
      <button
        type="button"
        className="btn btn--outline btn--sm"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M10 3v9m0 0 3.4-3.4M10 12 6.6 8.6M4 14.5V16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {busy ? 'Đang xuất…' : 'Xuất'}
      </button>

      {open && (
        <div className="export-menu__panel" role="menu">
          {ITEMS.map((item) => (
            <button
              key={item.format}
              type="button"
              role="menuitem"
              className="export-menu__item"
              disabled={Boolean(busy)}
              onClick={() => {
                setOpen(false)
                onExport(item.format)
              }}
            >
              <span className="export-menu__label">{item.label}</span>
              <span className="export-menu__hint">{item.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default ExportMenu
