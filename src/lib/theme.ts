export const THEME_STORAGE_KEY = 'safetube-theme'

export type Theme = 'light' | 'dark'

export function getStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return null
}

export function getPreferredTheme(): Theme {
  return getStoredTheme() ?? 'dark'
}

export function readActiveTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function updateThemeColorMeta(theme: Theme) {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f0f0f' : '#f8fafc')
}

export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem(THEME_STORAGE_KEY, theme)
  updateThemeColorMeta(theme)
}

export function initTheme() {
  applyTheme(getPreferredTheme())
}

export function toggleTheme(): Theme {
  const next: Theme = readActiveTheme() === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}
