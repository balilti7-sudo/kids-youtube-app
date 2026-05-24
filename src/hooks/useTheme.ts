import { useCallback, useSyncExternalStore } from 'react'
import { applyTheme, readActiveTheme, toggleTheme, type Theme } from '../lib/theme'

function subscribe(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readActiveTheme, () => 'dark' as Theme)

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next)
  }, [])

  const toggle = useCallback(() => {
    toggleTheme()
  }, [])

  return { theme, isDark: theme === 'dark', setTheme, toggle }
}
