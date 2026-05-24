import { Moon, Sun } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useTheme } from '../../hooks/useTheme'

type ThemeToggleProps = {
  className?: string
  compact?: boolean
}

/** YouTube-style theme toggle — Sun in light mode, Moon in dark mode (RTL-friendly). */
export function ThemeToggle({ className, compact }: ThemeToggleProps) {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'מצב כהה פעיל — עבור למצב בהיר' : 'מצב בהיר פעיל — עבור למצב כהה'}
      title={isDark ? 'מצב כהה' : 'מצב בהיר'}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full text-yt-text transition',
        'hover:bg-yt-surfaceHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
        compact ? 'h-9 w-9' : 'h-10 w-10',
        className
      )}
    >
      {isDark ? (
        <Moon className={cn('shrink-0', compact ? 'h-4 w-4' : 'h-5 w-5')} aria-hidden />
      ) : (
        <Sun className={cn('shrink-0', compact ? 'h-4 w-4' : 'h-5 w-5')} aria-hidden />
      )}
    </button>
  )
}
