import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import ThemeToggle from '../../components/ThemeToggle'
import './Account.css'

interface AccountShellProps {
  eyebrow: string
  title: string
  tone?: 'default' | 'ok' | 'error'
  children: ReactNode
}

/** Shared chrome for the account pages that open from an email link. */
function AccountShell({ eyebrow, title, tone = 'default', children }: AccountShellProps) {
  return (
    <div className="account-shell">
      <div className="account-topbar">
        <Link className="account-brand" to="/">
          yt-mindmap
        </Link>
        <ThemeToggle />
      </div>

      <main
        className={`account-card${tone === 'ok' ? ' account-card--ok' : ''}${
          tone === 'error' ? ' account-card--error' : ''
        }`}
      >
        <span className="account-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  )
}

export default AccountShell
