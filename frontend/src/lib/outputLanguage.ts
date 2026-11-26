/** Languages the learner may choose for the mind map's own text. */

export interface OutputLanguage {
  code: string
  name: string
}

export const OUTPUT_LANGUAGES: OutputLanguage[] = [
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'en', name: 'Tiếng Anh' },
  { code: 'hi', name: 'Tiếng Hin-đi' },
  { code: 'es', name: 'Tiếng Tây Ban Nha' },
  { code: 'fr', name: 'Tiếng Pháp' },
  { code: 'de', name: 'Tiếng Đức' },
  { code: 'ja', name: 'Tiếng Nhật' },
  { code: 'ko', name: 'Tiếng Hàn' },
  { code: 'zh', name: 'Tiếng Trung' },
  { code: 'pt', name: 'Tiếng Bồ Đào Nha' },
  { code: 'ru', name: 'Tiếng Nga' },
  { code: 'ar', name: 'Tiếng Ả Rập' },
]

/** A fresh workspace starts in Vietnamese; the caption track never decides. */
export const DEFAULT_OUTPUT_LANGUAGE = 'vi'

const STORAGE_KEY = 'ytmm:output-language'

export function isOutputLanguage(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    OUTPUT_LANGUAGES.some((item) => item.code === value.toLowerCase())
  )
}

export function normalizeOutputLanguage(value: unknown): string | null {
  if (!isOutputLanguage(value)) return null
  return value.toLowerCase()
}

export function outputLanguageName(code: string | null): string {
  if (!code) return 'Theo ngôn ngữ phụ đề'
  return OUTPUT_LANGUAGES.find((item) => item.code === code)?.name ?? code
}

/** Null is a real choice: it restores "follow the caption track". */
export function readStoredOutputLanguage(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    return raw === '' ? null : normalizeOutputLanguage(raw)
  } catch {
    return null
  }
}

export function storeOutputLanguage(code: string | null): void {
  try {
    if (code === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, code)
  } catch {
    // A blocked storage backend must not block the study session.
  }
}
