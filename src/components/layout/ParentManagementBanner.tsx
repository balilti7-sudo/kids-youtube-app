import { useNavigate } from 'react-router-dom'
import { lockManagementAppShell } from '../../lib/lockParentApp'
import { Button } from '../ui/Button'

export function ParentManagementBanner() {
  const navigate = useNavigate()

  const handOffToKidMode = () => {
    lockManagementAppShell()
    navigate('/kid', { replace: true })
  }

  return (
    <div
      className="border-b border-indigo-200/90 bg-gradient-to-r from-sky-100 via-indigo-100 to-violet-100 px-3 py-2.5 dark:border-indigo-800/80 dark:from-indigo-950/70 dark:via-sky-950/50 dark:to-violet-950/60 sm:px-4 sm:py-3"
      role="region"
      aria-label="אזור ניהול הורים"
    >
      <div className="mx-auto flex max-w-5xl flex-col items-stretch gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="text-center text-sm font-bold leading-snug text-indigo-950 dark:text-indigo-100 sm:text-right sm:text-base">
          🔧 אזור ניהול הורים — השינויים משפיעים מיד על המכשיר
        </p>
        <Button
          type="button"
          className="shrink-0 gap-2 self-center bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-md hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400 sm:self-auto"
          onClick={handOffToKidMode}
          aria-label="העבר למצב ילד ונועל מכשיר"
        >
          העבר למצב ילד ונועל מכשיר 👶
        </Button>
      </div>
    </div>
  )
}
