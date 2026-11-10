import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  MAP_LAYOUTS,
  MAP_PALETTES,
  paletteDef,
  type MapLayout,
  type MapStyle,
} from '../lib/mapStyle'
import './MapStyleDialog.css'

interface MapStyleDialogProps {
  open: boolean
  initial: MapStyle
  /** Shown above the two choices; differs between "new project" and "change". */
  title?: string
  confirmLabel?: string
  onClose: () => void
  onConfirm: (style: MapStyle) => void
}

/** A miniature of the map, drawn with the palette the learner just picked. */
function LayoutPreview({ layout, colors }: { layout: MapLayout; colors: readonly string[] }) {
  const [a, b, c] = [colors[0], colors[1], colors[2]]

  if (layout === 'tree') {
    const rows = [
      { y: 18, color: a },
      { y: 38, color: b },
      { y: 58, color: c },
    ]
    return (
      <svg className="mstyle-preview" viewBox="0 0 120 76" aria-hidden="true">
        {rows.map((row) => (
          <g key={row.y}>
            <path d={`M 24 38 C 46 38 48 ${row.y} 66 ${row.y}`} fill="none" stroke={row.color} strokeWidth="1.6" opacity="0.7" />
            <path d={`M 66 ${row.y} C 78 ${row.y} 80 ${row.y + 7} 92 ${row.y + 7}`} fill="none" stroke={row.color} strokeWidth="1.2" opacity="0.5" />
            <circle cx="68" cy={row.y} r="4.5" fill={row.color} opacity="0.9" />
            <circle cx="96" cy={row.y + 7} r="3" fill={row.color} opacity="0.55" />
          </g>
        ))}
        <circle cx="20" cy="38" r="7" fill={a} />
      </svg>
    )
  }

  if (layout === 'spider') {
    const spokes = [0, 1, 2, 3, 4, 5]
    return (
      <svg className="mstyle-preview" viewBox="0 0 120 76" aria-hidden="true">
        {spokes.map((index) => {
          const angle = (index / spokes.length) * Math.PI * 2 - Math.PI / 2
          const color = colors[index % colors.length]
          const x = 60 + Math.cos(angle) * 27
          const y = 38 + Math.sin(angle) * 27
          return (
            <g key={index}>
              <path d={`M 60 38 L ${x} ${y}`} stroke={color} strokeWidth="1.5" opacity="0.6" />
              <circle cx={x} cy={y} r="4" fill={color} />
            </g>
          )
        })}
        <circle cx="60" cy="38" r="8" fill={a} />
      </svg>
    )
  }

  if (layout === 'bubble') {
    return (
      <svg className="mstyle-preview" viewBox="0 0 120 76" aria-hidden="true">
        <circle cx="60" cy="38" r="10" fill={a} />
        {[0, 1, 2].map((index) => {
          const angle = (index / 3) * Math.PI * 2 - Math.PI / 2
          const color = colors[(index + 1) % colors.length]
          const cx = 60 + Math.cos(angle) * 26
          const cy = 38 + Math.sin(angle) * 22
          return (
            <g key={index}>
              <path d={`M 60 38 L ${cx} ${cy}`} stroke={color} strokeWidth="1.4" opacity="0.5" />
              <circle cx={cx} cy={cy} r="7.5" fill={color} opacity="0.9" />
              <circle cx={cx + Math.cos(angle) * 12} cy={cy + Math.sin(angle) * 10} r="3" fill={color} opacity="0.6" />
              <circle cx={cx + Math.cos(angle + 1.1) * 12} cy={cy + Math.sin(angle + 1.1) * 10} r="2.5" fill={color} opacity="0.5" />
            </g>
          )
        })}
      </svg>
    )
  }

  return (
    <svg className="mstyle-preview" viewBox="0 0 120 76" aria-hidden="true">
      <circle cx="60" cy="38" r="30" fill="none" stroke="var(--line-2)" strokeWidth="1" strokeDasharray="3 5" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => {
        const angle = (index / 8) * Math.PI * 2 - Math.PI / 2
        const color = colors[index % colors.length]
        return (
          <circle
            key={index}
            cx={60 + Math.cos(angle) * 30}
            cy={38 + Math.sin(angle) * 30}
            r="4"
            fill={color}
          />
        )
      })}
      <circle cx="60" cy="38" r="9" fill={a} />
    </svg>
  )
}

