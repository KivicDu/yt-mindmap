"""Vietnamese copy for the account emails and their links.

The routes only deal with raw tokens; this module turns them into the URLs the
SPA understands and the text a reader receives. Swapping SMTP providers never
touches these messages.
"""

from html import escape

from app.core.config import get_settings
from app.services.emailer import send_email

BRAND = "yt-mindmap"


def _base_url() -> str:
    return get_settings().FRONTEND_URL.rstrip("/")


def verification_link(token: str) -> str:
    return f"{_base_url()}/verify-email?token={token}"


def password_reset_link(token: str) -> str:
    return f"{_base_url()}/reset-password?token={token}"


def email_change_link(token: str) -> str:
    return f"{_base_url()}/confirm-email-change?token={token}"


def _html(title: str, body: str, cta_label: str, link: str) -> str:
    return f"""\
<!doctype html>
<html lang="vi">
  <body style="margin:0;padding:24px;background:#f6f5f2;color:#1f1f1c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e1da;border-radius:12px">
      <tr>
        <td style="padding:28px">
          <p style="margin:0 0 18px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#77746c">{BRAND}</p>
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.35;font-weight:600">{escape(title)}</h1>
          <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#4a4842">{body}</p>
          <a href="{escape(link, quote=True)}" style="display:inline-block;padding:11px 18px;border-radius:8px;background:#2f5d50;color:#ffffff;font-size:14px;font-weight:500;text-decoration:none">{escape(cta_label)}</a>
          <p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#8a877f">Nếu nút không mở được, dán liên kết này vào trình duyệt:<br><span style="word-break:break-all;color:#4a4842">{escape(link)}</span></p>
          <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#8a877f">Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email. Liên kết sẽ tự hết hạn.</p>
        </td>
      </tr>
    </table>
  </body>
</html>"""


def send_verification_email(to: str, link: str) -> None:
    send_email(
        to=to,
        subject=f"Xác minh email cho {BRAND}",
        text=(
            "Xác minh địa chỉ email của bạn\n\n"
            "Mở liên kết dưới đây để xác minh email và nhận lời mời chia sẻ đúng người:\n"
            f"{link}\n\n"
            "Liên kết dùng một lần và hết hạn sau 24 giờ."
        ),
        html=_html(
            "Xác minh địa chỉ email",
            "Mở liên kết để xác minh email và nhận lời mời chia sẻ đúng người.",
            "Xác minh email",
            link,
        ),
    )


def send_password_reset_email(to: str, link: str) -> None:
    send_email(
        to=to,
        subject=f"Đặt lại mật khẩu {BRAND}",
        text=(
            "Đặt lại mật khẩu\n\n"
            "Ai đó (có thể là bạn) đã yêu cầu đặt lại mật khẩu cho tài khoản này.\n"
            f"Mở liên kết để chọn mật khẩu mới: {link}\n\n"
            "Liên kết dùng một lần và hết hạn sau 1 giờ. Nếu không phải bạn, hãy bỏ qua email."
        ),
        html=_html(
            "Đặt lại mật khẩu",
            "Ai đó (có thể là bạn) đã yêu cầu đặt lại mật khẩu. Liên kết dùng một lần và hết hạn sau 1 giờ.",
            "Chọn mật khẩu mới",
            link,
        ),
    )


def send_email_change_email(to: str, link: str) -> None:
    send_email(
        to=to,
        subject=f"Xác nhận email mới cho {BRAND}",
        text=(
            "Xác nhận địa chỉ email mới\n\n"
            "Mở liên kết dưới đây để chuyển tài khoản sang địa chỉ này:\n"
            f"{link}\n\n"
            "Liên kết dùng một lần và hết hạn sau 1 giờ. Sau khi xác nhận, mọi thiết bị sẽ đăng xuất."
        ),
        html=_html(
            "Xác nhận địa chỉ email mới",
            "Mở liên kết để chuyển tài khoản sang địa chỉ này. Sau khi xác nhận, mọi thiết bị sẽ đăng xuất.",
            "Xác nhận email mới",
            link,
        ),
    )


def send_account_deleted_email(to: str) -> None:
    """Final notice after a hard delete: no link, the account is gone."""
    send_email(
        to=to,
        subject=f"Tài khoản {BRAND} đã được xoá",
        text=(
            "Tài khoản của bạn đã được xoá\n\n"
            "Toàn bộ dự án, sơ đồ tư duy và phiên đăng nhập thuộc tài khoản này "
            "đã bị xoá vĩnh viễn.\n\n"
            "Nếu bạn không yêu cầu việc này, hãy trả lời email này ngay để được hỗ trợ. "
            "Bạn vẫn có thể tạo tài khoản mới bất cứ lúc nào."
        ),
        html=_html(
            "Tài khoản của bạn đã được xoá",
            "Toàn bộ dự án, sơ đồ tư duy và phiên đăng nhập thuộc tài khoản này đã bị "
            "xoá vĩnh viễn. Nếu bạn không yêu cầu việc này, hãy liên hệ quản trị viên ngay.",
            "Mở yt-mindmap",
            _base_url(),
        ),
    )


def send_email_changed_notice(to: str, old_email: str, new_email: str) -> None:
    """Tell the old address that the account moved (security notice)."""
    send_email(
        to=to,
        subject=f"Email tài khoản {BRAND} đã thay đổi",
        text=(
            "Email tài khoản đã thay đổi\n\n"
            f"Tài khoản {old_email} vừa được chuyển sang {new_email}.\n"
            "Mọi phiên đăng nhập đã bị thu hồi. Nếu không phải bạn, hãy liên hệ quản trị viên ngay."
        ),
        html=_html(
            "Email tài khoản đã thay đổi",
            f"Tài khoản <strong>{escape(old_email)}</strong> vừa được chuyển sang "
            f"<strong>{escape(new_email)}</strong>. Mọi phiên đăng nhập đã bị thu hồi.",
            "Mở yt-mindmap",
            _base_url(),
        ),
    )
