import { useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'

export function ParentAppFooter() {
  const navigate = useNavigate()
  const { signOutClearEverything } = useAuth()

  const handleClearAll = async () => {
    await signOutClearEverything()
    navigate('/auth', { replace: true })
  }

  return (
    <footer className="mt-6 border-t border-slate-200 pt-4 dark:border-zinc-800">
      <Button
        type="button"
        variant="secondary"
        className="w-full gap-2 text-xs"
        onClick={() => void handleClearAll()}
      >
        <LogOut className="h-4 w-4 shrink-0" aria-hidden />
        נקה נתונים מקומיים והתנתק
      </Button>
    </footer>
  )
}
