import { Link } from 'react-router-dom'
import './NotFound.css'

function NotFound() {
  return (
    <main className="not-found">
      <div className="not-found__card">
        <p className="not-found__eyebrow">404</p>
        <h1>Trang này không tồn tại</h1>
        <p className="not-found__copy">
          Có thể liên kết đã cũ, hoặc địa chỉ bị gõ nhầm. Bạn có thể quay về trang chủ
          hoặc mở workspace để tiếp tục học.
        </p>
        <div className="not-found__actions">
          <Link className="not-found__primary" to="/">Về trang chủ</Link>
          <Link className="not-found__ghost" to="/app">Mở workspace</Link>
        </div>
      </div>
    </main>
  )
}

export default NotFound
