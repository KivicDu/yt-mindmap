/**
 * The look of a study map: how the branches are laid out and which pastel
 * palette colours them.
 *
 * Everything here is data, not code, so the picker, the CSS and both renderers
 * read the same values. Colours live in this file only; they reach the DOM as
 * custom properties (`--mm-b1` … `--mm-b6`) that CSS and the SVG renderers
 * share, so a new palette is one entry, not a hunt through stylesheets.
 */

export type MapLayout = 'tree' | 'spider' | 'bubble' | 'circle'
export type MapPalette = 'paper' | 'sage' | 'sky' | 'blush' | 'lilac' | 'sand'

export interface MapStyle {
  layout: MapLayout
  palette: MapPalette
}

interface PaletteDef {
  id: MapPalette
  name: string
  hint: string
  /** Six branch colours, deliberately low-saturation so a long lecture stays calm. */
  branches: readonly [string, string, string, string, string, string]
}

interface LayoutDef {
  id: MapLayout
  name: string
  hint: string
}

export const MAP_PALETTES: readonly PaletteDef[] = [
  {
    id: 'paper',
    name: 'Giấy ấm',
    hint: 'Trung tính, gần như không màu',
    branches: ['#b08968', '#a89078', '#8f9e7f', '#c0a878', '#a08f9b', '#8d9aa6'],
  },
  {
    id: 'sage',
    name: 'Xanh lá',
    hint: 'Dịu mắt, hợp phiên học dài',
    branches: ['#7f9f7a', '#93b48c', '#6f978a', '#a7bf9d', '#86a9a2', '#b2c3a3'],
  },
  {
    id: 'sky',
    name: 'Xanh trời',
    hint: 'Mát, rõ ràng, dễ phân biệt nhánh',
    branches: ['#7fa3c0', '#8fb5cb', '#9aa9c9', '#7cbcbf', '#a2b8d8', '#8fc3d4'],
  },
  {
    id: 'blush',
    name: 'Hồng đào',
    hint: 'Ấm nhẹ, không chói',
    branches: ['#cf9a92', '#d7ab9a', '#c89aaa', '#dfb3a5', '#c8a2af', '#d6bba5'],
  },
  {
    id: 'lilac',
    name: 'Tím khói',
    hint: 'Trầm, hợp ghi chú buổi tối',
    branches: ['#a293b7', '#afa1c3', '#999dbf', '#bfa9c3', '#a7afce', '#b5a5b9'],
  },
  {
    id: 'sand',
    name: 'Vàng cát',
    hint: 'Sáng, ấm, gần giấy cũ',
    branches: ['#c8b379', '#cfbc8e', '#c1aa83', '#d7c69a', '#beb388', '#ccbf9a'],
  },
]

export const MAP_LAYOUTS: readonly LayoutDef[] = [
  {
    id: 'tree',
    name: 'Tree map',
    hint: 'Cây trái → phải, quen thuộc và dễ đọc nhất',
  },
  {
    id: 'spider',
    name: 'Spider map',
    hint: 'Ý chính toả ra từ tâm như chân nhện',
  },
  {
    id: 'bubble',
    name: 'Bubble map',
    hint: 'Mỗi ý là một bong bóng có các ý con vây quanh',
  },
  {
    id: 'circle',
    name: 'Circle map',
    hint: 'Vòng tròn đồng tâm, nhìn được toàn cảnh',
  },
]

export const DEFAULT_STYLE: MapStyle = { layout: 'tree', palette: 'paper' }

const LAYOUT_IDS = MAP_LAYOUTS.map((item) => item.id)
const PALETTE_IDS = MAP_PALETTES.map((item) => item.id)

export function isMapLayout(value: unknown): value is MapLayout {
  return typeof value === 'string' && (LAYOUT_IDS as string[]).includes(value)
}

export function isMapPalette(value: unknown): value is MapPalette {
  return typeof value === 'string' && (PALETTE_IDS as string[]).includes(value)
}

/** Coerce anything (URL, database row, localStorage) into a usable style. */
export function normalizeStyle(raw: Partial<MapStyle> | null | undefined): MapStyle {
  return {
    layout: isMapLayout(raw?.layout) ? raw.layout : DEFAULT_STYLE.layout,
    palette: isMapPalette(raw?.palette) ? raw.palette : DEFAULT_STYLE.palette,
  }
}

export function paletteDef(id: MapPalette): PaletteDef {
  return MAP_PALETTES.find((item) => item.id === id) ?? MAP_PALETTES[0]
}

/** Branch colour by top-level index; wraps so a wide map never runs out. */
export function branchColor(palette: MapPalette, index: number): string {
  const { branches } = paletteDef(palette)
  const safe = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0
  return branches[safe % branches.length]
}

/**
 * Custom properties handed to the map's `<svg>`. Inline because the exported
 * SVG is cloned from that element and must carry its palette with it.
 */
export function styleVars(style: MapStyle): Record<string, string> {
  const vars: Record<string, string> = {}
  paletteDef(style.palette).branches.forEach((color, index) => {
    vars[`--mm-b${index + 1}`] = color
  })
  return vars
}

const STORAGE_KEY = 'yt-mindmap:map-style'

/** The learner's last choice, so the next project starts where they left off. */
export function readStoredStyle(): MapStyle {
  if (typeof window === 'undefined') return DEFAULT_STYLE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STYLE
    const parsed = JSON.parse(raw) as Partial<MapStyle>
    return normalizeStyle(parsed)
  } catch {
    // Private mode, a quota error or a hand-edited value: the default is fine.
    return DEFAULT_STYLE
  }
}

export function storeStyle(style: MapStyle): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(style))
  } catch {
    // Remembering the choice is a convenience, never a requirement.
  }
}

/**
 * Whether this browser has ever chosen a look.
 *
 * `readStoredStyle` cannot answer that, because it falls back to the default —
 * "chose the default" and "never chose" would look the same. The picker needs
 * the difference: a first visit should be asked, a returning one should not.
 */
export function hasStoredStyle(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null
  } catch {
    // Private mode: treat it as a first visit rather than guessing.
    return false
  }
}

/** `/app?layout=spider&palette=sage` — how the picker hands over its choice. */
export function styleFromSearch(search: string): MapStyle | null {
  const params = new URLSearchParams(search)
  const layout = params.get('layout')
  const palette = params.get('palette')
  if (!layout && !palette) return null
  return normalizeStyle({
    layout: isMapLayout(layout) ? layout : undefined,
    palette: isMapPalette(palette) ? palette : undefined,
  })
}

/** Drop the style params once they have been applied to the session. */
export function stripStyleFromSearch(search: string): string {
  const params = new URLSearchParams(search)
  params.delete('layout')
  params.delete('palette')
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}
