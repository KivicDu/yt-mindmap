/**
 * Session state for the app.
 *
 * The access token is kept in memory by `lib/api`; this context owns the user
 * object and the loading/authenticated/anonymous state that the routes read.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { apiFetch, hasSessionHint, onSessionLost, refreshSession, setAccessToken } from '../lib/api'

export interface User {
  id: string
  email: string
  display_name: string
  provider: string
  avatar_url: string | null
  email_verified: boolean
  created_at: string
}

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous'

interface AuthContextValue {
  user: User | null
  status: SessionStatus
  login: (email: string, password: string) => Promise<void>
  register: (displayName: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
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

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, register, logout }),
    [user, status, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
