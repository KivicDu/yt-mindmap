import { useEffect, useState } from 'react'
import { fetchOAuthProviders, oauthStartUrl } from '../../lib/api'
import type { OAuthProviders } from '../../lib/api'

type Provider = 'google' | 'github'

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'google', label: 'Google' },
  { id: 'github', label: 'GitHub' },
]

/**
 * "Continue with Google/GitHub" buttons.
 *
 * Availability is read from the API: a provider without client credentials
 * stays disabled instead of sending the user to a dead redirect. Clicking an
 * enabled button is a full navigation, handled by the API.
 */
function OAuthButtons() {
  const [available, setAvailable] = useState<OAuthProviders | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchOAuthProviders().then((providers) => {
      if (!cancelled) setAvailable(providers)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="auth-oauth">
      {PROVIDERS.map((provider) => {
        const enabled = available?.[provider.id] === true
        return (
          <button
            key={provider.id}
            type="button"
            disabled={!enabled}
            title={
              enabled
                ? `Đăng nhập bằng ${provider.label}`
                : `Chưa cấu hình ${provider.label} OAuth trên máy chủ`
            }
            onClick={() => {
              if (!enabled) return
              window.location.href = oauthStartUrl(provider.id)
            }}
          >
            Tiếp tục với {provider.label}
            {available && !enabled ? ' — chưa cấu hình' : ''}
          </button>
        )
      })}
    </div>
  )
}

export default OAuthButtons
