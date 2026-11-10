import { createContext } from 'react'

export type ToastTone = 'info' | 'success' | 'error'

export interface ToastAction {
  label: string
  /** Runs when the learner presses the action; the toast closes either way. */
  onClick: () => void | Promise<void>
}

export interface ToastOptions {
  message: string
  tone?: ToastTone
  action?: ToastAction
  /** Milliseconds before the toast disappears. Undo toasts get longer. */
  duration?: number
}

export interface ToastApi {
  show: (options: ToastOptions) => void
  /** Shorthand used after a delete: the toast offers a single undo action. */
  undo: (message: string, onUndo: () => void | Promise<void>) => void
}

export const ToastContext = createContext<ToastApi | null>(null)
