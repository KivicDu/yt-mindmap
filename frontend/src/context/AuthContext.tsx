/**
 * Session state for the app.
 *
 * The access token is kept in memory by `lib/api`; this context owns the user
 * object and the loading/authenticated/anonymous state that the routes read.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { apiFetch, hasSessionHint, onSessionLost, refreshSession, setAccessToken } from '../lib/api'
import type { EmailChangeRequestResult, User, VerificationRequestResult } from '../lib/account'

export type { User } from '../lib/account'

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous'

interface AuthContextValue {
  user: User | null
  status: SessionStatus
  login: (email: string, password: string) => Promise<void>
  register: (displayName: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  updateProfile: (displayName: string) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  requestEmailVerification: () => Promise<VerificationRequestResult>
  verifyEmail: (token: string) => Promise<User>
  requestPasswordReset: (email: string) => Promise<void>
  resetPassword: (token: string, newPassword: string) => Promise<void>
  requestEmailChange: (
    newEmail: string,
    currentPassword?: string,
  ) => Promise<EmailChangeRequestResult>
  confirmEmailChange: (token: string) => Promise<User>
}

interface AuthResponse {
  access_token: string
  expires_in: number
  user: User
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<SessionStatus>('loading')

  const clear = useCallback(() => {
    setAccessToken(null)
    setUser(null)
    setStatus('anonymous')
  }, [])

  // On first load, try to trade the refresh cookie for an access token.
  useEffect(() => {
    let cancelled = false

    async function restore() {
      if (!hasSessionHint()) {
        setStatus('anonymous')
        return
      }
      const refreshed = await refreshSession()
      if (cancelled) return
      if (!refreshed) {
        setStatus('anonymous')
        return
      }
      try {
        const me = await apiFetch<User>('/auth/me')
        if (cancelled) return
        setUser(me)
        setStatus('authenticated')
      } catch {
        if (cancelled) return
        clear()
      }
    }

    void restore()
    return () => {
      cancelled = true
    }
  }, [clear])

  useEffect(() => {
    onSessionLost(clear)
    return () => onSessionLost(null)
  }, [clear])

  const applySession = useCallback((data: AuthResponse) => {
    setAccessToken(data.access_token)
    setUser(data.user)
    setStatus('authenticated')
  }, [])

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await apiFetch<AuthResponse>('/auth/login', {
        body: { email, password },
        anonymous: true,
      })
      applySession(data)
    },
    [applySession],
  )

  const register = useCallback(
    async (displayName: string, email: string, password: string) => {
      const data = await apiFetch<AuthResponse>('/auth/register', {
        body: { email, password, display_name: displayName },
        anonymous: true,
      })
      applySession(data)
    },
    [applySession],
  )

  const logout = useCallback(async () => {
    try {
      await apiFetch<void>('/auth/logout', { method: 'POST', anonymous: true })
    } finally {
      clear()
    }
  }, [clear])

  const updateProfile = useCallback(async (displayName: string) => {
    const updated = await apiFetch<User>('/auth/me', {
      method: 'PATCH',
      body: { display_name: displayName },
    })
    setUser(updated)
  }, [])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    // The API rotates the refresh cookie; the browser keeps the new one.
    await apiFetch<void>('/auth/password', {
      method: 'POST',
      body: { current_password: currentPassword, new_password: newPassword },
    })
  }, [])

  const requestEmailVerification = useCallback(
    () =>
      apiFetch<VerificationRequestResult>('/auth/verification/request', {
        method: 'POST',
      }),
    [],
  )

  const verifyEmail = useCallback(async (token: string) => {
    const verified = await apiFetch<User>('/auth/verification/confirm', {
      method: 'POST',
      body: { token },
      anonymous: true,
    })
    // A signed-in visitor verifying in this tab should see the new badge
    // immediately; the link may also open in a browser with no session.
    setUser((current) => (current && current.id === verified.id ? verified : current))
    return verified
  }, [])

  const requestPasswordReset = useCallback(async (email: string) => {
    // The API answers the same way for unknown addresses, so the UI can always
    // show the same "check your inbox" message.
    await apiFetch<{ status: 'sent' }>('/auth/password/forgot', {
      body: { email },
      anonymous: true,
    })
  }, [])

  const resetPassword = useCallback(
    async (token: string, newPassword: string) => {
      await apiFetch<void>('/auth/password/reset', {
        body: { token, new_password: newPassword },
        anonymous: true,
      })
      // A reset revokes every refresh token, including this browser's.
      clear()
    },
    [clear],
  )

  const requestEmailChange = useCallback(
    (newEmail: string, currentPassword?: string) =>
      apiFetch<EmailChangeRequestResult>('/auth/email/request', {
        body: {
          new_email: newEmail,
          ...(currentPassword ? { current_password: currentPassword } : {}),
        },
      }),
    [],
  )

  const confirmEmailChange = useCallback(
    async (token: string) => {
      const updated = await apiFetch<User>('/auth/email/confirm', {
        method: 'POST',
        body: { token },
        anonymous: true,
      })
      // Confirming revokes every refresh token, so this browser is signed out.
      clear()
      return updated
    },
    [clear],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      login,
      register,
      logout,
      updateProfile,
      changePassword,
      requestEmailVerification,
      verifyEmail,
      requestPasswordReset,
      resetPassword,
      requestEmailChange,
      confirmEmailChange,
    }),
    [
      user,
      status,
      login,
      register,
      logout,
      updateProfile,
      changePassword,
      requestEmailVerification,
      verifyEmail,
      requestPasswordReset,
      resetPassword,
      requestEmailChange,
      confirmEmailChange,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
