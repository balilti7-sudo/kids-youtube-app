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
        'inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-full text-yt-text transition',
        'hover:bg-yt-surfaceHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-yt-bg',
        compact ? 'h-12 w-12' : 'h-12 w-12',
        className
      )}
    >
      {isDark ? (
        <Moon className="h-5 w-5 shrink-0" aria-hidden />
      ) : (
        <Sun className="h-5 w-5 shrink-0" aria-hidden />
      )}
    </button>
  )
}
