import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import './ErrorBoundary.css'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Last line of defence against a render crash: without it React unmounts the
 * whole tree and the visitor sees a blank page.
 */
class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="route-error">
        <div className="route-error__card">
          <p className="route-error__eyebrow">Đã xảy ra lỗi</p>
          <h1>Ứng dụng gặp sự cố</h1>
          <p className="route-error__copy">
            Trang này không hiển thị được. Dữ liệu đã lưu vẫn an toàn; hãy tải lại
            trang để tiếp tục.
          </p>
          <div className="route-error__actions">
            <button
              className="route-error__primary"
              type="button"
              onClick={() => window.location.reload()}
            >
              Tải lại trang
            </button>
            <a className="route-error__ghost" href="/">Về trang chủ</a>
          </div>
        </div>
      </main>
    )
  }
}

export default ErrorBoundary
