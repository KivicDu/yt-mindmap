import { Link } from 'react-router-dom'
import './Home.css'

function Home() {
  return (
    <main className="home">
      <header className="home-header">
        <div className="home-brand">yt-mindmap</div>
        <nav className="home-nav">
          <a className="home-nav-link" href="#how-it-works">Cách hoạt động</a>
          <a className="home-nav-link" href="#features">Tính năng</a>
          <Link className="home-header-cta" to="/start">Bắt đầu ngay</Link>
        </nav>
      </header>

      <section className="home-hero">
        <div className="home-hero-content">
          <span className="home-eyebrow">Dành cho sinh viên & người tự học</span>
          <h1>Tóm tắt video YouTube thành sơ đồ tư duy để ôn tập nhanh hơn</h1>
          <p>
            Không cần tua lại cả giờ đồng hồ chỉ để tìm lại một ý quan trọng. yt-mindmap tự động xây dựng mindmap theo
            trình tự bài giảng và cho phép bạn click để tua thẳng đến đúng thời điểm cần xem lại.
          </p>
          <p className="home-hero-subtle">Click vào bất kỳ nhánh nào để tua thẳng đến đúng thời điểm trong video.</p>
          <div className="home-actions">
            <Link className="home-cta-primary" to="/start">Tạo mindmap miễn phí →</Link>
            <a className="home-cta-ghost" href="#how-it-works">Xem cách hoạt điểm điển hoạt động</a>
          </div>
        </div>
        <div className="home-hero-visual">
          {/* TODO: Thay thế bằng ảnh thật khi workspace hoàn thiện */}
          <div className="home-mockup home-mockup--placeholder" aria-label="Minh họa giao diện yt-mindmap">
            <div className="home-mockup-header">
              <div className="home-mockup-dots">
                <span />
                <span />
                <span />
              </div>
              <div className="home-mockup-url">localhost:5173/app</div>
            </div>
            <div className="home-mockup-body">
              <div className="home-mockup-panel">
                <div className="home-mockup-panel-bar" />
                <div className="home-mockup-video-block" />
              </div>
              <div className="home-mockup-panel">
                <div className="home-mockup-panel-bar" />
                <div className="home-mockup-tree">
                  <div className="home-mockup-node home-mockup-node-root" />
                  <div className="home-mockup-branch">
                    <div className="home-mockup-node" />
                    <div className="home-mockup-node" />
                  </div>
                  <div className="home-mockup-branch">
                    <div className="home-mockup-node" />
                    <div className="home-mockup-node" />
                    <div className="home-mockup-node" />
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
        <div className="home-section-header">
          <span className="home-eyebrow">Vấn đề thường gặp</span>
          <h2>Mỗi lần ôn bài với video dài đều gây khó khăn</h2>
          <p>Đây chính là lý do sinh viên, người tự học mất nhiều thời gian hơn cần thiết</p>
        </div>
        <div className="home-problem-grid">
          <article className="home-problem-card">
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
          <article className="home-problem-card">
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
          <article className="home-problem-card">
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
        <div className="home-problem-solution">
          <p>
            <strong>Giải pháp:</strong> Biến video thành sơ đồ tư duy có cấu trúc rõ ràng, click để tua đúng chỗ cần xem lại.
          </p>
        </div>
      </section>

      <section className="home-steps" id="how-it-works">
        <div className="home-section-header home-section-header--left">
          <span className="home-eyebrow">Cách hoạt động</span>
          <h2>Chỉ 3 bước để có mindmap</h2>
          <p>Nhanh chóng, không cần đăng ký</p>
        </div>
        <div className="home-steps-list">
          <article className="home-step-item">
            <span className="home-step-index">01</span>
            <div className="home-step-content">
              <h3>Dán link YouTube</h3>
              <p>Sao chép URL bài giảng, video học tập hoặc khóa học bạn muốn tóm tắt.</p>
            </div>
          </article>
          <article className="home-step-item">
            <span className="home-step-index">02</span>
            <div className="home-step-content">
              <h3>AI tự động tóm tắt</h3>
              <p>Hệ thống phân tích phụ đề và xây dựng sơ đồ tư duy theo trình tự bài giảng.</p>
            </div>
          </article>
          <article className="home-step-item">
            <span className="home-step-index">03</span>
            <div className="home-step-content">
              <h3>Click để tua & ôn tập</h3>
              <p>Click vào bất kỳ nhánh nào để nhảy đến đúng thời điểm, thêm ghi chú và ghi nhớ hiệu quả hơn.</p>
            </div>
          </article>
        </div>
      </section>

      <section className="home-features" id="features">
        <div className="home-section-header">
          <span className="home-eyebrow">Tại sao chọn yt-mindmap</span>
          <h2>Giúp bạn ôn tập nhanh gấp nhiều lần</h2>
          <p>Tập trung vào những gì giúp tiết kiệm thời gian và ghi nhớ tốt hơn</p>
        </div>
        <div className="home-features-grid">
          <article className="home-feature-card">
            <h3>Tìm lại đúng chỗ chỉ với 1 cú click</h3>
            <p>Click vào nhánh để tua thẳng đến thời điểm giải thích khái niệm đó.</p>
          </article>
          <article className="home-feature-card">
            <h3>Xem mindmap hình thành ngay</h3>
            <p>Nội dung được cập nhật dần theo tiến trình xem, bạn không cần chờ tải toàn bộ.</p>
          </article>
          <article className="home-feature-card">
            <h3>Tập trung vào ý quan trọng</h3>
            <p>Thêm ghi chú, ghim những phần cần ôn và loại bỏ nhiễu bằng chế độ "Chỉ xem gần đây".</p>
          </article>
          <article className="home-feature-card">
            <h3>Ôn tập theo cấu trúc</h3>
            <p>Thay vì xem lại toàn bộ video, bạn chỉ cần đọc lại sơ đồ để nắm tổng quan nhanh chóng.</p>
          </article>
          <article className="home-feature-card">
            <h3>Tùy chỉnh theo sở thích</h3>
            <p>Chọn kiểu sơ đồ và bảng màu phù hợp để tạo không gian học tập riêng của bạn.</p>
          </article>
          <article className="home-feature-card">
            <h3>Hoạt động với nhiều nguồn</h3>
            <p>Dùng với video có phụ đề hoặc tải file .srt/.vtt khi cần thiết.</p>
          </article>
        </div>
      </section>

      <section className="home-cta-section">
        <div className="home-cta-card">
          <h2>Tiết kiệm thời gian ôn tập bắt đầu từ hôm nay</h2>
          <p>Chỉ cần dán 1 link YouTube để có ngay sơ đồ tư duy của riêng bạn</p>
          <div className="home-actions home-actions-center">
            <Link className="home-cta-primary" to="/start">Tạo mindmap miễn phí →</Link>
          </div>
          <span className="home-cta-micro">Không cần đăng ký • Miễn phí</span>
        </div>
      </section>

      <footer className="home-footer">
        <div className="home-footer-inner">
          <div className="home-brand">yt-mindmap</div>
          <span className="home-footer-text">Biến video YouTube thành sơ đồ tư duy để học nhanh hơn.</span>
        </div>
      </footer>
    </main>
  )
}

export default Home
