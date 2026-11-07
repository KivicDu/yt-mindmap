/**
 * Owner-side share sheet for one saved project.
 *
 * The link is a capability with a role, exactly like Google Docs: "anyone with
 * the link" can be a viewer or an editor. Invite-only mode narrows the same
 * link to the addresses listed below, each with its own role. Turning sharing
 * off clears the slug, so an old link can never be revived.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  addShareMember,
  getShareSettings,
  removeShareMember,
  rotateShareLink,
  shareUrl,
  updateShareMember,
  updateShareSettings,
  type ProjectSummary,
  type ShareAccess,
  type ShareRole,
  type ShareSettings,
} from '../../lib/projects'

interface Props {
  project: ProjectSummary
  onClose: () => void
}

const ACCESS_LABEL: Record<ShareAccess, string> = {
  anyone: 'Bất kỳ ai có link',
  invited: 'Chỉ người được mời',
}

const ROLE_LABEL: Record<ShareRole, string> = {
  viewer: 'Chỉ xem',
  editor: 'Có thể chỉnh sửa',
}

export default function ShareDialog({ project, onClose }: Props) {
  const [settings, setSettings] = useState<ShareSettings | null>(null)
  const [access, setAccess] = useState<ShareAccess>('anyone')
  const [role, setRole] = useState<ShareRole>('viewer')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<ShareRole>('viewer')

  const apply = useCallback((next: ShareSettings) => {
    setSettings(next)
    setAccess(next.access)
    setRole(next.role)
  }, [])

  useEffect(() => {
    let cancelled = false
    getShareSettings(project.id)
      .then((data) => {
        if (!cancelled) apply(data)
      })
      .catch(() => {
        if (!cancelled) setError('Không tải được cấu hình chia sẻ.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [project.id, apply])

  const run = async (action: () => Promise<ShareSettings>) => {
    setBusy(true)
    setError('')
    try {
      apply(await action())
    } catch {
      setError('Thao tác thất bại. Kiểm tra kết nối rồi thử lại.')
    } finally {
      setBusy(false)
    }
  }

  const toggle = () =>
    run(() =>
      updateShareSettings(project.id, {
        enabled: !settings?.enabled,
        access,
        role,
      }),
    )

  const changeAccess = (next: ShareAccess) => {
    setAccess(next)
    if (settings?.enabled) {
      void run(() => updateShareSettings(project.id, { enabled: true, access: next, role }))
    }
  }

  const changeRole = (next: ShareRole) => {
    setRole(next)
    if (settings?.enabled) {
      void run(() => updateShareSettings(project.id, { enabled: true, access, role: next }))
    }
  }

  const copy = async () => {
    if (!settings?.slug) return
    try {
      await navigator.clipboard.writeText(shareUrl(settings.slug))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Trình duyệt không cho phép sao chép. Hãy chọn link và sao chép thủ công.')
    }
  }

  const invite = async () => {
    const value = email.trim()
    if (!value) return
    setBusy(true)
    setError('')
    try {
      await addShareMember(project.id, value, inviteRole)
      apply(await getShareSettings(project.id))
      setEmail('')
    } catch {
      setError('Không mời được địa chỉ này. Kiểm tra email rồi thử lại.')
    } finally {
      setBusy(false)
    }
  }

  const changeMemberRole = async (memberId: string, next: ShareRole) => {
    setBusy(true)
    setError('')
    try {
      await updateShareMember(project.id, memberId, next)
      apply(await getShareSettings(project.id))
    } catch {
      setError('Không đổi được quyền của người này.')
    } finally {
      setBusy(false)
    }
  }

  const removeMember = async (memberId: string) => {
    setBusy(true)
    setError('')
    try {
      await removeShareMember(project.id, memberId)
      apply(await getShareSettings(project.id))
    } catch {
      setError('Không xoá được người này khỏi dự án.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="share-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="share-dialog__head">
          <div>
            <span className="dash-eyebrow">Chia sẻ</span>
            <h2 id="share-title">{project.title}</h2>
          </div>
          <button
            className="share-dialog__close"
            type="button"
            aria-label="Đóng"
            onClick={onClose}
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="m5.5 5.5 9 9m0-9-9 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        {loading ? (
          <p className="share-note">Đang tải…</p>
        ) : (
          <>
            <div className="share-switch-row">
              <div>
                <strong>{settings?.enabled ? 'Đang chia sẻ' : 'Đang tắt chia sẻ'}</strong>
                <p>
                  {settings?.enabled
                    ? 'Ai có link đều mở được theo quyền bên dưới.'
                    : 'Link cũ (nếu có) đã ngừng hoạt động.'}
                </p>
              </div>
              <button
                className={`share-switch${settings?.enabled ? ' is-on' : ''}`}
                type="button"
                role="switch"
                aria-checked={Boolean(settings?.enabled)}
                aria-label="Bật hoặc tắt chia sẻ"
                disabled={busy}
                onClick={() => void toggle()}
              >
                <span aria-hidden="true" />
              </button>
            </div>

            <div className="share-grid">
              <label className="share-field">
                <span>Người có link</span>
                <select
                  value={access}
                  disabled={busy}
                  onChange={(event) => changeAccess(event.target.value as ShareAccess)}
                >
                  {(Object.keys(ACCESS_LABEL) as ShareAccess[]).map((value) => (
                    <option key={value} value={value}>
                      {ACCESS_LABEL[value]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="share-field">
                <span>Quyền của link</span>
                <select
                  value={role}
                  disabled={busy || access === 'invited'}
                  onChange={(event) => changeRole(event.target.value as ShareRole)}
                >
                  {(Object.keys(ROLE_LABEL) as ShareRole[]).map((value) => (
                    <option key={value} value={value}>
                      {ROLE_LABEL[value]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {access === 'invited' && (
              <p className="share-hint">
                Ở chế độ chỉ người được mời, mỗi địa chỉ bên dưới dùng quyền riêng của
                mình; quyền của link không áp dụng.
              </p>
            )}

            {settings?.enabled && settings.slug ? (
              <div className="share-link">
                <input
                  readOnly
                  value={shareUrl(settings.slug)}
                  aria-label="Link chia sẻ"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button className="btn btn--primary btn--sm" type="button" onClick={() => void copy()}>
                  {copied ? 'Đã sao chép' : 'Sao chép'}
                </button>
                {confirmRotate ? (
                  <>
                    <button
                      className="btn btn--ghost btn--sm"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void run(() => rotateShareLink(project.id, role)).then(() =>
                          setConfirmRotate(false),
                        )
                      }}
                    >
                      Tạo link mới
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      type="button"
                      onClick={() => setConfirmRotate(false)}
                    >
                      Huỷ
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn--ghost btn--sm"
                    type="button"
                    onClick={() => setConfirmRotate(true)}
                  >
                    Đổi link
                  </button>
                )}
              </div>
            ) : (
              <p className="share-hint">
                Bật chia sẻ để nhận một link mới. Link được tạo lại mỗi lần bật, nên link
                cũ không thể dùng lại.
              </p>
            )}

            {confirmRotate && (
              <p className="share-warning">
                Link hiện tại sẽ chết ngay khi bạn tạo link mới.
              </p>
            )}

            <div className="share-members">
              <header>
                <h3>Người được mời</h3>
                <span>{settings?.members.length ?? 0} người</span>
              </header>

              <form
                className="share-invite"
                onSubmit={(event) => {
                  event.preventDefault()
                  void invite()
                }}
              >
                <input
                  type="email"
                  required
                  placeholder="email@gmail.com"
                  aria-label="Email người được mời"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <select
                  value={inviteRole}
                  aria-label="Quyền của người được mời"
                  onChange={(event) => setInviteRole(event.target.value as ShareRole)}
                >
                  {(Object.keys(ROLE_LABEL) as ShareRole[]).map((value) => (
                    <option key={value} value={value}>
                      {ROLE_LABEL[value]}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn--primary btn--sm"
                  type="submit"
                  disabled={busy || !email.trim()}
                >
                  Mời
                </button>
              </form>

              {settings && settings.members.length > 0 ? (
                <ul className="share-member-list">
                  {settings.members.map((member) => (
                    <li key={member.id}>
                      <span className="share-member__email">
                        {member.email}
                        {!member.registered && (
                          <span className="share-member__pending">chưa đăng ký</span>
                        )}
                      </span>
                      <select
                        value={member.role}
                        aria-label={`Quyền của ${member.email}`}
                        disabled={busy}
                        onChange={(event) =>
                          void changeMemberRole(
                            member.id,
                            event.target.value as ShareRole,
                          )
                        }
                      >
                        {(Object.keys(ROLE_LABEL) as ShareRole[]).map((value) => (
                          <option key={value} value={value}>
                            {ROLE_LABEL[value]}
                          </option>
                        ))}
                      </select>
                      <button
                        className="dash-mini dash-mini--danger"
                        type="button"
                        disabled={busy}
                        onClick={() => void removeMember(member.id)}
                      >
                        Xoá
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="share-hint">
                  Chưa mời ai. Người được mời sẽ thấy dự án trong mục “Được chia sẻ với
                  tôi” sau khi đăng nhập đúng email.
                </p>
              )}
            </div>

            {error && <p className="share-error" role="alert">{error}</p>}
          </>
        )}
      </section>
    </div>
  )
}
