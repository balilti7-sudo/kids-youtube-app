import { Toaster } from 'sonner'
import { useTheme } from '../../hooks/useTheme'

export function ThemeAwareToaster() {
  const { isDark } = useTheme()
  return <Toaster richColors position="top-center" dir="rtl" theme={isDark ? 'dark' : 'light'} />
}
