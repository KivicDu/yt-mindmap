import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ToastContext,
  type ToastApi,
  type ToastOptions,
  type ToastTone,
} from './toast'
import './Toast.css'

interface ToastRecord extends ToastOptions {
  id: number
  tone: ToastTone
  duration: number
}

const DEFAULT_DURATION = 5000
const UNDO_DURATION = 9000
const MAX_VISIBLE = 3

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastRecord
  onDismiss: (id: number) => void
}) {
  const [paused, setPaused] = useState(false)
  const remaining = useRef(toast.duration)

  useEffect(() => {
    if (paused) return
    const startedAt = Date.now()
    const timer = setTimeout(() => onDismiss(toast.id), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt))
    }
  }, [paused, toast.id, onDismiss])

  const runAction = async () => {
    try {
      await toast.action?.onClick()
    } finally {
      onDismiss(toast.id)
    }
  }

  return (
    <div
      className={`toast toast--${toast.tone}`}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast__dot" aria-hidden="true" />
      <p className="toast__message">{toast.message}</p>
      {toast.action && (
        <button className="toast__action" type="button" onClick={() => void runAction()}>
          {toast.action.label}
        </button>
      )}
      <button
        className="toast__close"
        type="button"
        aria-label="Đóng thông báo"
        onClick={() => onDismiss(toast.id)}
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback((options: ToastOptions) => {
    const record: ToastRecord = {
      ...options,
      id: nextId.current++,
      tone: options.tone ?? 'info',
      duration: options.duration ?? DEFAULT_DURATION,
    }
    // Keep the newest toasts and never stack more than three.
    setToasts((current) => [...current, record].slice(-MAX_VISIBLE))
  }, [])

  const undo = useCallback(
    (message: string, onUndo: () => void | Promise<void>) => {
      show({
        message,
        tone: 'info',
        duration: UNDO_DURATION,
        action: { label: 'Hoàn tác', onClick: onUndo },
      })
    },
    [show],
  )

  const api = useMemo<ToastApi>(() => ({ show, undo }), [show, undo])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
