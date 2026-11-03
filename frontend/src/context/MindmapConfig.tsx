import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export type MindmapLayout = 'tree' | 'radial'
export type MindmapPalette = 'pastel' | 'mono' | 'ocean' | 'violet'

export interface MindmapConfig {
  layout: MindmapLayout
  palette: MindmapPalette
}

const DEFAULT_CONFIG: MindmapConfig = {
  layout: 'tree',
  palette: 'pastel',
}

const STORAGE_KEY = 'ytmm:config'

interface MindmapConfigContextValue {
  config: MindmapConfig
  setConfig: (config: MindmapConfig) => void
  hasConfig: boolean
}

const MindmapConfigContext = createContext<MindmapConfigContextValue | undefined>(undefined)

function loadConfig(): MindmapConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return {
        layout: parsed.layout === 'radial' ? 'radial' : 'tree',
        palette: ['pastel', 'mono', 'ocean', 'violet'].includes(parsed.palette) ? parsed.palette : 'pastel',
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_CONFIG
}

function saveConfig(config: MindmapConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // ignore
  }
}

export function MindmapConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<MindmapConfig>(DEFAULT_CONFIG)
  const [hasConfig, setHasConfig] = useState(false)

  useEffect(() => {
    const loaded = loadConfig()
    setConfigState(loaded)
    try {
      setHasConfig(Boolean(localStorage.getItem(STORAGE_KEY)))
    } catch {
      setHasConfig(false)
    }
  }, [])

  const setConfig = (next: MindmapConfig) => {
    setConfigState(next)
    saveConfig(next)
    setHasConfig(true)
  }

  return (
    <MindmapConfigContext.Provider value={{ config, setConfig, hasConfig }}>
      {children}
    </MindmapConfigContext.Provider>
  )
}

export function useMindmapConfig() {
  const ctx = useContext(MindmapConfigContext)
  if (!ctx) {
    throw new Error('useMindmapConfig must be used within MindmapConfigProvider')
  }
  return ctx
}
