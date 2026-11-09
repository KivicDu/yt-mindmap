import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import './Legal.css'

const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL || 'contact@ytmindmap.local'

function LegalShell({
  eyebrow,
  title,
  updated,
  children,
}: {
  eyebrow: string
  title: string
  updated: string
  children: ReactNode
}) {
  return (
    <main className="legal">
      <header className="legal-topbar">
        <Link className="legal-brand" to="/">
          <img src="/yt-mindmap-icon.png" alt="" aria-hidden="true" />
          <span>yt-mindmap</span>
        </Link>
        <Link className="legal-back" to="/">← Về trang chủ</Link>
      </header>

      <article className="legal-doc">
        <p className="legal-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="legal-updated">Cập nhật lần cuối: {updated}</p>
        {children}
      </article>

      <footer className="legal-footer">
        <Link to="/privacy">Quyền riêng tư</Link>
        <Link to="/terms">Điều khoản</Link>
        <Link to="/contact">Liên hệ</Link>
      </footer>
    </main>
  )
}

export function PrivacyPage() {
  return (
    <LegalShell eyebrow="Pháp lý" title="Chính sách quyền riêng tư" updated="08/11/2026">
      <p className="legal-lead">
        Đây là nội dung mẫu, không phải tư vấn pháp lý. Hãy nhờ người có chuyên môn rà
        soát trước khi dùng cho sản phẩm thật.
      </p>

      <h2>Dữ liệu chúng tôi lưu</h2>
      <ul>
        <li>Email, tên hiển thị và phương thức đăng nhập của tài khoản.</li>
        <li>Dự án, bản nháp, sơ đồ tư duy, ghi chú và nhãn ghim bạn tạo.</li>
        <li>Danh sách email được mời vào dự án và vai trò tương ứng.</li>
        <li>Nhật ký kỹ thuật tối thiểu để vận hành, bảo mật và chống lạm dụng.</li>
      </ul>

      <h2>Mục đích sử dụng</h2>
      <p>
        Dữ liệu được dùng để cung cấp tính năng sơ đồ tư duy, đồng bộ giữa các thiết
        bị, gửi email xác minh/đặt lại mật khẩu và bảo vệ dịch vụ khỏi lạm dụng.
        Chúng tôi không bán dữ liệu cá nhân.
      </p>

      <h2>Bên thứ ba</h2>
      <p>
        Dịch vụ có thể dùng nhà cung cấp mô hình AI để tạo sơ đồ và nhà cung cấp email
        để gửi thông báo. Nội dung video và phần văn bản cần xử lý có thể được gửi tới
        các dịch vụ này để hoàn thành yêu cầu của bạn.
      </p>

      <h2>Lưu trữ và xoá</h2>
      <p>
        Bạn có thể xoá tài khoản trong phần Cài đặt. Khi xác nhận, dự án, bản nháp,
        token đăng nhập và lời mời chia sẻ gắn với email của bạn sẽ bị xoá vĩnh viễn.
        Một số bản ghi kỹ thuật ẩn danh có thể được giữ lại trong thời gian ngắn để
        điều tra sự cố.
      </p>

      <h2>Quyền của bạn</h2>
      <p>
        Bạn có thể cập nhật hồ sơ, đổi email, đổi mật khẩu hoặc xoá tài khoản bất cứ
        lúc nào. Nếu cần hỗ trợ thêm, liên hệ{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalShell>
  )
}

export function TermsPage() {
  return (
    <LegalShell eyebrow="Pháp lý" title="Điều khoản sử dụng" updated="08/11/2026">
      <p className="legal-lead">
        Đây là nội dung mẫu, không phải tư vấn pháp lý. Hãy điều chỉnh cho phù hợp với
        mô hình vận hành thực tế của bạn.
      </p>

      <h2>1. Tài khoản</h2>
      <p>
        Bạn chịu trách nhiệm bảo mật thông tin đăng nhập và mọi hoạt động diễn ra dưới
        tài khoản của mình. Không chia sẻ tài khoản cho người khác dùng thay.
      </p>

      <h2>2. Nội dung bạn tải lên</h2>
      <p>
        Bạn chỉ nên xử lý video và tài liệu mà mình có quyền sử dụng. Bạn giữ quyền sở
        hữu với nội dung của mình; chúng tôi chỉ xử lý nội dung đó để cung cấp tính
        năng bạn yêu cầu.
      </p>

      <h2>3. Sử dụng hợp lý</h2>
      <ul>
        <li>Không dùng dịch vụ để phát tán nội dung vi phạm pháp luật.</li>
        <li>Không tìm cách vượt giới hạn, dò quét hoặc gây quá tải hệ thống.</li>
        <li>Không thu thập dữ liệu của người dùng khác khi chưa được phép.</li>
      </ul>

      <h2>4. Giới hạn trách nhiệm</h2>
      <p>
        Sơ đồ tư duy do AI tạo có thể sai hoặc thiếu. Hãy kiểm chứng lại với nguồn gốc
        trước khi dùng cho quyết định quan trọng. Dịch vụ được cung cấp “nguyên trạng”
        và có thể tạm ngừng để bảo trì.
      </p>

      <h2>5. Thay đổi điều khoản</h2>
      <p>
        Khi có thay đổi quan trọng, chúng tôi sẽ thông báo qua email hoặc trên trang
        này. Việc tiếp tục dùng dịch vụ sau thời điểm cập nhật đồng nghĩa bạn chấp nhận
        nội dung mới.
      </p>

      <h2>6. Liên hệ</h2>
      <p>
        Câu hỏi về điều khoản: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalShell>
  )
}

export function ContactPage() {
  return (
    <LegalShell eyebrow="Hỗ trợ" title="Liên hệ" updated="08/11/2026">
      <p className="legal-lead">
        Có câu hỏi, báo lỗi hoặc cần hỗ trợ tài khoản? Gửi email tới địa chỉ dưới đây.
      </p>

      <div className="legal-contact">
        <p className="legal-contact__label">Email hỗ trợ</p>
        <a className="legal-contact__value" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
        <p className="legal-contact__note">
          Chúng tôi cố gắng phản hồi trong vòng 2–3 ngày làm việc. Khi báo lỗi, hãy kèm
          đường dẫn trang và thời điểm xảy ra để việc điều tra nhanh hơn.
        </p>
      </div>

      <h2>Trước khi gửi email</h2>
      <ul>
        <li>Kiểm tra hộp thư spam nếu chưa nhận được email xác minh hoặc đặt lại mật khẩu.</li>
        <li>Thử tải lại trang và đăng nhập lại nếu gặp lỗi phiên.</li>
        <li>Không gửi mật khẩu hoặc mã xác thực qua email.</li>
      </ul>
    </LegalShell>
  )
}
