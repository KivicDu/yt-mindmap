import { Link } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import ThemeToggle from '../../components/ThemeToggle'
import { useAuth } from '../../context/AuthContext'
import './Home.css'

function Home() {
  const { status } = useAuth()
  const authed = status === 'authenticated'
  const homeRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const home = homeRef.current
    if (!home || !('IntersectionObserver' in window)) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const revealTargets = home.querySelectorAll<HTMLElement>('[data-reveal]')
    if (revealTargets.length === 0) return

    home.classList.add('home-motion-ready')

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          entry.target.classList.add('is-revealed')
          observer.unobserve(entry.target)
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -32px 0px' },
    )

    revealTargets.forEach((target) => observer.observe(target))

    return () => {
      observer.disconnect()
      home.classList.remove('home-motion-ready')
    }
  }, [])

  return (
    <main className="home" ref={homeRef}>
      <header className="home-header">
        <Link className="home-brand" to="/">
          <img className="home-brand__mark" src="/yt-mindmap-icon.png" alt="" aria-hidden="true" />
          <span>yt-mindmap</span>
        </Link>
        <nav className="home-nav" aria-label="Chính">
          <a className="home-nav-link" href="#how-it-works">Cách hoạt động</a>
          <a className="home-nav-link" href="#features">Tính năng</a>
          {authed ? (
            <Link className="home-header-cta" to="/dashboard">Vào dashboard</Link>
          ) : (
            <>
              <Link className="home-nav-link" to="/login">Đăng nhập</Link>
              <Link className="home-header-cta" to="/register">Bắt đầu miễn phí</Link>
            </>
          )}
          <ThemeToggle />
        </nav>
      </header>

      <section className="home-hero">
        <div className="home-hero-content">
          <span className="home-eyebrow">Dành cho sinh viên & người tự học</span>
          <h1>Học từ video, ôn lại bằng sơ đồ tư duy</h1>
          <p>
            yt-mindmap sắp xếp nội dung bài giảng thành sơ đồ có gắn mốc thời gian. Khi cần ôn lại, chọn một nhánh để
            quay về đúng đoạn video — không phải tua đi tua lại từ đầu.
          </p>
          <p className="home-hero-subtle">Mỗi ý chính đều dẫn về đúng đoạn bài giảng.</p>
          <div className="home-actions">
            <Link className="home-cta-primary" to={authed ? '/dashboard' : '/register'}>
              {authed ? 'Mở dashboard →' : 'Tạo tài khoản miễn phí →'}
            </Link>
            <Link className="home-cta-ghost" to="/app">Dùng thử không cần tài khoản</Link>
          </div>
        </div>
        <div className="home-hero-visual">
          {/* TODO: Thay thế bằng ảnh thật khi workspace hoàn thiện */}
          <div
            className="home-mockup"
            role="img"
            aria-label="Minh họa workspace: video bài giảng bên trái, sơ đồ tư duy có mốc thời gian bên phải"
          >
            <div className="home-mockup-header">
              <div className="home-mockup-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="home-mockup-url">Không gian học tập</div>
            </div>
            <div className="home-mockup-body">
              <div className="home-mockup-panel">
                <div className="home-mockup-panel-heading">
                  <span className="home-mockup-live" />
                  <span>BÀI GIẢNG</span>
                  <span className="home-mockup-duration">18:42</span>
                </div>
                <div className="home-mockup-video-block" aria-hidden="true">
                  <span className="home-mockup-play">▶</span>
                  <span className="home-mockup-video-caption">Cấu trúc tế bào</span>
                </div>
                <div className="home-mockup-timeline" aria-hidden="true">
                  <span />
                </div>
                <div className="home-mockup-video-meta">Đang học <strong>06:18</strong></div>
              </div>
              <div className="home-mockup-panel home-mockup-map">
                <div className="home-mockup-panel-heading">
                  <span>SƠ ĐỒ TƯ DUY</span>
                  <span className="home-mockup-map-count">5 ý chính</span>
                </div>
                <div className="home-mockup-tree">
                  <div className="home-mockup-node home-mockup-node-root">
                    <span className="home-mockup-node-dot" />
                    Cấu trúc tế bào
                  </div>
                  <div className="home-mockup-branch">
                    <div className="home-mockup-node home-mockup-node-active">
                      <span className="home-mockup-node-dot" />
                      Màng sinh chất <small>06:18</small>
                    </div>
                    <div className="home-mockup-node">
                      <span className="home-mockup-node-dot" />
                      Lớp phospholipid
                    </div>
                  </div>
                  <div className="home-mockup-branch">
                    <div className="home-mockup-node">
                      <span className="home-mockup-node-dot" />
                      Nhân tế bào
                    </div>
                    <div className="home-mockup-node">
                      <span className="home-mockup-node-dot" />
                      Ti thể
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/*
            KHI SẴN SÀNG: Xóa block .home-mockup--placeholder bên trên và dùng block bên dưới
            <img
              className="home-mockup-real"
              src="/app-preview.webp"
              alt="Giao diện yt-mindmap: video YouTube bên trái, sơ đồ tư duy tự động bên phải với các node có timestamp"
              loading="lazy"
            />
          */}
        </div>
      </section>

      <section className="home-problem">
        <div className="home-section-header" data-reveal>
          <span className="home-eyebrow">Vấn đề thường gặp</span>
          <h2>Mỗi lần ôn bài với video dài đều gây khó khăn</h2>
          <p>Đây chính là lý do sinh viên, người tự học mất nhiều thời gian hơn cần thiết</p>
        </div>
        <div className="home-problem-grid">
          <article className="home-problem-card" data-reveal>
            <div className="home-problem-card-header">
              <span className="home-problem-card-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </span>
              <h3>Tua đi tua lại</h3>
            </div>
            <p>Mất hàng chục phút chỉ để tìm lại một khái niệm quan trọng trong video hàng giờ.</p>
          </article>
          <article className="home-problem-card" data-reveal>
            <div className="home-problem-card-header">
              <span className="home-problem-card-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 6h13" />
                  <path d="M8 12h13" />
                  <path d="M8 18h13" />
                  <path d="M3 6h.01" />
                  <path d="M3 12h.01" />
                  <path d="M3 18h.01" />
                </svg>
              </span>
              <h3>Không nắm cấu trúc</h3>
            </div>
            <p>Khó hình dung tổng quan bài giảng, dễ mất phương hướng khi ôn tập.</p>
          </article>
          <article className="home-problem-card" data-reveal>
            <div className="home-problem-card-header">
              <span className="home-problem-card-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
                  <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
                </svg>
              </span>
              <h3>Ghi nhớ kém</h3>
            </div>
            <p>Xem thụ động mà không hệ thống lại nội dung khiến kiến thức nhanh quên.</p>
          </article>
        </div>
        <div className="home-problem-solution" data-reveal>
          <p>
            <strong>Giải pháp:</strong> Biến video thành sơ đồ tư duy có cấu trúc rõ ràng, click để tua đúng chỗ cần xem lại.
          </p>
        </div>
      </section>

      <section className="home-steps" id="how-it-works">
        <div className="home-section-header home-section-header--left" data-reveal>
          <span className="home-eyebrow">Cách hoạt động</span>
          <h2>Chỉ 3 bước để có mindmap</h2>
          <p>Nhanh chóng, không cần đăng ký</p>
        </div>
        <div className="home-steps-list">
          <article className="home-step-item" data-reveal>
            <span className="home-step-index">01</span>
            <div className="home-step-content">
              <h3>Dán link YouTube</h3>
              <p>Sao chép URL bài giảng, video học tập hoặc khóa học bạn muốn tóm tắt.</p>
            </div>
          </article>
          <article className="home-step-item" data-reveal>
            <span className="home-step-index">02</span>
            <div className="home-step-content">
              <h3>Tạo sơ đồ theo bài giảng</h3>
              <p>Hệ thống phân tích phụ đề và xây dựng sơ đồ tư duy theo trình tự bài giảng.</p>
            </div>
          </article>
          <article className="home-step-item" data-reveal>
            <span className="home-step-index">03</span>
            <div className="home-step-content">
              <h3>Click để tua & ôn tập</h3>
              <p>Click vào bất kỳ nhánh nào để nhảy đến đúng thời điểm, thêm ghi chú và ghi nhớ hiệu quả hơn.</p>
            </div>
          </article>
        </div>
      </section>

      <section className="home-product" aria-labelledby="home-product-title">
        <div className="home-section-header home-section-header--left" data-reveal>
          <span className="home-eyebrow">Bên trong không gian học</span>
          <h2 id="home-product-title">Video, sơ đồ và ghi chú — cùng ở một nơi.</h2>
          <p>
            Không phải đổi qua lại giữa nhiều tab để vừa nghe bài, vừa ghi nhớ nội dung. Mỗi phần của buổi học được đặt
            cạnh nhau để bạn luôn giữ được ngữ cảnh.
          </p>
        </div>

        <div
          className="home-product-preview"
          role="img"
          aria-label="Minh họa không gian học gồm video bài giảng, sơ đồ có mốc thời gian và ghi chú cho nhánh đang chọn"
          data-reveal
        >
          <div className="home-product-toolbar">
            <div className="home-product-crumb">
              <span className="home-product-crumb-mark" aria-hidden="true">Y</span>
              <span>Phiên học</span>
              <span className="home-product-crumb-separator">/</span>
              <strong>Cấu trúc tế bào</strong>
            </div>
            <span className="home-product-status"><i /> Đang theo dõi bài giảng</span>
          </div>

          <div className="home-product-panels">
            <section className="home-product-panel home-product-video">
              <div className="home-product-panel-head">
                <span>Video bài giảng</span>
                <span className="home-product-duration">18:42</span>
              </div>
              <div className="home-product-screen">
                <span className="home-product-screen-play" aria-hidden="true">▶</span>
                <span className="home-product-screen-caption">Cấu trúc tế bào</span>
              </div>
              <div className="home-product-player-controls">
                <span>06:18</span>
                <span className="home-product-track"><i /></span>
                <span>18:42</span>
              </div>
              <div className="home-product-transcript">
                <span className="home-product-transcript-time">ĐANG HỌC</span>
                <p>Chọn một mốc trong sơ đồ để quay lại phần bài giảng tương ứng.</p>
              </div>
            </section>

            <section className="home-product-panel home-product-map">
              <div className="home-product-panel-head">
                <span>Sơ đồ tư duy</span>
                <span className="home-product-count">5 ý</span>
              </div>
              <div className="home-product-tree">
                <div className="home-product-tree-root"><i /> Cấu trúc tế bào</div>
                <div className="home-product-tree-branch">
                  <div className="home-product-tree-item is-current">
                    <i />
                    <span>Màng sinh chất</span>
                    <time>06:18</time>
                  </div>
                  <div className="home-product-tree-item home-product-tree-child">
                    <i />
                    <span>Lớp phospholipid</span>
                  </div>
                </div>
                <div className="home-product-tree-branch">
                  <div className="home-product-tree-item">
                    <i />
                    <span>Nhân tế bào</span>
                    <time>09:42</time>
                  </div>
                  <div className="home-product-tree-item">
                    <i />
                    <span>Ti thể</span>
                    <time>13:05</time>
                  </div>
                </div>
                <div className="home-product-tree-branch">
                  <div className="home-product-tree-item">
                    <i />
                    <span>Lưới nội chất</span>
                    <time>15:31</time>
                  </div>
                </div>
              </div>
              <div className="home-product-map-foot">
                <span className="home-product-mode is-active">Tự động</span>
                <span className="home-product-mode">Gần đây</span>
                <span className="home-product-zoom">− &nbsp; + &nbsp; Vừa khung</span>
              </div>
            </section>

            <section className="home-product-panel home-product-note">
              <div className="home-product-panel-head">
                <span>Chi tiết ý</span>
                <span className="home-product-pin">Đã ghim</span>
              </div>
              <span className="home-product-note-label">NHÁNH ĐANG CHỌN</span>
              <h3>Màng sinh chất</h3>
              <span className="home-product-note-label">GHI CHÚ CỦA BẠN</span>
              <p>Lớp phospholipid kép giúp kiểm soát trao đổi chất giữa tế bào và môi trường.</p>
              <span className="home-product-note-save">Ghi chú được lưu cùng nhánh</span>
            </section>
          </div>
        </div>

        <div className="home-product-details">
          <article data-reveal>
            <span className="home-product-detail-index">01 / Xem</span>
            <h3>Giữ bài giảng trong tầm mắt</h3>
            <p>Theo dõi video và thời điểm đang xem ngay cạnh nội dung bài học.</p>
          </article>
          <article data-reveal>
            <span className="home-product-detail-index">02 / Hiểu</span>
            <h3>Nhìn thấy mối liên hệ</h3>
            <p>Sơ đồ gom các ý theo nhánh để bạn dễ nắm cấu trúc tổng thể.</p>
          </article>
          <article data-reveal>
            <span className="home-product-detail-index">03 / Ghi nhớ</span>
            <h3>Để lại dấu ấn riêng</h3>
            <p>Thêm ghi chú cho từng ý và ghim nhánh quan trọng để tìm lại nhanh.</p>
          </article>
        </div>
      </section>

      <section className="home-features" id="features">
        <div className="home-section-header" data-reveal>
          <span className="home-eyebrow">Công cụ cho buổi học của bạn</span>
          <h2>Ít thao tác tìm kiếm. Nhiều thời gian để hiểu bài.</h2>
          <p>Mỗi tính năng được xây quanh một việc cụ thể: xem, định hướng, ghi nhớ và quay lại đúng chỗ.</p>
        </div>
        <div className="home-features-grid">
          <article className="home-feature-card" data-reveal>
            <span className="home-feature-index">01</span>
            <h3>Quay lại theo mốc thời gian</h3>
            <p>Mỗi nhánh gắn với thời điểm trong video. Chọn ý cần xem lại để chuyển thẳng tới đoạn bài giảng liên quan.</p>
          </article>
          <article className="home-feature-card" data-reveal>
            <span className="home-feature-index">02</span>
            <h3>Theo dõi sơ đồ khi đang xem</h3>
            <p>Nội dung được bổ sung theo tiến trình bài giảng, giúp bạn theo kịp các ý chính mà không phải chờ đến cuối.</p>
          </article>
          <article className="home-feature-card" data-reveal>
            <span className="home-feature-index">03</span>
            <h3>Ghi chú ngay trên từng ý</h3>
            <p>Lưu cách hiểu, ví dụ hoặc câu hỏi của bạn cùng nhánh tương ứng thay vì tách ra một ứng dụng ghi chú khác.</p>
          </article>
          <article className="home-feature-card" data-reveal>
            <span className="home-feature-index">04</span>
            <h3>Ghim nội dung cần nhớ</h3>
            <p>Đánh dấu nhánh quan trọng; các nhánh đã ghim vẫn được giữ lại khi bạn chuyển sang chế độ xem gần đây.</p>
          </article>
          <article className="home-feature-card" data-reveal>
            <span className="home-feature-index">05</span>
            <h3>Chủ động nhịp cập nhật</h3>
            <p>Bật cập nhật tự động trong lúc xem hoặc yêu cầu tạo cập nhật khi bạn muốn dừng lại để tập trung.</p>
          </article>
          <article className="home-feature-card" data-reveal>
            <span className="home-feature-index">06</span>
            <h3>Dùng tệp phụ đề riêng</h3>
            <p>Tải phụ đề định dạng .srt hoặc .vtt khi video không có phụ đề phù hợp để phân tích.</p>
          </article>
        </div>
      </section>

      <section className="home-study-modes">
        <div className="home-study-copy" data-reveal>
          <span className="home-eyebrow">Bạn quyết định cách ôn</span>
          <h2>Nhìn toàn cảnh khi cần. Thu gọn vào phần mới khi muốn tập trung.</h2>
          <p>
            Một sơ đồ dài có thể hữu ích khi bạn muốn nhìn lại cấu trúc bài học. Khi đang theo dõi nội dung mới, chế độ
            “Gần đây” giúp thu gọn các nhánh cũ — còn những ý đã ghim vẫn ở lại.
          </p>
          <ul>
            <li><span>01</span> Chuyển giữa sơ đồ đầy đủ và các nhánh gần đây.</li>
            <li><span>02</span> Phóng to, thu nhỏ hoặc đưa sơ đồ vừa khung.</li>
            <li><span>03</span> Chỉnh sửa nhãn và ghi chú theo cách bạn học.</li>
          </ul>
        </div>
        <div className="home-focus-demo" role="img" aria-label="Minh họa chuyển đổi sơ đồ giữa chế độ xem toàn bộ và các nhánh gần đây" data-reveal>
          <div className="home-focus-demo-head">
            <span>SƠ ĐỒ BÀI GIẢNG</span>
            <div><i /> Tự động <i className="home-focus-switch" /> Gần đây</div>
          </div>
          <div className="home-focus-tree">
            <div className="home-focus-root">Sinh học tế bào</div>
            <div className="home-focus-branch">
              <span className="home-focus-node is-muted">Màng sinh chất <small>06:18</small></span>
              <span className="home-focus-node is-muted">Lớp phospholipid</span>
            </div>
            <div className="home-focus-branch is-highlighted">
              <span className="home-focus-node is-current">Vận chuyển qua màng <small>16:42</small></span>
              <span className="home-focus-node">Khuếch tán thụ động</span>
            </div>
            <div className="home-focus-branch is-highlighted">
              <span className="home-focus-node is-current">Vận chuyển chủ động <small>19:10</small></span>
              <span className="home-focus-node is-pinned">Bơm natri-kali <small>Đã ghim</small></span>
            </div>
          </div>
          <div className="home-focus-caption">Các nhánh cũ được thu gọn; nội dung đã ghim vẫn hiển thị.</div>
        </div>
      </section>

      <section className="home-sources">
        <div className="home-section-header home-section-header--sources" data-reveal>
          <span className="home-eyebrow">Bắt đầu từ tài liệu bạn có</span>
          <h2>Học từ YouTube hoặc mang theo phụ đề của riêng bạn.</h2>
          <p>Chọn nguồn phù hợp với bài giảng. yt-mindmap đưa video và nội dung học vào cùng một phiên làm việc.</p>
        </div>
        <div className="home-source-grid">
          <article className="home-source-card" data-reveal>
            <div className="home-source-card-head">
              <span className="home-source-label">NGUỒN 01 · VIDEO</span>
              <div className="home-source-symbol home-source-symbol--video" aria-hidden="true">▶</div>
            </div>
            <div className="home-source-card-content">
              <h3>Link video YouTube</h3>
              <p>Dán link bài giảng để mở video trong workspace và bắt đầu theo dõi nội dung.</p>
            </div>
            <span className="home-source-example">youtube.com/watch?v=…</span>
          </article>
          <article className="home-source-card" data-reveal>
            <div className="home-source-card-head">
              <span className="home-source-label">NGUỒN 02 · PHỤ ĐỀ</span>
              <div className="home-source-symbol home-source-symbol--file" aria-hidden="true">SRT</div>
            </div>
            <div className="home-source-card-content">
              <h3>Tệp phụ đề .srt hoặc .vtt</h3>
              <p>Tải phụ đề của bạn khi cần dùng bản chép lời riêng hoặc video không có phụ đề sẵn.</p>
            </div>
            <span className="home-source-example">.srt &nbsp; / &nbsp; .vtt</span>
          </article>
        </div>
      </section>

      <section className="home-cta-section">
        <div className="home-cta-card" data-reveal>
          <h2>Tiết kiệm thời gian ôn tập bắt đầu từ hôm nay</h2>
          <p>Chỉ cần dán 1 link YouTube để có ngay sơ đồ tư duy của riêng bạn</p>
          <div className="home-actions home-actions-center">
            <Link className="home-cta-primary" to={authed ? '/dashboard' : '/register'}>
              {authed ? 'Mở dashboard →' : 'Tạo tài khoản miễn phí →'}
            </Link>
            <Link className="home-cta-ghost" to="/app">Dùng thử ngay</Link>
          </div>
          <span className="home-cta-micro">Miễn phí • Không cần thẻ • Dùng thử không cần tài khoản</span>
        </div>
      </section>

      <footer className="home-footer">
        <div className="home-footer-inner">
          <div className="home-brand">yt-mindmap</div>
          <span className="home-footer-text">Biến video YouTube thành sơ đồ tư duy để học nhanh hơn.</span>
          <nav className="home-footer-links" aria-label="Pháp lý">
            <Link to="/privacy">Quyền riêng tư</Link>
            <Link to="/terms">Điều khoản</Link>
            <Link to="/contact">Liên hệ</Link>
          </nav>
        </div>
      </footer>
    </main>
  )
}

export default Home
