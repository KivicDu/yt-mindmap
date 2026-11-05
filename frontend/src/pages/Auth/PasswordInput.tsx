import { useState } from 'react'

interface PasswordInputProps {
  id: string
  value: string
  placeholder: string
  autoComplete: string
  required?: boolean
  minLength?: number
  onChange: (value: string) => void
  onMoodChange: (mood: 'privacy' | 'peek' | 'idle') => void
  onFocusTarget: (element: HTMLElement | null) => void
}

function PasswordInput({
  id,
  value,
  placeholder,
  autoComplete,
  required,
  minLength,
  onChange,
  onMoodChange,
  onFocusTarget,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  const handleVisibilityToggle = () => {
    const nextVisible = !visible
    setVisible(nextVisible)
    onMoodChange(nextVisible ? 'peek' : 'privacy')
  }

  return (
    <div className="auth-password-control">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        onFocus={(event) => {
          onMoodChange(visible ? 'peek' : 'privacy')
          onFocusTarget(event.currentTarget)
        }}
        placeholder={placeholder}
      />
      <button
        className="auth-password-toggle"
        type="button"
        aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        aria-pressed={visible}
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleVisibilityToggle}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {visible ? (
            <>
              <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8" />
              <path d="M9.9 5.2A10.7 10.7 0 0112 5c5.4 0 9 5.1 9 7a8.6 8.6 0 01-2.1 3.2M6.2 6.2C3.9 7.7 3 10.4 3 12c0 1.9 3.6 7 9 7a9.7 9.7 0 004.1-.9" />
            </>
          ) : (
            <>
              <path d="M3 12s3.2-6 9-6 9 6 9 6-3.2 6-9 6-9-6-9-6z" />
              <circle cx="12" cy="12" r="2.4" />
            </>
          )}
        </svg>
      </button>
    </div>
  )
}

export default PasswordInput
