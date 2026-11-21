import { Suspense, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { applyRouteMetadata, getRouteMetadata } from '../lib/seo'
import './RootLayout.css'

function RootLayout() {
  const { pathname } = useLocation()

  useEffect(() => {
    applyRouteMetadata(getRouteMetadata(pathname), pathname)
  }, [pathname])

  return (
    <div className="root-layout">
      <Suspense fallback={<div className="route-loading" role="status">Đang mở trang…</div>}>
        <Outlet />
      </Suspense>
    </div>
  )
}

export default RootLayout