/**
 * The "choose a look" step before a map is created.
 *
 * It is a modal rather than a page because the choice is small, reversible and
 * belongs to the same moment as "new project". Escape and the backdrop close
 * it without changing anything; the confirm button is the only commit.
 */
export default function MapStyleDialog({
  open,
  initial,
  title = 'Chọn kiểu sơ đồ',
  confirmLabel = 'Dùng kiểu này',
  onClose,
  onConfirm,
}: MapStyleDialogProps) {
  const [draft, setDraft] = useState<MapStyle>(initial)
  const panelRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const restoreRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return
    setDraft(initial)
    restoreRef.current = document.activeElement
    confirmRef.current?.focus()
    return () => {
      const previous = restoreRef.current
      if (previous instanceof HTMLElement) previous.focus()
    }
    // Reopening should always start from what is currently applied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

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

  const colors = paletteDef(draft.palette).branches
  const layoutDef = MAP_LAYOUTS.find((item) => item.id === draft.layout) ?? MAP_LAYOUTS[0]

  return (
    <div className="mstyle-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="mstyle-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mstyle-title"
        ref={panelRef}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header className="mstyle-head">
          <div>
            <span className="mstyle-eyebrow">Trước khi bắt đầu</span>
            <h2 id="mstyle-title">{title}</h2>
            <p className="mstyle-lede">
              Nội dung bài giảng không đổi — chỉ cách bày biện thay đổi. Bạn có thể đổi lại bất cứ lúc nào.
            </p>
          </div>
          <button className="mstyle-close" type="button" onClick={onClose} aria-label="Đóng">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <section className="mstyle-section">
          <h3 className="mstyle-section-title">Bảng màu</h3>
          <div className="mstyle-palettes" role="radiogroup" aria-label="Bảng màu">
            {MAP_PALETTES.map((palette) => {
              const active = draft.palette === palette.id
              return (
                <button
                  key={palette.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`mstyle-palette${active ? ' is-active' : ''}`}
                  onClick={() => setDraft((current) => ({ ...current, palette: palette.id }))}
                >
                  <span className="mstyle-swatches" aria-hidden="true">
                    {palette.branches.map((color) => (
                      <span key={color} style={{ background: color }} />
                    ))}
                  </span>
                  <span className="mstyle-palette-name">{palette.name}</span>
                  <span className="mstyle-palette-hint">{palette.hint}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="mstyle-section">
          <h3 className="mstyle-section-title">Kiểu sơ đồ</h3>
          <div className="mstyle-layouts" role="radiogroup" aria-label="Kiểu sơ đồ">
            {MAP_LAYOUTS.map((layout) => {
              const active = draft.layout === layout.id
              return (
                <button
                  key={layout.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`mstyle-layout${active ? ' is-active' : ''}`}
                  onClick={() => setDraft((current) => ({ ...current, layout: layout.id }))}
                >
                  <LayoutPreview layout={layout.id} colors={colors} />
                  <span className="mstyle-layout-name">{layout.name}</span>
                  <span className="mstyle-layout-hint">{layout.hint}</span>
                </button>
              )
            })}
          </div>
        </section>

        <footer className="mstyle-foot">
          <span className="mstyle-summary">
            {layoutDef.name} · {paletteDef(draft.palette).name}
          </span>
          <div className="mstyle-actions">
            <button className="mstyle-ghost" type="button" onClick={onClose}>
              Để sau
            </button>
            <button
              className="mstyle-confirm"
              type="button"
              ref={confirmRef}
              onClick={() => onConfirm(draft)}
            >
              {confirmLabel}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
