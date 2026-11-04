import { useTheme } from '../context/ThemeContext'
import './ThemeToggle.css'

/**
 * One button that flips between light and dark. It shows the mode you would
 * switch *to*, which is the convention people already know from GitHub docs.
 */
function ThemeToggle() {
  const { resolved, toggle } = useTheme()
  const target = resolved === 'dark' ? 'light' : 'dark'
  const label = target === 'dark' ? 'Chuyển sang giao diện tối' : 'Chuyển sang giao diện sáng'

  return (
    <button
      type="button"
      className="btn btn--icon theme-toggle"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      <span className="theme-toggle__icons" aria-hidden="true">
        <svg className="theme-toggle__sun" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="3.6" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10 1.8v2.1M10 16.1v2.1M1.8 10h2.1M16.1 10h2.1M4.2 4.2l1.5 1.5M14.3 14.3l1.5 1.5M15.8 4.2l-1.5 1.5M5.7 14.3l-1.5 1.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <svg className="theme-toggle__moon" viewBox="0 0 20 20" fill="none">
          <path
            d="M16.2 12.3A6.6 6.6 0 0 1 7.7 3.8a6.6 6.6 0 1 0 8.5 8.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  )
}

export default ThemeToggle
