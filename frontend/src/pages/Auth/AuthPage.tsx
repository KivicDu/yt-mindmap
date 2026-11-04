import { useLocation } from 'react-router-dom'
import AuthShell from './AuthShell'
import { LoginForm } from './Login'
import { RegisterForm } from './Register'

function AuthPage() {
  const { pathname } = useLocation()
  const mode = pathname === '/register' ? 'register' : 'login'

  return (
    <AuthShell mode={mode}>
      <LoginForm active={mode === 'login'} />
      <RegisterForm active={mode === 'register'} />
    </AuthShell>
  )
}

export default AuthPage
