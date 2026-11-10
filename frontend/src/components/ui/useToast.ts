import { useContext } from 'react'
import { ToastContext, type ToastApi } from './toast'

/** Show a transient message, optionally with an undo action. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast must be used inside <ToastProvider>')
  return api
}
