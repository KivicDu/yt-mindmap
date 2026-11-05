import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import AuthShell from './AuthShell'
import type { AuthMascotMood } from './AuthMascot'
import { LoginForm } from './Login'
import { RegisterForm } from './Register'

function AuthPage() {
  const { pathname } = useLocation()
  const mode = pathname === '/register' ? 'register' : 'login'
  const [mascotState, setMascotState] = useState({
    mode,
    mood: 'idle' as AuthMascotMood,
    caretPosition: 0,
  })
  const [focusTarget, setFocusTarget] = useState<{ mode: string; x: number; y: number } | null>(null)
  const currentFocusTarget = focusTarget?.mode === mode ? focusTarget : null
  const currentMascotState = mascotState.mode === mode
    ? mascotState
    : { mode, mood: 'idle' as AuthMascotMood, caretPosition: 0 }

  const updateMascotMood = (mood: AuthMascotMood) => {
    setMascotState((current) => ({
      mode,
      mood,
      caretPosition: current.mode === mode ? current.caretPosition : 0,
    }))
  }

  const updateCaretPosition = (value: string, caret: number | null) => {
    if (value.length === 0 || caret === null) {
      setMascotState((current) => ({
        mode,
        mood: current.mode === mode ? current.mood : 'typing',
        caretPosition: 0,
      }))
      return
    }

    setMascotState((current) => ({
      mode,
      mood: current.mode === mode ? current.mood : 'typing',
      caretPosition: current.mode === mode ? ((caret / value.length) - 0.5) * 7 : 0,
    }))
  }

  const updateFocusTarget = (element: HTMLElement | null) => {
    if (!element) {
      setFocusTarget(null)
      return
    }

    const bounds = element.getBoundingClientRect()
    setFocusTarget({
      mode,
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    })
  }

  return (
    <AuthShell
      mode={mode}
      mascotMood={currentMascotState.mood}
      caretPosition={currentMascotState.caretPosition}
      focusTarget={currentFocusTarget}
    >
      <LoginForm
        active={mode === 'login'}
        onMoodChange={updateMascotMood}
        onCaretChange={updateCaretPosition}
        onFocusTarget={updateFocusTarget}
      />
      <RegisterForm
        active={mode === 'register'}
        onMoodChange={updateMascotMood}
        onCaretChange={updateCaretPosition}
        onFocusTarget={updateFocusTarget}
      />
    </AuthShell>
  )
}

export default AuthPage
