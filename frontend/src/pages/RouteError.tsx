import { Link, useRouteError } from 'react-router-dom'
import '../components/ErrorBoundary.css'

/** Rendered by the router when a route throws outside the React tree's boundary. */
function RouteError() {
  const error = useRouteError()
  console.error('Route error', error)

  return (
    <main className="route-error">
      <div className="route-error__card">
        <p className="route-error__eyebrow">Đã xảy ra lỗi</p>
        <h1>Không mở được trang này</h1>
        <p className="route-error__copy">
          Có thể đường dẫn không hợp lệ hoặc máy chủ đang tạm thời gặp sự cố. Hãy thử
          lại hoặc quay về trang chủ.
        </p>
        <div className="route-error__actions">
          <button
            className="route-error__primary"
            type="button"
            onClick={() => window.location.reload()}
          >
            Tải lại trang
          </button>
          <Link className="route-error__ghost" to="/">Về trang chủ</Link>
        </div>
      </div>
    </main>
  )
}

export default RouteError
