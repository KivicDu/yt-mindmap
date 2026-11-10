export interface RouteMetadata {
  title: string
  description: string
  robots: 'index,follow' | 'noindex,nofollow'
  canonical?: boolean
  socialUrl?: boolean
}

const HOME_DESCRIPTION =
  'Dán link YouTube, nhận sơ đồ tư duy được xây dựng theo trình tự bài giảng. Click vào từng nhánh để tua thẳng tới đúng đoạn cần xem lại.'

const routeMetadata: Record<string, RouteMetadata> = {
  '/': {
    title: 'yt-mindmap — biến video YouTube thành sơ đồ tư duy để ôn tập',
    description: HOME_DESCRIPTION,
    robots: 'index,follow',
    canonical: true,
  },
  '/privacy': {
    title: 'Quyền riêng tư | yt-mindmap',
    description: 'Tìm hiểu cách yt-mindmap xử lý và bảo vệ dữ liệu của bạn.',
    robots: 'index,follow',
    canonical: true,
  },
  '/terms': {
    title: 'Điều khoản sử dụng | yt-mindmap',
    description: 'Điều khoản sử dụng dịch vụ yt-mindmap.',
    robots: 'index,follow',
    canonical: true,
  },
  '/contact': {
    title: 'Liên hệ | yt-mindmap',
    description: 'Thông tin liên hệ và hỗ trợ cho người dùng yt-mindmap.',
    robots: 'index,follow',
    canonical: true,
  },
}

const privateRoutes: Record<string, string> = {
  '/app': 'Không gian học tập | yt-mindmap',
  '/dashboard': 'Dashboard | yt-mindmap',
  '/login': 'Đăng nhập | yt-mindmap',
  '/register': 'Tạo tài khoản | yt-mindmap',
  '/verify-email': 'Xác minh email | yt-mindmap',
  '/confirm-email-change': 'Xác nhận đổi email | yt-mindmap',
  '/forgot-password': 'Quên mật khẩu | yt-mindmap',
  '/reset-password': 'Đặt lại mật khẩu | yt-mindmap',
}

export function getRouteMetadata(pathname: string): RouteMetadata {
  const path = pathname.replace(/\/+$/, '') || '/'
  const known = routeMetadata[path]
  if (known) return known

  if (/^\/s\/[^/]+$/i.test(path)) {
    return {
      title: 'Sơ đồ tư duy được chia sẻ | yt-mindmap',
      description: 'Xem sơ đồ tư duy và nội dung học tập được chia sẻ bằng yt-mindmap.',
      robots: 'noindex,nofollow',
      socialUrl: true,
    }
  }

  if (path === '/app' || /^\/app\/[^/]+$/.test(path)) {
    return {
      title: privateRoutes['/app'],
      description: 'Không gian làm việc cá nhân trên yt-mindmap.',
      robots: 'noindex,nofollow',
    }
  }

  const title = privateRoutes[path]
  if (title) {
    return {
      title,
      description: 'Tài khoản yt-mindmap.',
      robots: 'noindex,nofollow',
    }
  }

  return {
    title: 'Không tìm thấy trang | yt-mindmap',
    description: 'Trang bạn tìm không tồn tại.',
    robots: 'noindex,nofollow',
  }
}

function setMeta(selector: string, attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }
  element.content = content
}

export function applyRouteMetadata(metadata: RouteMetadata, pathname: string): void {
  const canonicalPath = pathname.replace(/\/+$/, '') || '/'
  document.title = metadata.title
  setMeta('meta[name="description"]', 'name', 'description', metadata.description)
  setMeta('meta[name="robots"]', 'name', 'robots', metadata.robots)
  setMeta('meta[property="og:title"]', 'property', 'og:title', metadata.title)
  setMeta('meta[property="og:description"]', 'property', 'og:description', metadata.description)

  const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (metadata.canonical) {
    const link = canonical ?? document.createElement('link')
    link.rel = 'canonical'
    link.href = new URL(canonicalPath, window.location.origin).href
    if (!canonical) document.head.appendChild(link)
  } else {
    canonical?.remove()
  }

  const socialUrl = document.head.querySelector<HTMLMetaElement>('meta[property="og:url"]')
  if (metadata.canonical || metadata.socialUrl) {
    setMeta(
      'meta[property="og:url"]',
      'property',
      'og:url',
      new URL(canonicalPath, window.location.origin).href,
    )
  } else {
    socialUrl?.remove()
  }
}
